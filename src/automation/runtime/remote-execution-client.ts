import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'crypto';
import { AgentKeyService } from '../agents/agent-key.service';

/**
 * Runtime data do agente remoto (DEntidade idClasse=-156) necessario para
 * disparar uma execucao via tunel SSH.
 */
export interface RemoteAgentRuntime {
  agentId: string;
  tunnelPort: number;
  agentCommandSecretEncrypted: string;
}

/**
 * Payload de entrada do `RemoteExecutionClient.execute()` no protocolo V2
 * (ADR-V2-030 + ADR-V2-032 + ADR-V2-033).
 *
 * Diferencas em relacao ao protocolo legado (shell generico):
 * - REMOVIDO: `workspace`, `command.executable/args/cwd/env/timeoutMs/maxOutputBytes`
 * - ADICIONADO: `projectSlug`, `idClasseRisk`, `prompt`, `resumeSessionId`, `timeoutSec`
 *
 * O backend NUNCA envia `cwd` (path absoluto) — agente resolve o projeto via
 * `projectSlug` lendo `~/.claude/CLAUDE.md`. Decisao formalizada em ADR-V2-030.
 */
export interface RemoteExecutionRequest {
  /**
   * `DPedido.chave` (string) — id canonico da execucao no Engine
   * `OperacaoExecucaoClaude`.
   */
  executionId: string;

  /**
   * `DProject.chave` (string) — id canonico do projeto. Usado apenas para
   * logging/correlacao no backend; NAO trafega no payload outbound.
   */
  projectId: string;

  /**
   * Correlation id (X-Correlation-Id) propagado em toda a cadeia (frontend →
   * backend → agente → callback). Trafega em `metadata.correlationId`.
   */
  correlationId: string;

  /**
   * Slug do projeto (`DProject.dados.slug`) — string curta, lowercase,
   * derivada de `nome`. Identidade que o agente usa para resolver o path
   * via `~/.claude/CLAUDE.md`. Ver ADR-V2-030.
   */
  projectSlug: string;

  /**
   * Risk level via `DPedido.idClasse`: -301 LOW, -302 MEDIUM, -303 HIGH.
   * Ver ADR-V2-006.
   */
  idClasseRisk: number;

  /**
   * Prompt do usuario (texto livre) que sera repassado ao Claude Code via
   * `claude -p "<prompt>" --output-format json`.
   */
  prompt: string;

  /**
   * Se preenchido, o agente invoca `claude -p ... --resume <id>` para
   * continuar uma sessao existente. Ver ADR-V2-032.
   */
  resumeSessionId?: string | null;

  /**
   * Timeout em SEGUNDOS para a execucao remota. Default sugerido: 1800
   * (30min). O agente decide como aplicar (process timeout, CLI flag, etc).
   */
  timeoutSec: number;

  /**
   * Runtime do agente alvo (HMAC secret, porta, id).
   */
  agent: RemoteAgentRuntime;
}

/**
 * Resposta sincrona do agente ao receber `RUN_CLAUDE_CODE`. O agente NAO
 * devolve resultado completo aqui — apenas ACK confirmando que aceitou e
 * vai processar. O resultado real chega via `POST /agents/:id/execution-result`
 * (callback inbound, Sub-tarefa 2.4).
 */
export interface RemoteExecutionAck {
  accepted: boolean;
  executionId: string;
}

const PROTOCOL_VERSION = '2026-05-12';
const PAYLOAD_TYPE = 'RUN_CLAUDE_CODE' as const;
const ACK_FETCH_TIMEOUT_MS = 30000;

/**
 * Cliente outbound que dispara execucoes Claude Code para o agente V2
 * via tunel SSH 127.0.0.1:<tunnelPort>.
 *
 * Modelo de interacao:
 * 1. Backend POST /v1/execute (HMAC-SHA256) com payload V2 (`type:RUN_CLAUDE_CODE`)
 * 2. Agente valida HMAC, aceita execucao, devolve ACK sincrono `{accepted:true}`
 * 3. Agente executa `claude -p ...` em background
 * 4. Agente reporta resultado via callback `POST /agents/:id/execution-result`
 *    (Sub-tarefa 2.4 desta plan-task)
 *
 * Streaming NDJSON do legado foi REMOVIDO (decisao A2 do plan-task2 §2.a).
 *
 * @see ADR-V2-030 (projectSlug, eliminacao de cwd)
 * @see ADR-V2-032 (claudeSessionId, resumeSessionId, /v1/execute discriminator)
 * @see ADR-V2-033 (contrato /v1/execute outbound + execution-result inbound)
 */
@Injectable()
export class RemoteExecutionClient {
  private readonly logger = new Logger(RemoteExecutionClient.name);

  constructor(private readonly agentKeyService: AgentKeyService) {}

  /**
   * Dispara `RUN_CLAUDE_CODE` para o agente remoto. Retorna apos receber
   * ACK sincrono (nao espera a execucao terminar).
   *
   * @throws {ServiceUnavailableException} Quando o agente retorna != 200,
   *   conexao falha, timeout do ACK, ou `accepted != true` no body.
   */
  async execute(request: RemoteExecutionRequest): Promise<RemoteExecutionAck> {
    const body = JSON.stringify(this.buildPayload(request));
    const path = '/v1/execute';
    const url = `http://127.0.0.1:${request.agent.tunnelPort}${path}`;
    const headers = this.buildHeaders('POST', path, body, request);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), ACK_FETCH_TIMEOUT_MS);

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new ServiceUnavailableException(
          `Agent retornou HTTP ${response.status} para execution ${request.executionId}`,
        );
      }

      const parsed = (await response.json().catch(() => null)) as {
        accepted?: unknown;
        executionId?: unknown;
      } | null;

      if (!parsed || parsed.accepted !== true) {
        throw new ServiceUnavailableException(
          `Agent nao confirmou aceite (accepted!=true) para execution ${request.executionId}`,
        );
      }

      const ackExecutionId =
        typeof parsed.executionId === 'string' && parsed.executionId.length > 0
          ? parsed.executionId
          : request.executionId;

      this.logger.log(
        `remote_execute_accepted executionId=${request.executionId} agentId=${request.agent.agentId} projectSlug=${request.projectSlug}`,
      );

      return { accepted: true, executionId: ackExecutionId };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`remote_execute_failed executionId=${request.executionId} error=${message}`);
      if (error instanceof ServiceUnavailableException) {
        throw error;
      }
      throw new ServiceUnavailableException(
        `Falha ao disparar RUN_CLAUDE_CODE para execution ${request.executionId}: ${message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Monta o corpo JSON do POST /v1/execute no contrato V2.
   *
   * Shape conforme `plan-automation-agent-v2-client-task1.md` §4:
   * ```json
   * {
   *   "type": "RUN_CLAUDE_CODE",
   *   "executionId": "...",
   *   "projectSlug": "...",
   *   "idClasseRisk": -301,
   *   "prompt": "...",
   *   "resumeSessionId": null,
   *   "timeoutSec": 1800,
   *   "metadata": { "correlationId": "...", "issuedAt": "ISO8601" }
   * }
   * ```
   */
  private buildPayload(request: RemoteExecutionRequest): Record<string, unknown> {
    return {
      protocolVersion: PROTOCOL_VERSION,
      type: PAYLOAD_TYPE,
      executionId: request.executionId,
      projectSlug: request.projectSlug,
      idClasseRisk: request.idClasseRisk,
      prompt: request.prompt,
      resumeSessionId: request.resumeSessionId ?? null,
      timeoutSec: request.timeoutSec,
      metadata: {
        correlationId: request.correlationId,
        issuedAt: new Date().toISOString(),
      },
    };
  }

  /**
   * Constroi headers HMAC-SHA256 conforme algoritmo legado (preservado
   * inalterado por seguranca operacional — agente legado e V2 compartilham
   * o mesmo formato de assinatura).
   *
   * Canonical string:
   *   method + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + sha256(body)
   */
  private buildHeaders(
    method: string,
    path: string,
    body: string,
    request: RemoteExecutionRequest,
  ): Record<string, string> {
    const timestamp = new Date().toISOString();
    const nonce = randomUUID();
    const secret = this.agentKeyService.decryptCommandSecret(
      request.agent.agentCommandSecretEncrypted,
    );
    const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex');
    const canonical = [method, path, timestamp, nonce, bodyHash].join('\n');
    const signature = createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');

    return {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-scrumban-agent-id': request.agent.agentId,
      'x-scrumban-execution-id': request.executionId,
      'x-scrumban-timestamp': timestamp,
      'x-scrumban-nonce': nonce,
      'x-scrumban-signature': `hmac-sha256=${signature}`,
    };
  }
}

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

/**
 * Identificador dos comandos suportados pelo agente em `POST /v1/execute`.
 *
 * `RUN_CLAUDE_CODE` permanece como contrato legado (back-compat com
 * `execute()`). `SET_ENV` e `GENERATE_DEPLOY_KEY` foram adicionados na
 * task `vps-project-config-via-frontend` (ADR-V2-041, ADR-V2-042) — usados
 * via `dispatch<TReq,TRes>()`.
 */
export type RemoteCommandType =
  | 'RUN_CLAUDE_CODE'
  | 'SET_ENV'
  | 'GENERATE_DEPLOY_KEY'
  | 'PROVISION_PROJECT'
  | 'UNPROVISION_PROJECT';

/**
 * Contexto necessario para qualquer chamada outbound HMAC ao agente.
 *
 * Inclui o `agent` runtime (porta+secret cifrado+id) e dois metadados de
 * tracing/correlation (`correlationId` opcional, `executionId` opcional).
 *
 * Para `RUN_CLAUDE_CODE` o `executionId` e a `DPedido.chave` (obrigatorio
 * no header `x-scrumban-execution-id`). Para outros comandos onde nao ha
 * uma execucao Engine associada (ex: `SET_ENV`, `GENERATE_DEPLOY_KEY`),
 * o `executionId` recebe um UUID v4 gerado on-the-fly — o header e
 * obrigatorio no contrato HMAC do agente, mas o valor nao tem semantica
 * Engine.
 */
export interface DispatchContext {
  /** Runtime do agente alvo (HMAC secret, porta, id). */
  agent: RemoteAgentRuntime;
  /**
   * Correlation id para tracing. Se omitido, um UUID e gerado.
   * Vai em `metadata.correlationId` do body.
   */
  correlationId?: string;
  /**
   * Id da execucao no contexto Engine. Apenas `RUN_CLAUDE_CODE` precisa de
   * um id de `DPedido` real; demais comandos podem omitir (UUID v4 sera
   * usado para o header HMAC). Vai em header `x-scrumban-execution-id`.
   */
  executionId?: string;
}

const PROTOCOL_VERSION = '2026-05-12';
const RUN_CLAUDE_CODE_TYPE = 'RUN_CLAUDE_CODE' as const;
const ACK_FETCH_TIMEOUT_MS = 30000;

/**
 * Cliente outbound que dispara comandos para o agente V2 via tunel SSH
 * 127.0.0.1:<tunnelPort>.
 *
 * Modelo de interacao:
 * 1. Backend POST /v1/execute (HMAC-SHA256) com payload (`type:<COMANDO>`)
 * 2. Agente valida HMAC, processa, devolve ACK sincrono.
 * 3. Para `RUN_CLAUDE_CODE`: agente executa `claude -p ...` em background
 *    e reporta resultado via callback `POST /agents/:id/execution-result`.
 * 4. Para `SET_ENV` / `GENERATE_DEPLOY_KEY`: agente processa sincronamente
 *    (escreve env file / gera chave) e devolve o resultado no proprio ACK.
 *
 * Streaming NDJSON do legado foi REMOVIDO (decisao A2 do plan-task2 §2.a).
 *
 * @see ADR-V2-030 (projectSlug, eliminacao de cwd)
 * @see ADR-V2-032 (claudeSessionId, resumeSessionId, /v1/execute discriminator)
 * @see ADR-V2-033 (contrato /v1/execute outbound + execution-result inbound)
 * @see ADR-V2-041 (SET_ENV — env management via API outbound HMAC)
 * @see ADR-V2-042 (GENERATE_DEPLOY_KEY — deploy key automation pull-only)
 */
@Injectable()
export class RemoteExecutionClient {
  private readonly logger = new Logger(RemoteExecutionClient.name);

  constructor(private readonly agentKeyService: AgentKeyService) {}

  /**
   * Dispara `RUN_CLAUDE_CODE` para o agente remoto. Retorna apos receber
   * ACK sincrono (nao espera a execucao terminar).
   *
   * Wrapper legado preservado por back-compat (callers existentes do
   * Engine `OperacaoExecucaoClaude` e specs de regressao continuam
   * funcionando). Internamente delega para `dispatch()`.
   *
   * @throws {ServiceUnavailableException} Quando o agente retorna != 200,
   *   conexao falha, timeout do ACK, ou `accepted != true` no body.
   */
  async execute(request: RemoteExecutionRequest): Promise<RemoteExecutionAck> {
    const payload: Record<string, unknown> = {
      executionId: request.executionId,
      projectSlug: request.projectSlug,
      idClasseRisk: request.idClasseRisk,
      prompt: request.prompt,
      resumeSessionId: request.resumeSessionId ?? null,
      timeoutSec: request.timeoutSec,
    };

    const ack = await this.dispatch<typeof payload, { accepted?: unknown; executionId?: unknown }>(
      RUN_CLAUDE_CODE_TYPE,
      payload,
      {
        agent: request.agent,
        correlationId: request.correlationId,
        executionId: request.executionId,
      },
    );

    if (!ack || ack.accepted !== true) {
      throw new ServiceUnavailableException(
        `Agent nao confirmou aceite (accepted!=true) para execution ${request.executionId}`,
      );
    }

    const ackExecutionId =
      typeof ack.executionId === 'string' && ack.executionId.length > 0
        ? ack.executionId
        : request.executionId;

    this.logger.log(
      `remote_execute_accepted executionId=${request.executionId} agentId=${request.agent.agentId} projectSlug=${request.projectSlug}`,
    );

    return { accepted: true, executionId: ackExecutionId };
  }

  /**
   * Dispara um comando arbitrario (`type`) para o agente remoto e devolve
   * o body parseado do ACK sincrono (200 OK).
   *
   * O payload trafegado e a uniao `{ protocolVersion, type, ...input,
   * metadata: { correlationId, issuedAt } }`. HMAC-SHA256 e calculado
   * exatamente como em `execute()` (mesmo `buildHeaders` privado).
   *
   * Resposta nao-200, JSON invalido ou timeout do ACK lancam
   * `ServiceUnavailableException`. Validacao de `accepted` fica a cargo
   * do caller (cada handler do agente devolve campos especificos: o
   * `dispatch` so garante transporte e parsing).
   *
   * @typeparam TReq Shape do payload de entrada (sem `type`/`protocolVersion`).
   * @typeparam TRes Shape do body do ACK do agente.
   *
   * @param type Discriminator do comando. Ex: `'SET_ENV'`, `'GENERATE_DEPLOY_KEY'`.
   * @param input Campos especificos do comando (fundidos no body raiz).
   * @param ctx Contexto (`agent` obrigatorio; `correlationId`/`executionId` opcionais).
   * @returns Body JSON parseado do ACK (tipado como `TRes`).
   *
   * @throws {ServiceUnavailableException} HTTP != 200 / falha de rede / JSON invalido.
   *
   * @example
   * ```typescript
   * const ack = await client.dispatch<
   *   { vars: Record<string,string>; restartAfter: boolean },
   *   { accepted: boolean; varsWritten: string[]; restartScheduled: boolean }
   * >('SET_ENV', { vars: { GITHUB_TOKEN: '***' }, restartAfter: true }, { agent });
   * ```
   */
  async dispatch<TReq extends Record<string, unknown>, TRes>(
    type: RemoteCommandType,
    input: TReq,
    ctx: DispatchContext,
  ): Promise<TRes> {
    const correlationId = ctx.correlationId ?? randomUUID();
    const executionIdHeader = ctx.executionId ?? randomUUID();

    const body = JSON.stringify({
      protocolVersion: PROTOCOL_VERSION,
      type,
      ...input,
      metadata: {
        correlationId,
        issuedAt: new Date().toISOString(),
      },
    });

    const path = '/v1/execute';
    // AGENT_TUNNEL_HOST permite que o backend em Docker (Dokploy) alcance o
    // tunnel SSH bindado na Docker bridge da VPS (172.17.0.1) em vez de
    // localhost do container. Default 127.0.0.1 mantem dev local funcional.
    const tunnelHost = process.env.AGENT_TUNNEL_HOST ?? '127.0.0.1';
    const url = `http://${tunnelHost}:${ctx.agent.tunnelPort}${path}`;
    const headers = this.buildHeaders('POST', path, body, {
      agentId: ctx.agent.agentId,
      executionId: executionIdHeader,
      agentCommandSecretEncrypted: ctx.agent.agentCommandSecretEncrypted,
    });

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
          `Agent retornou HTTP ${response.status} para ${type} (agent=${ctx.agent.agentId})`,
        );
      }

      const parsed = (await response.json().catch(() => null)) as TRes | null;
      if (parsed === null || parsed === undefined) {
        throw new ServiceUnavailableException(
          `Agent retornou body invalido para ${type} (agent=${ctx.agent.agentId})`,
        );
      }

      this.logger.log(`remote_dispatch_ok type=${type} agentId=${ctx.agent.agentId}`);
      return parsed;
    } catch (error) {
      if (error instanceof ServiceUnavailableException) {
        const msg = error.message;
        this.logger.warn(`remote_dispatch_failed type=${type} error=${msg}`);
        throw error;
      }
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`remote_dispatch_failed type=${type} error=${message}`);
      throw new ServiceUnavailableException(
        `Falha ao disparar ${type} para agent ${ctx.agent.agentId}: ${message}`,
      );
    } finally {
      clearTimeout(timeout);
    }
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
    ctx: {
      agentId: string;
      executionId: string;
      agentCommandSecretEncrypted: string;
    },
  ): Record<string, string> {
    const timestamp = new Date().toISOString();
    const nonce = randomUUID();
    const secret = this.agentKeyService.decryptCommandSecret(ctx.agentCommandSecretEncrypted);
    const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex');
    const canonical = [method, path, timestamp, nonce, bodyHash].join('\n');
    const signature = createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');

    return {
      'content-type': 'application/json',
      accept: 'application/json',
      'x-scrumban-agent-id': ctx.agentId,
      'x-scrumban-execution-id': ctx.executionId,
      'x-scrumban-timestamp': timestamp,
      'x-scrumban-nonce': nonce,
      'x-scrumban-signature': `hmac-sha256=${signature}`,
    };
  }
}

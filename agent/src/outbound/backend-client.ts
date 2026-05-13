/**
 * Cliente HTTP outbound do agente → backend V2.
 *
 * Responsabilidades:
 *  - Serializar payload em JSON.
 *  - Assinar com HMAC-SHA256 via `signOutboundRequest` (algoritmo idêntico
 *    ao validador inbound do backend em `AgentSecurityService`).
 *  - Executar `fetch` (Node 20+ nativo — sem `node-fetch`).
 *  - Aplicar backoff exponencial em falha de rede ou HTTP 5xx.
 *  - NÃO retentar em 4xx (erro de payload/auth, retry não ajuda).
 *
 * Endpoints expostos:
 *  - `sendHeartbeat(payload)` → POST /agents/:id/heartbeat
 *  - `sendExecutionResult(payload)` → POST /agents/:id/execution-result
 *
 * `sendExecutionResult` é um STUB nesta Sub-tarefa 3 — o payload completo
 * (com `claudeSessionId`, `claudeSessionPath`, `resumedFrom`, `stdoutTruncated`,
 * etc.) será populado pela Sub-tarefa 4 (`RUN_CLAUDE_CODE` handler). Aqui o
 * método existe apenas para que a Sub-tarefa 4 plugue o resultado sem
 * refazer o transporte.
 *
 * Backoff exponencial: 1s, 2s, 4s, 8s, 16s, 32s (cap 60s). Máximo 5 tentativas
 * para falhas transientes. 4xx → erro imediato sem retry. 401 do backend é
 * logado em `error` (indica config corrompida) mas a função propaga o erro
 * para o caller — o heartbeat loop decide se continua ou abre circuit.
 *
 * @see ADR-V2-033 (contrato HTTP+HMAC)
 * @see src/automation/agents/agent-security.service.ts (validador no backend)
 */
import type { Logger } from 'pino';
import type { AgentConfig } from '../config/schema';
import { signOutboundRequest, type SignableMethod } from './hmac-sign';

/** Payload do heartbeat (POST /agents/:id/heartbeat). Snapshot leve do agente. */
export interface HeartbeatPayload {
  /** Load average normalizado (loadavg[0] / cpuCount). Geralmente 0..N. */
  cpu: number;
  /** Memória usada / total (fração 0..1). */
  mem: number;
  /** Uptime do processo em segundos. */
  uptime: number;
  /** Se o binário `claude` está instalado e responde a `--version`. */
  claudeCodeAvailable: boolean;
  /**
   * Saúde do reverse tunnel autossh. Por enquanto sempre `true` — a
   * Sub-tarefa 5 (autossh wrapper) vai inspecionar o processo e atualizar.
   * Mantido aqui como placeholder para evitar breaking change futuro.
   */
  tunnelHealthy: boolean;
  /** Versão do agente (do package.json). */
  agentVersion: string;
  /** Versão do Claude Code CLI detectada (ou `null` se indisponível). */
  claudeVersion: string | null;
}

/**
 * Payload do execution-result (POST /agents/:id/execution-result).
 *
 * **Sub-tarefa 3 grava só o stub.** Os campos `claudeSessionId`,
 * `claudeSessionPath`, `resumedFrom`, `stdoutTruncated`, `stderrTruncated`
 * são preenchidos pela Sub-tarefa 4. O tipo já reflete o shape final do
 * contrato ADR-V2-032 para minimizar churn.
 */
export interface ExecutionResultPayload {
  executionId: string;
  exitCode: number;
  success: boolean;
  durationMs: number;
  claudeSessionId: string | null;
  claudeSessionPath: string | null;
  resumedFrom: string | null;
  stdoutTruncated: string;
  stderrTruncated: string;
  errorCode?: string;
}

/**
 * Erro de transporte usado para distinguir 4xx (sem retry) de 5xx/rede (com retry).
 * Caller (heartbeat loop) pode inspecionar `.retryable` para decidir log level.
 */
export class BackendClientError extends Error {
  public readonly status: number | null;
  public readonly retryable: boolean;
  public readonly attempts: number;

  constructor(
    message: string,
    opts: { status: number | null; retryable: boolean; attempts: number },
  ) {
    super(message);
    this.name = 'BackendClientError';
    this.status = opts.status;
    this.retryable = opts.retryable;
    this.attempts = opts.attempts;
  }
}

/** Tunáveis do backoff exponencial. Default: 5 tentativas, base 1s, cap 60s. */
export interface BackendClientOptions {
  /** Máximo de tentativas (inclui a primeira). Default 5. */
  maxAttempts?: number;
  /** Delay base em ms. Doubled a cada tentativa. Default 1000. */
  baseDelayMs?: number;
  /** Teto absoluto do delay em ms. Default 60_000. */
  maxDelayMs?: number;
  /** Timeout por request em ms. Default 10_000. */
  requestTimeoutMs?: number;
  /** Função de sleep — injetável para testes (jest fake timers etc). */
  sleep?: (ms: number) => Promise<void>;
  /**
   * Implementação de fetch — default usa `globalThis.fetch` (Node 20+).
   * Injetável para testes sem nock/msw.
   */
  fetchImpl?: typeof fetch;
}

const DEFAULT_OPTIONS: Required<Omit<BackendClientOptions, 'fetchImpl' | 'sleep'>> = {
  maxAttempts: 5,
  baseDelayMs: 1000,
  maxDelayMs: 60_000,
  requestTimeoutMs: 10_000,
};

/** Interface pública do client (facilita mock no heartbeat loop). */
export interface BackendClient {
  sendHeartbeat(payload: HeartbeatPayload): Promise<void>;
  sendExecutionResult(payload: ExecutionResultPayload): Promise<void>;
}

/**
 * Constrói o backend client. Logger é obrigatório — todo erro é logado
 * antes de propagar para o caller (evita "silent failure").
 *
 * @example
 *   const client = createBackendClient(config, logger);
 *   await client.sendHeartbeat({ cpu: 0.1, mem: 0.5, uptime: 60, ... });
 */
export function createBackendClient(
  config: AgentConfig,
  logger: Logger,
  options: BackendClientOptions = {},
): BackendClient {
  // 'fetchImpl' in options distingue ausente (usa fallback global) de
  // explicitamente undefined (caller sinalizou indisponibilidade — honramos
  // a intenção e deixamos a defesa abaixo lançar erro claro).
  const resolvedFetch: typeof fetch | undefined =
    'fetchImpl' in options ? options.fetchImpl : (globalThis.fetch as typeof fetch | undefined);

  if (typeof resolvedFetch !== 'function') {
    throw new Error(
      'backend-client: fetch nao disponivel (Node 20+ obrigatorio, ou injetar fetchImpl)',
    );
  }

  const opts = {
    maxAttempts: options.maxAttempts ?? DEFAULT_OPTIONS.maxAttempts,
    baseDelayMs: options.baseDelayMs ?? DEFAULT_OPTIONS.baseDelayMs,
    maxDelayMs: options.maxDelayMs ?? DEFAULT_OPTIONS.maxDelayMs,
    requestTimeoutMs: options.requestTimeoutMs ?? DEFAULT_OPTIONS.requestTimeoutMs,
    sleep:
      options.sleep ?? ((ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))),
    fetchImpl: resolvedFetch,
  };

  // Backend V2 expõe rotas sob `app.setGlobalPrefix('api/v1')` (ver main.ts).
  // Anexa o prefixo se ainda não estiver presente no `backendBaseUrl` (idempotente
  // — operador pode fornecer URL com ou sem o prefix).
  const trimmed = stripTrailingSlash(config.backendBaseUrl);
  const baseUrl = /\/api\/v\d+$/.test(trimmed) ? trimmed : `${trimmed}/api/v1`;

  async function send(
    method: SignableMethod,
    path: string,
    body: unknown,
    contextLog: Record<string, unknown>,
  ): Promise<void> {
    const serialized = body === undefined ? '' : JSON.stringify(body);
    const url = `${baseUrl}${path}`;

    let attempt = 0;
    let lastError: unknown = null;

    while (attempt < opts.maxAttempts) {
      attempt += 1;

      // Re-assinar a cada tentativa: timestamp/nonce mudam, evita
      // rejeição por NONCE_REPLAY ou TIMESTAMP_SKEW em retries.
      const headers = signOutboundRequest({
        method,
        path,
        body: serialized,
        agentApiKey: config.agentApiKey,
        agentCommandSecret: config.agentCommandSecret,
        agentId: config.agentId,
      });

      const controller = new AbortController();
      const timeoutHandle = setTimeout(() => controller.abort(), opts.requestTimeoutMs);

      try {
        const response = await opts.fetchImpl(url, {
          method,
          headers,
          body: serialized.length > 0 ? serialized : undefined,
          signal: controller.signal,
        });
        clearTimeout(timeoutHandle);

        if (response.ok) {
          logger.debug({ ...contextLog, status: response.status, attempt }, 'outbound ok');
          return;
        }

        if (response.status >= 400 && response.status < 500) {
          // 4xx — erro de cliente (payload/auth). Retry não ajuda.
          const errorText = await safeReadBody(response);
          logger.error(
            {
              ...contextLog,
              status: response.status,
              attempt,
              errorBody: truncate(errorText, 512),
            },
            response.status === 401
              ? 'outbound 401 (config corrompida? secret invalido?)'
              : 'outbound 4xx (sem retry)',
          );
          throw new BackendClientError(`HTTP ${response.status} from backend`, {
            status: response.status,
            retryable: false,
            attempts: attempt,
          });
        }

        // 5xx — retentar com backoff.
        lastError = new BackendClientError(`HTTP ${response.status} from backend`, {
          status: response.status,
          retryable: true,
          attempts: attempt,
        });
        logger.warn(
          { ...contextLog, status: response.status, attempt },
          'outbound 5xx — retentando',
        );
      } catch (err) {
        clearTimeout(timeoutHandle);
        // Reerguer 4xx imediatamente (capturado acima).
        if (err instanceof BackendClientError && !err.retryable) {
          throw err;
        }
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        logger.warn(
          { ...contextLog, attempt, err: message },
          'outbound network/timeout — retentando',
        );
      }

      if (attempt < opts.maxAttempts) {
        const delay = computeBackoffDelay(attempt, opts.baseDelayMs, opts.maxDelayMs);
        await opts.sleep(delay);
      }
    }

    // Esgotou retries.
    const finalMessage =
      lastError instanceof Error ? lastError.message : 'falha desconhecida apos retries';
    logger.error(
      { ...contextLog, attempts: attempt, err: finalMessage },
      'outbound esgotou retries',
    );
    throw new BackendClientError(`outbound failed after ${attempt} attempts: ${finalMessage}`, {
      status: lastError instanceof BackendClientError ? lastError.status : null,
      retryable: true,
      attempts: attempt,
    });
  }

  return {
    async sendHeartbeat(payload: HeartbeatPayload): Promise<void> {
      const path = `/agents/${encodeURIComponent(config.agentId)}/heartbeat`;
      await send('POST', path, payload, { stage: 'heartbeat' });
    },

    async sendExecutionResult(payload: ExecutionResultPayload): Promise<void> {
      const path = `/agents/${encodeURIComponent(config.agentId)}/execution-result`;
      await send('POST', path, payload, {
        stage: 'execution-result',
        executionId: payload.executionId,
      });
    },
  };
}

/** Calcula delay com backoff exponencial: base * 2^(attempt-1), cap em maxDelay. */
function computeBackoffDelay(attempt: number, baseMs: number, maxMs: number): number {
  const expo = baseMs * 2 ** (attempt - 1);
  return Math.min(expo, maxMs);
}

function stripTrailingSlash(url: string): string {
  return url.endsWith('/') ? url.slice(0, -1) : url;
}

async function safeReadBody(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch {
    return '';
  }
}

function truncate(s: string, maxLen: number): string {
  return s.length > maxLen ? `${s.slice(0, maxLen)}…[trunc]` : s;
}

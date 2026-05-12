/**
 * Middleware HMAC-SHA256 — valida cada request inbound do backend V2.
 *
 * Algoritmo IDÊNTICO ao usado em
 * `src/automation/runtime/remote-execution-client.ts` (lado backend que
 * assina as requisições) e
 * `src/automation/agents/agent-security.service.ts` (lado backend que
 * valida heartbeats inbound). Qualquer divergência trava o canal — por
 * isso o algoritmo é replicado byte-a-byte (sem refactor "criativo").
 *
 * Fluxo:
 *  1. Lê headers `x-scrumban-agent-id`, `x-scrumban-timestamp`,
 *     `x-scrumban-nonce`, `x-scrumban-signature` (formato
 *     `hmac-sha256=<hex64>`).
 *  2. Valida que `agentId` casa com `config.agentId` (401 `AGENT_MISMATCH`).
 *  3. Valida skew do timestamp: `|now - ts| <= 5min` (401 `TIMESTAMP_SKEW`).
 *  4. Valida nonce não usado em LRU 10min (409 `NONCE_REPLAY`).
 *  5. Recomputa `hmac-sha256(secret, "${method}\n${path}\n${ts}\n${nonce}\n${sha256(rawBody)}")`.
 *  6. Compara em constant-time. Mismatch → 401 `HMAC_INVALID`.
 *
 * Side effects: em sucesso, registra o nonce no store (passo 6 ocorre
 * só APÓS verificação para não permitir que nonces inválidos consumam
 * capacidade do LRU).
 *
 * @see ADR-V2-033 (contrato HTTP+HMAC)
 * @see src/automation/runtime/remote-execution-client.ts (lado que assina)
 */
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import type { NextFunction, Request, RequestHandler, Response } from 'express';
import type { Logger } from 'pino';
import type { AgentConfig } from '../config/schema';
import type { NonceStore } from './nonce.store';

const TIMESTAMP_SKEW_MS = 5 * 60 * 1000; // ±5min — alinhado com backend
const SIGNATURE_PREFIX = 'hmac-sha256=';

/**
 * Express adiciona `rawBody` dinamicamente via `express.json({ verify })`.
 * Declaramos o campo aqui para o TypeScript reconhecer o uso no middleware.
 */
export interface RawBodyRequest extends Request {
  /** Bytes do body antes do parse JSON (preservados pelo `verify` callback). */
  rawBody?: Buffer;
}

/**
 * Códigos de erro padronizados que o middleware emite — usados nos
 * specs integration e no log estruturado.
 */
export type HmacErrorCode =
  | 'MISSING_HEADER'
  | 'AGENT_MISMATCH'
  | 'TIMESTAMP_SKEW'
  | 'NONCE_REPLAY'
  | 'HMAC_INVALID';

interface HmacErrorBody {
  accepted: false;
  errorCode: HmacErrorCode;
  message: string;
}

/**
 * Constrói o middleware HMAC. Recebe a config (para extrair `agentId` e
 * `agentCommandSecret`), o store de nonces e o logger.
 *
 * **Importante:** `agentCommandSecret` já vem em texto plano vindo do
 * `loadConfig()` — o `install.sh` é quem decifra o envelope AES-256-GCM
 * antes de gravar o `config.json`. O agente NÃO decifra em runtime.
 *
 * @param config Config carregada do `/etc/scrumban-agent/config.json`.
 * @param nonceStore Store anti-replay (instância única do processo).
 * @param logger Pino logger (já com redaction de `signature` configurada).
 * @returns Middleware Express pronto para `app.use()`.
 *
 * @example
 *   const middleware = createHmacMiddleware(config, store, logger);
 *   app.post('/v1/execute', middleware, dispatcher);
 */
export function createHmacMiddleware(
  config: AgentConfig,
  nonceStore: NonceStore,
  logger: Logger,
): RequestHandler {
  return (req: RawBodyRequest, res: Response, next: NextFunction): void => {
    const agentId = readHeader(req, 'x-scrumban-agent-id');
    const timestamp = readHeader(req, 'x-scrumban-timestamp');
    const nonce = readHeader(req, 'x-scrumban-nonce');
    const signatureHeader = readHeader(req, 'x-scrumban-signature');

    if (!agentId || !timestamp || !nonce || !signatureHeader) {
      reject(res, logger, 401, 'MISSING_HEADER', 'Header HMAC ausente ou vazio');
      return;
    }

    if (agentId !== config.agentId) {
      reject(res, logger, 401, 'AGENT_MISMATCH', 'agentId nao confere');
      return;
    }

    if (!isTimestampValid(timestamp)) {
      reject(res, logger, 401, 'TIMESTAMP_SKEW', 'Timestamp fora do skew window (+/-5min)');
      return;
    }

    if (nonceStore.has(nonce)) {
      reject(res, logger, 409, 'NONCE_REPLAY', 'Nonce ja utilizado dentro do TTL');
      return;
    }

    if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
      reject(res, logger, 401, 'HMAC_INVALID', 'Formato de assinatura invalido');
      return;
    }

    const providedHex = signatureHeader.slice(SIGNATURE_PREFIX.length);
    if (!/^[0-9a-f]{64}$/i.test(providedHex)) {
      reject(res, logger, 401, 'HMAC_INVALID', 'Assinatura nao e hex 64 chars');
      return;
    }

    // Path canônico SEM querystring (alinhado com backend que usa só path).
    // `req.path` em express já vem sem query; `req.originalUrl` traria
    // querystring. Manter `req.path` para casar com o backend.
    const method = req.method.toUpperCase();
    const path = req.path;
    const rawBody = req.rawBody ?? Buffer.alloc(0);
    const bodyHash = createHash('sha256').update(rawBody).digest('hex');
    const canonical = [method, path, timestamp, nonce, bodyHash].join('\n');
    const expectedHex = createHmac('sha256', config.agentCommandSecret)
      .update(canonical, 'utf8')
      .digest('hex');

    if (!safeEqualHex(providedHex, expectedHex)) {
      reject(res, logger, 401, 'HMAC_INVALID', 'Assinatura HMAC nao confere');
      return;
    }

    // Registra nonce APÓS verificação bem-sucedida.
    nonceStore.add(nonce);
    next();
  };
}

/**
 * Lê header (case-insensitive) e normaliza para string. Express devolve
 * `string | string[] | undefined`; arrays são raros mas defensivamente
 * pegamos o primeiro elemento.
 */
function readHeader(req: Request, name: string): string | null {
  const v = req.headers[name];
  if (Array.isArray(v)) return v[0] ?? null;
  return typeof v === 'string' && v.length > 0 ? v : null;
}

/**
 * Valida que `timestamp` (ISO 8601) está dentro de ±5min do agora.
 * Rejeita formatos não-parseáveis.
 */
function isTimestampValid(timestamp: string): boolean {
  const ts = Date.parse(timestamp);
  if (Number.isNaN(ts)) return false;
  const skew = Math.abs(Date.now() - ts);
  return skew <= TIMESTAMP_SKEW_MS;
}

/**
 * Compara duas strings hex em constant-time. Strings de tamanhos
 * diferentes retornam false sem invocar `timingSafeEqual` (que exige
 * buffers iguais).
 */
function safeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/**
 * Helper para responder erro HMAC com log estruturado.
 *
 * Nunca inclui o secret nem a assinatura completa no log — apenas o
 * código de erro, status, agentId (se válido) e mensagem.
 */
function reject(
  res: Response,
  logger: Logger,
  status: number,
  code: HmacErrorCode,
  message: string,
): void {
  logger.warn({ stage: 'hmac', errorCode: code, status }, message);
  const body: HmacErrorBody = { accepted: false, errorCode: code, message };
  res.status(status).json(body);
}

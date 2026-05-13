import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'crypto';
import { Request } from 'express';
import { AgentsService, AuthenticatedAgent } from '../agents.service';
import { AgentKeyService } from '../agent-key.service';
import { AgentSecurityService } from '../agent-security.service';

/**
 * Request autenticada por agent (post-HMAC). `agent` é injetado pelo guard.
 * `rawBody` deve ser populado pelo middleware `express.json({ verify })`
 * configurado em `src/main.ts` (ADR-V2-040).
 */
export interface AgentAuthenticatedRequest extends Request {
  agent?: AuthenticatedAgent;
  rawBody?: Buffer;
}

/** Codigos estruturados para log e debugging — alinhados com hmac.middleware do agent. */
type HmacErrorCode =
  | 'MISSING_HEADER'
  | 'INVALID_FORMAT'
  | 'TIMESTAMP_SKEW'
  | 'AGENT_MISMATCH'
  | 'AGENT_NOT_FOUND'
  | 'SECRET_NOT_PROVISIONED'
  | 'HMAC_INVALID';

const SIGNATURE_PREFIX = 'hmac-sha256=';
const HEX64_RE = /^[0-9a-f]{64}$/i;
const TIMESTAMP_SKEW_MS = 5 * 60_000;
const API_PREFIX_RE = /^\/api\/v\d+/;

/**
 * Guard de autenticação HMAC-SHA256 simétrico ao algoritmo usado em:
 *  - `agent/src/outbound/hmac-sign.ts` (agent → backend, ESTE guard valida)
 *  - `agent/src/server/hmac.middleware.ts` (backend → agent)
 *  - `src/automation/runtime/remote-execution-client.ts` (backend → agent)
 *
 * Canonical string (replicada byte-a-byte):
 *   method + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + sha256(rawBody).hex
 *
 * Headers esperados:
 *   x-scrumban-agent-id        — id do agente (DEntidade idClasse=-156)
 *   x-scrumban-timestamp       — ISO 8601, janela ±5min
 *   x-scrumban-nonce           — UUID anti-replay (Redis store 600s)
 *   x-scrumban-signature       — formato `hmac-sha256=<hex64>`
 *
 * Sequencia de validacao (ordem importa por custo/seguranca):
 *   1. Presenca e formato dos headers (cheap)
 *   2. Skew do timestamp ±5min (cheap)
 *   3. Nonce/rate-limit via Redis (medium, mas barra replay cedo)
 *   4. Agent id confere com route param (cheap)
 *   5. Carrega agent + decifra commandSecret (caro — depois das anteriores)
 *   6. Recomputa HMAC e compara em constant-time
 *
 * @see ADR-V2-033 (contrato HTTP+HMAC)
 * @see ADR-V2-040 (HMAC bilateral agent <-> backend)
 */
@Injectable()
export class AgentAuthGuard implements CanActivate {
  private readonly logger = new Logger(AgentAuthGuard.name);

  constructor(
    private readonly agentsService: AgentsService,
    private readonly agentKeyService: AgentKeyService,
    private readonly agentSecurityService: AgentSecurityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AgentAuthenticatedRequest>();

    const agentIdHeader = this.getHeader(request, 'x-scrumban-agent-id');
    const timestamp = this.getHeader(request, 'x-scrumban-timestamp');
    const nonce = this.getHeader(request, 'x-scrumban-nonce');
    const signatureHeader = this.getHeader(request, 'x-scrumban-signature');

    if (
      !agentIdHeader ||
      !timestamp ||
      !nonce ||
      !signatureHeader ||
      !/^\d+$/.test(agentIdHeader)
    ) {
      this.deny('MISSING_HEADER', 'Agent authentication required');
    }

    if (!signatureHeader.startsWith(SIGNATURE_PREFIX)) {
      this.deny('INVALID_FORMAT', 'Invalid agent signature format');
    }
    const providedHex = signatureHeader.slice(SIGNATURE_PREFIX.length);
    if (!HEX64_RE.test(providedHex)) {
      this.deny('INVALID_FORMAT', 'Invalid agent signature format');
    }

    this.validateTimestamp(timestamp);
    await this.agentSecurityService.assertRequestAllowed(agentIdHeader, nonce);

    const routeAgentId = request.params?.id;
    if (routeAgentId && routeAgentId !== agentIdHeader) {
      this.deny('AGENT_MISMATCH', 'Agent id mismatch');
    }

    const agent = await this.agentsService.findAgentForAuth(BigInt(agentIdHeader));
    const encrypted = agent.dados.agentCommandSecretEncrypted;
    if (typeof encrypted !== 'string' || encrypted.length === 0) {
      this.deny('SECRET_NOT_PROVISIONED', 'Agent secret not provisioned');
    }

    let secret: string;
    try {
      secret = this.agentKeyService.decryptCommandSecret(encrypted as string);
    } catch (err) {
      this.logger.warn(
        `agent_auth_decrypt_failed agentId=${agentIdHeader} err=${err instanceof Error ? err.message : String(err)}`,
      );
      this.deny('SECRET_NOT_PROVISIONED', 'Agent secret not decipherable');
    }

    const method = request.method.toUpperCase();
    const path = this.canonicalPath(request);
    const rawBody = request.rawBody ?? Buffer.alloc(0);
    const bodyHash = createHash('sha256').update(rawBody).digest('hex');
    const canonical = [method, path, timestamp, nonce, bodyHash].join('\n');
    const expectedHex = createHmac('sha256', secret!).update(canonical, 'utf8').digest('hex');

    const providedBuf = Buffer.from(providedHex, 'hex');
    const expectedBuf = Buffer.from(expectedHex, 'hex');
    if (
      providedBuf.length !== expectedBuf.length ||
      providedBuf.length === 0 ||
      !timingSafeEqual(providedBuf, expectedBuf)
    ) {
      this.logger.warn(
        `agent_auth_hmac_invalid agentId=${agentIdHeader} method=${method} path=${path}`,
      );
      this.deny('HMAC_INVALID', 'Agent authentication failed');
    }

    request.agent = agent;
    return true;
  }

  /**
   * Normaliza o path removendo o prefix global `/api/v\d+` (se presente).
   * O agent assina o path RELATIVO ao prefix (ex: `/agents/32/heartbeat`),
   * enquanto o Nest com `setGlobalPrefix('api/v1')` pode entregar `req.path`
   * com o prefix completo dependendo da ordem de middlewares. Strip
   * idempotente preserva ambos os casos.
   */
  private canonicalPath(request: Request): string {
    const raw = request.path || '/';
    return raw.replace(API_PREFIX_RE, '') || '/';
  }

  private getHeader(request: Request, name: string): string | undefined {
    const value = request.headers[name];
    if (Array.isArray(value)) return value[0];
    return typeof value === 'string' && value.length > 0 ? value : undefined;
  }

  private validateTimestamp(value: string): void {
    const parsed = new Date(value).getTime();
    if (!Number.isFinite(parsed)) {
      this.deny('TIMESTAMP_SKEW', 'Invalid agent timestamp');
    }
    const skewMs = Math.abs(Date.now() - parsed);
    if (skewMs > TIMESTAMP_SKEW_MS) {
      this.deny('TIMESTAMP_SKEW', 'Agent timestamp outside allowed window');
    }
  }

  /** Helper: lança UnauthorizedException com log estruturado. `never` para fluxo. */
  private deny(code: HmacErrorCode, message: string): never {
    this.logger.warn(`agent_auth_denied errorCode=${code}`);
    throw new UnauthorizedException(message);
  }
}

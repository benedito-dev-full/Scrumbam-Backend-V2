import { NotFoundException, UnauthorizedException } from '@nestjs/common';
import type { ExecutionContext } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'crypto';
import { AgentAuthGuard } from '../guards/agent-auth.guard';
import { AgentsService } from '../agents.service';
import { AgentKeyService } from '../agent-key.service';
import { AgentSecurityService } from '../agent-security.service';

/**
 * Specs do AgentAuthGuard — protocolo HMAC inbound `x-scrumban-*` (ADR-V2-040).
 *
 * Cobre os 12 cenarios obrigatorios definidos no plan
 * `workspace/plans/plan-automation-backend-hmac-alignment-task1.md` sub-tarefa 4:
 *
 *   1. Happy path
 *   2. Missing header (sem signature)
 *   3. Formato de signature invalido (sem prefix `hmac-sha256=`)
 *   4. Hex invalido (signature nao e hex64)
 *   5. Timestamp skew > 5min
 *   6. Nonce replay (AgentSecurityService lanca)
 *   7. Agent id mismatch entre header e route param
 *   8. Agent nao existe (findAgentForAuth lanca)
 *   9. Agent sem agentCommandSecretEncrypted (nao provisionado)
 *  10. HMAC invalido — secret errado
 *  11. HMAC invalido — body alterado depois de assinar
 *  12. GET request sem body — rawBody ausente trata como Buffer.alloc(0)
 *
 * @see src/automation/agents/guards/agent-auth.guard.ts
 * @see agent/src/outbound/hmac-sign.ts (gera o que esses specs validam)
 */

interface MockedRequest {
  method: string;
  path: string;
  params: { id?: string };
  headers: Record<string, string>;
  rawBody?: Buffer;
}

const TEST_SECRET = 'test-command-secret-very-long-and-random-0123456789';
const ENCRYPTED_PAYLOAD = 'v1:dummy-envelope';

/**
 * Constroi os headers canonicos `x-scrumban-*` para um request de teste,
 * espelhando byte-a-byte o que o agent (`signOutboundRequest`) envia.
 */
function buildSignedHeaders(opts: {
  method: string;
  path: string;
  agentId: string;
  rawBody: Buffer;
  secret: string;
  timestamp?: string;
  nonce?: string;
  signatureOverride?: string; // para forcar invalido
}): Record<string, string> {
  const timestamp = opts.timestamp ?? new Date().toISOString();
  const nonce = opts.nonce ?? randomUUID();
  const bodyHash = createHash('sha256').update(opts.rawBody).digest('hex');
  const canonical = [opts.method.toUpperCase(), opts.path, timestamp, nonce, bodyHash].join('\n');
  const hex = createHmac('sha256', opts.secret).update(canonical, 'utf8').digest('hex');
  return {
    'x-scrumban-agent-id': opts.agentId,
    'x-scrumban-timestamp': timestamp,
    'x-scrumban-nonce': nonce,
    'x-scrumban-signature': opts.signatureOverride ?? `hmac-sha256=${hex}`,
  };
}

function makeContext(request: MockedRequest): ExecutionContext {
  return {
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
}

function makeGuard(overrides?: {
  findAgentForAuth?: jest.Mock;
  decryptCommandSecret?: jest.Mock;
  assertRequestAllowed?: jest.Mock;
}): {
  guard: AgentAuthGuard;
  agentsService: { findAgentForAuth: jest.Mock };
  keyService: { decryptCommandSecret: jest.Mock };
  securityService: { assertRequestAllowed: jest.Mock };
} {
  const agentsService = {
    findAgentForAuth:
      overrides?.findAgentForAuth ??
      jest.fn().mockResolvedValue({
        chave: BigInt(32),
        dados: { agentCommandSecretEncrypted: ENCRYPTED_PAYLOAD },
      }),
  };
  const keyService = {
    decryptCommandSecret: overrides?.decryptCommandSecret ?? jest.fn().mockReturnValue(TEST_SECRET),
  };
  const securityService = {
    assertRequestAllowed: overrides?.assertRequestAllowed ?? jest.fn().mockResolvedValue(undefined),
  };
  const guard = new AgentAuthGuard(
    agentsService as unknown as AgentsService,
    keyService as unknown as AgentKeyService,
    securityService as unknown as AgentSecurityService,
  );
  return { guard, agentsService, keyService, securityService };
}

describe('AgentAuthGuard (HMAC x-scrumban-*)', () => {
  const agentId = '32';
  const bodyStr = JSON.stringify({ cpu: 0.1, mem: 0.5, uptime: 123 });
  const rawBody = Buffer.from(bodyStr, 'utf8');
  const path = '/agents/32/heartbeat';
  const method = 'POST';

  it('1. happy path: assinatura HMAC valida retorna true', async () => {
    const { guard, agentsService, keyService, securityService } = makeGuard();
    const headers = buildSignedHeaders({
      method,
      path,
      agentId,
      rawBody,
      secret: TEST_SECRET,
    });
    const request: MockedRequest = {
      method,
      path,
      params: { id: agentId },
      headers,
      rawBody,
    };

    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
    expect(securityService.assertRequestAllowed).toHaveBeenCalledWith(
      agentId,
      headers['x-scrumban-nonce'],
    );
    expect(agentsService.findAgentForAuth).toHaveBeenCalledWith(BigInt(agentId));
    expect(keyService.decryptCommandSecret).toHaveBeenCalledWith(ENCRYPTED_PAYLOAD);
    expect((request as { agent?: unknown }).agent).toBeDefined();
  });

  it('2. missing header (x-scrumban-signature ausente) -> Unauthorized', async () => {
    const { guard } = makeGuard();
    const headers = buildSignedHeaders({
      method,
      path,
      agentId,
      rawBody,
      secret: TEST_SECRET,
    });
    delete headers['x-scrumban-signature'];
    const request: MockedRequest = { method, path, params: { id: agentId }, headers, rawBody };
    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('3. formato de signature invalido (sem prefix hmac-sha256=) -> Unauthorized', async () => {
    const { guard } = makeGuard();
    const headers = buildSignedHeaders({
      method,
      path,
      agentId,
      rawBody,
      secret: TEST_SECRET,
      signatureOverride: 'sha256=' + 'a'.repeat(64),
    });
    const request: MockedRequest = { method, path, params: { id: agentId }, headers, rawBody };
    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('4. signature nao e hex64 -> Unauthorized', async () => {
    const { guard } = makeGuard();
    const headers = buildSignedHeaders({
      method,
      path,
      agentId,
      rawBody,
      secret: TEST_SECRET,
      signatureOverride: 'hmac-sha256=zzz', // muito curto + nao-hex
    });
    const request: MockedRequest = { method, path, params: { id: agentId }, headers, rawBody };
    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('5. timestamp skew > 5min -> Unauthorized', async () => {
    const { guard } = makeGuard();
    const headers = buildSignedHeaders({
      method,
      path,
      agentId,
      rawBody,
      secret: TEST_SECRET,
      timestamp: new Date(Date.now() - 10 * 60_000).toISOString(),
    });
    const request: MockedRequest = { method, path, params: { id: agentId }, headers, rawBody };
    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('6. nonce replay -> propaga erro do AgentSecurityService', async () => {
    const replayErr = new UnauthorizedException('Nonce already used');
    const { guard } = makeGuard({
      assertRequestAllowed: jest.fn().mockRejectedValue(replayErr),
    });
    const headers = buildSignedHeaders({
      method,
      path,
      agentId,
      rawBody,
      secret: TEST_SECRET,
    });
    const request: MockedRequest = { method, path, params: { id: agentId }, headers, rawBody };
    await expect(guard.canActivate(makeContext(request))).rejects.toBe(replayErr);
  });

  it('7. agent id mismatch entre header e route param -> Unauthorized', async () => {
    const { guard } = makeGuard();
    const headers = buildSignedHeaders({
      method,
      path,
      agentId,
      rawBody,
      secret: TEST_SECRET,
    });
    const request: MockedRequest = {
      method,
      path,
      params: { id: '99' }, // diferente do header
      headers,
      rawBody,
    };
    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('8. agent nao existe -> propaga NotFoundException do AgentsService', async () => {
    const notFound = new NotFoundException('Agent not found');
    const { guard } = makeGuard({
      findAgentForAuth: jest.fn().mockRejectedValue(notFound),
    });
    const headers = buildSignedHeaders({
      method,
      path,
      agentId,
      rawBody,
      secret: TEST_SECRET,
    });
    const request: MockedRequest = { method, path, params: { id: agentId }, headers, rawBody };
    await expect(guard.canActivate(makeContext(request))).rejects.toBe(notFound);
  });

  it('9. agent sem agentCommandSecretEncrypted -> Unauthorized', async () => {
    const { guard } = makeGuard({
      findAgentForAuth: jest.fn().mockResolvedValue({
        chave: BigInt(32),
        dados: {}, // sem agentCommandSecretEncrypted
      }),
    });
    const headers = buildSignedHeaders({
      method,
      path,
      agentId,
      rawBody,
      secret: TEST_SECRET,
    });
    const request: MockedRequest = { method, path, params: { id: agentId }, headers, rawBody };
    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('10. HMAC invalido (secret errado no servidor) -> Unauthorized', async () => {
    const { guard } = makeGuard({
      decryptCommandSecret: jest.fn().mockReturnValue('SECRET-DIFERENTE-DO-USADO-NA-ASSINATURA'),
    });
    const headers = buildSignedHeaders({
      method,
      path,
      agentId,
      rawBody,
      secret: TEST_SECRET,
    });
    const request: MockedRequest = { method, path, params: { id: agentId }, headers, rawBody };
    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('11. HMAC invalido (body alterado depois de assinar) -> Unauthorized', async () => {
    const { guard } = makeGuard();
    const headers = buildSignedHeaders({
      method,
      path,
      agentId,
      rawBody,
      secret: TEST_SECRET,
    });
    // request entrega bodyHash diferente do assinado
    const tamperedBody = Buffer.from(JSON.stringify({ cpu: 0.99, mem: 0.99 }), 'utf8');
    const request: MockedRequest = {
      method,
      path,
      params: { id: agentId },
      headers,
      rawBody: tamperedBody,
    };
    await expect(guard.canActivate(makeContext(request))).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });

  it('12. GET sem body: rawBody ausente trata como Buffer.alloc(0)', async () => {
    const { guard } = makeGuard();
    const getPath = '/agents/32/projects';
    const emptyBody = Buffer.alloc(0);
    const headers = buildSignedHeaders({
      method: 'GET',
      path: getPath,
      agentId,
      rawBody: emptyBody,
      secret: TEST_SECRET,
    });
    const request: MockedRequest = {
      method: 'GET',
      path: getPath,
      params: { id: agentId },
      headers,
      // rawBody intencionalmente ausente — guard deve tratar como Buffer.alloc(0)
    };
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
  });

  it('13. (extra) path normaliza prefix /api/v1 antes de validar HMAC', async () => {
    // Cenario do R1 (resolucao do plan): Nest com setGlobalPrefix('api/v1')
    // pode entregar req.path com prefix. Guard deve strip-ar para alinhar
    // com a assinatura do agent (que NAO inclui o prefix).
    const { guard } = makeGuard();
    const pathSemPrefix = '/agents/32/heartbeat';
    const pathComPrefix = '/api/v1/agents/32/heartbeat';
    const headers = buildSignedHeaders({
      method,
      path: pathSemPrefix, // agent assina SEM prefix
      agentId,
      rawBody,
      secret: TEST_SECRET,
    });
    const request: MockedRequest = {
      method,
      path: pathComPrefix, // Nest entrega COM prefix
      params: { id: agentId },
      headers,
      rawBody,
    };
    await expect(guard.canActivate(makeContext(request))).resolves.toBe(true);
  });
});

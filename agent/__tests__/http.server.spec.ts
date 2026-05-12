/**
 * Specs integration do servidor HTTP do agente (Sub-tarefa 2).
 *
 * Cenários cobertos:
 *  1. POST /v1/execute com HMAC válido + type=PING → 200 accepted=true
 *  2. POST /v1/execute com HMAC inválido (signature errada) → 401 HMAC_INVALID
 *  3. POST /v1/execute com timestamp velho (>5min) → 401 TIMESTAMP_SKEW
 *  4. POST /v1/execute com nonce repetido → 2ª recebe 409 NONCE_REPLAY
 *  5. POST /v1/execute com type desconhecido → 400 UNKNOWN_COMMAND_TYPE
 *  6. POST /v1/execute com type=RUN_CLAUDE_CODE → 501 NOT_IMPLEMENTED (stub)
 *  7. POST /v1/execute sem type → 400 MISSING_TYPE
 *  8. POST /v1/execute com x-scrumban-agent-id errado → 401 AGENT_MISMATCH
 *  9. GET /ping com HMAC válido → 200 ok=true
 * 10. Rate limit: 61ª request em 1min → 429 RATE_LIMIT_EXCEEDED
 *
 * Bonus:
 * 11. Headers HMAC ausentes → 401 MISSING_HEADER
 * 12. Rota inexistente → 404 NOT_FOUND
 * 13. Body JSON malformado → 400 INVALID_JSON
 *
 * Todos os specs usam supertest contra o `app` retornado por `createServer`
 * sem abrir socket real — mais rápido e determinístico que `start()`.
 */
import { createHash, createHmac, randomUUID } from 'crypto';
import pino from 'pino';
import request from 'supertest';
import { createServer } from '../src/server/http.server';
import type { AgentConfig } from '../src/config/schema';

const TEST_CONFIG: AgentConfig = {
  agentId: 'agent-test-1',
  agentApiKey: 'api-test',
  agentCommandSecret: 'secret-test-hmac',
  backendBaseUrl: 'https://api.test.local',
  backendTunnelHost: 'tunnel.test.local',
  backendTunnelPort: 22,
  tunnelPort: 39999,
  allowedProjectRoots: ['/home/dev/projetos'],
  claudeMdPath: '/home/dev/.claude/CLAUDE.md',
  agentSshKeyPath: '/etc/scrumban-agent/ssh_key',
  logLevel: 'error',
};

/** Logger silencioso para os testes (não polui o output). */
function silentLogger() {
  return pino({ level: 'silent' });
}

/**
 * Helper: monta headers HMAC corretos para um (method, path, bodyString).
 * Espelha exatamente o algoritmo do backend
 * (`remote-execution-client.ts#buildHeaders`).
 */
function signRequest(
  method: string,
  path: string,
  body: string,
  options?: {
    agentId?: string;
    secret?: string;
    timestamp?: string;
    nonce?: string;
  },
): Record<string, string> {
  const ts = options?.timestamp ?? new Date().toISOString();
  const nonce = options?.nonce ?? randomUUID();
  const secret = options?.secret ?? TEST_CONFIG.agentCommandSecret;
  const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex');
  const canonical = [method.toUpperCase(), path, ts, nonce, bodyHash].join('\n');
  const signature = createHmac('sha256', secret).update(canonical, 'utf8').digest('hex');

  return {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-scrumban-agent-id': options?.agentId ?? TEST_CONFIG.agentId,
    'x-scrumban-timestamp': ts,
    'x-scrumban-nonce': nonce,
    'x-scrumban-signature': `hmac-sha256=${signature}`,
  };
}

describe('HTTP server (Sub-tarefa 2)', () => {
  describe('POST /v1/execute', () => {
    it('1) HMAC válido + type=PING → 200 accepted=true', async () => {
      const server = createServer(TEST_CONFIG, silentLogger());
      const body = JSON.stringify({ type: 'PING', executionId: 'exec-1' });
      const headers = signRequest('POST', '/v1/execute', body);

      const res = await request(server.getApp()).post('/v1/execute').set(headers).send(body);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        accepted: true,
        executionId: 'exec-1',
        message: 'pong',
      });
    });

    it('2) signature errada → 401 HMAC_INVALID', async () => {
      const server = createServer(TEST_CONFIG, silentLogger());
      const body = JSON.stringify({ type: 'PING' });
      const headers = signRequest('POST', '/v1/execute', body, {
        secret: 'wrong-secret',
      });

      const res = await request(server.getApp()).post('/v1/execute').set(headers).send(body);

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        accepted: false,
        errorCode: 'HMAC_INVALID',
      });
    });

    it('3) timestamp velho (>5min) → 401 TIMESTAMP_SKEW', async () => {
      const server = createServer(TEST_CONFIG, silentLogger());
      const body = JSON.stringify({ type: 'PING' });
      const oldTs = new Date(Date.now() - 6 * 60 * 1000).toISOString();
      const headers = signRequest('POST', '/v1/execute', body, { timestamp: oldTs });

      const res = await request(server.getApp()).post('/v1/execute').set(headers).send(body);

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        accepted: false,
        errorCode: 'TIMESTAMP_SKEW',
      });
    });

    it('4) nonce repetido → 2ª request recebe 409 NONCE_REPLAY', async () => {
      const server = createServer(TEST_CONFIG, silentLogger());
      const body = JSON.stringify({ type: 'PING' });
      const nonce = randomUUID();
      const headers = signRequest('POST', '/v1/execute', body, { nonce });

      const r1 = await request(server.getApp()).post('/v1/execute').set(headers).send(body);
      expect(r1.status).toBe(200);

      // 2ª request com MESMO nonce (mas precisa do MESMO timestamp ou
      // o canonical muda; reusamos os mesmos headers exatamente).
      const r2 = await request(server.getApp()).post('/v1/execute').set(headers).send(body);
      expect(r2.status).toBe(409);
      expect(r2.body).toMatchObject({
        accepted: false,
        errorCode: 'NONCE_REPLAY',
      });
    });

    it('5) type desconhecido → 400 UNKNOWN_COMMAND_TYPE', async () => {
      const server = createServer(TEST_CONFIG, silentLogger());
      const body = JSON.stringify({ type: 'DELETE_EVERYTHING' });
      const headers = signRequest('POST', '/v1/execute', body);

      const res = await request(server.getApp()).post('/v1/execute').set(headers).send(body);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        accepted: false,
        errorCode: 'UNKNOWN_COMMAND_TYPE',
      });
      expect(res.body.supportedTypes).toEqual(expect.arrayContaining(['PING', 'RUN_CLAUDE_CODE']));
    });

    it('6) type=RUN_CLAUDE_CODE → handler delega (Sub-tarefa 4 ativa)', async () => {
      // Após Sub-tarefa 4 o handler real responde. Sem CLAUDE.md no path
      // de teste, deve retornar 500 CLAUDE_MD_NOT_FOUND — comportamento
      // esperado quando filesystem está vazio. O importante aqui é que
      // o dispatcher delega corretamente (não retorna mais 501).
      const server = createServer(TEST_CONFIG, silentLogger());
      const body = JSON.stringify({
        type: 'RUN_CLAUDE_CODE',
        executionId: 'exec-rcc-1',
        projectSlug: 'scrumban-backend-v2',
        prompt: 'fazer algo',
      });
      const headers = signRequest('POST', '/v1/execute', body);

      const res = await request(server.getApp()).post('/v1/execute').set(headers).send(body);

      // Status pode ser 500 (CLAUDE.md ausente) ou 422 (slug ausente).
      // Não é mais 501 — esse era o stub.
      expect(res.status).not.toBe(501);
      expect(res.body).toMatchObject({
        accepted: false,
        executionId: 'exec-rcc-1',
      });
    });

    it('7) sem type no body → 400 MISSING_TYPE', async () => {
      const server = createServer(TEST_CONFIG, silentLogger());
      const body = JSON.stringify({ executionId: 'x' });
      const headers = signRequest('POST', '/v1/execute', body);

      const res = await request(server.getApp()).post('/v1/execute').set(headers).send(body);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        accepted: false,
        errorCode: 'MISSING_TYPE',
      });
    });

    it('8) x-scrumban-agent-id errado → 401 AGENT_MISMATCH', async () => {
      const server = createServer(TEST_CONFIG, silentLogger());
      const body = JSON.stringify({ type: 'PING' });
      const headers = signRequest('POST', '/v1/execute', body, {
        agentId: 'agent-OUTRO',
      });

      const res = await request(server.getApp()).post('/v1/execute').set(headers).send(body);

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        accepted: false,
        errorCode: 'AGENT_MISMATCH',
      });
    });
  });

  describe('GET /ping', () => {
    it('9) HMAC válido → 200 ok=true com metadata', async () => {
      const server = createServer(TEST_CONFIG, silentLogger());
      const headers = signRequest('GET', '/ping', '');

      const res = await request(server.getApp()).get('/ping').set(headers);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        ok: true,
        agentId: TEST_CONFIG.agentId,
        version: expect.stringMatching(/^\d+\.\d+\.\d+$/),
      });
      expect(typeof res.body.uptimeSec).toBe('number');
      expect(res.body.uptimeSec).toBeGreaterThanOrEqual(0);
    });
  });

  describe('Rate limit', () => {
    it('10) 61ª request em 1min → 429 RATE_LIMIT_EXCEEDED', async () => {
      // Configuração com limite reduzido para o teste rodar rápido.
      // Mantém a semântica (limite excedido = 429) sem precisar disparar
      // 60 requests reais.
      const server = createServer(TEST_CONFIG, silentLogger(), {
        rateLimitOverrides: { windowMs: 60_000, max: 3 },
      });

      const send = async () => {
        const body = JSON.stringify({ type: 'PING' });
        const headers = signRequest('POST', '/v1/execute', body);
        return request(server.getApp()).post('/v1/execute').set(headers).send(body);
      };

      const r1 = await send();
      const r2 = await send();
      const r3 = await send();
      const r4 = await send();

      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      expect(r3.status).toBe(200);
      expect(r4.status).toBe(429);
      expect(r4.body).toMatchObject({
        accepted: false,
        errorCode: 'RATE_LIMIT_EXCEEDED',
      });
    });
  });

  describe('Edge cases', () => {
    it('11) headers HMAC ausentes → 401 MISSING_HEADER', async () => {
      const server = createServer(TEST_CONFIG, silentLogger());

      const res = await request(server.getApp())
        .post('/v1/execute')
        .set('content-type', 'application/json')
        .send(JSON.stringify({ type: 'PING' }));

      expect(res.status).toBe(401);
      expect(res.body).toMatchObject({
        accepted: false,
        errorCode: 'MISSING_HEADER',
      });
    });

    it('12) rota inexistente → 404 NOT_FOUND', async () => {
      const server = createServer(TEST_CONFIG, silentLogger());

      const res = await request(server.getApp()).get('/nao-existe');

      expect(res.status).toBe(404);
      expect(res.body).toMatchObject({
        accepted: false,
        errorCode: 'NOT_FOUND',
      });
    });

    it('13) body JSON malformado → 400 INVALID_JSON', async () => {
      const server = createServer(TEST_CONFIG, silentLogger());
      // Headers assinados não importam aqui — o erro acontece no body parser
      // ANTES do middleware HMAC (a ordem do pipeline). O comportamento é
      // que JSON inválido falha cedo com 400 padronizado.
      const malformed = '{ "type": "PING", invalid';

      const res = await request(server.getApp())
        .post('/v1/execute')
        .set('content-type', 'application/json')
        .send(malformed);

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        accepted: false,
        errorCode: 'INVALID_JSON',
      });
    });
  });

  describe('Lifecycle', () => {
    it('start/stop reais — abre e fecha socket na tunnelPort', async () => {
      // Usa porta diferente do default para evitar colisão com outro teste.
      const testConfig: AgentConfig = { ...TEST_CONFIG, tunnelPort: 40123 };
      const server = createServer(testConfig, silentLogger());

      await server.start();

      const body = JSON.stringify({ type: 'PING' });
      const headers = signRequest('POST', '/v1/execute', body);
      const res = await request('http://127.0.0.1:40123')
        .post('/v1/execute')
        .set(headers)
        .send(body);

      expect(res.status).toBe(200);

      await server.stop();

      // stop é idempotente.
      await server.stop();
    });

    it('start duas vezes consecutivas → throws', async () => {
      const testConfig: AgentConfig = { ...TEST_CONFIG, tunnelPort: 40124 };
      const server = createServer(testConfig, silentLogger());

      await server.start();
      await expect(server.start()).rejects.toThrow(/ja foi iniciado/);

      await server.stop();
    });
  });
});

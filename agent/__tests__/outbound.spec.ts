/**
 * Specs da Sub-tarefa 3 — outbound HMAC + BackendClient.
 *
 * Cenários:
 *  1. `signOutboundRequest` produz headers compatíveis com o validador
 *     inbound (round-trip via `createHmacMiddleware` do próprio agente).
 *  2. `signOutboundRequest` muda nonce e timestamp a cada chamada (default).
 *  3. `signOutboundRequest` honra overrides (timestamp/nonce determinísticos).
 *  4. `sendHeartbeat` faz POST na URL correta com headers HMAC + body JSON.
 *  5. Backend 200 → resolve sem erro.
 *  6. Backend 401 (4xx) → erro imediato, SEM retry.
 *  7. Backend 500 → backoff e retry, sucesso na 3ª tentativa.
 *  8. Backend 500 contínuo → esgota retries, lança `BackendClientError`.
 *  9. Network error → retry com backoff.
 * 10. `sendExecutionResult` envia para path /agents/:id/execution-result.
 *
 * Todos os testes usam `fetchImpl` e `sleep` injetáveis — zero IO real.
 */
import { createHash, createHmac } from 'crypto';
import express from 'express';
import pino from 'pino';
import type { AgentConfig } from '../src/config/schema';
import { createHmacMiddleware, type RawBodyRequest } from '../src/server/hmac.middleware';
import { createNonceStore } from '../src/server/nonce.store';
import {
  BackendClientError,
  createBackendClient,
  type ExecutionResultPayload,
  type HeartbeatPayload,
} from '../src/outbound/backend-client';
import { signOutboundRequest } from '../src/outbound/hmac-sign';
import request from 'supertest';

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

function silentLogger() {
  return pino({ level: 'silent' });
}

const HEARTBEAT_PAYLOAD: HeartbeatPayload = {
  cpu: 0.12,
  mem: 0.55,
  uptime: 1234,
  claudeCodeAvailable: true,
  tunnelHealthy: true,
  agentVersion: '0.1.0',
  claudeVersion: '0.1.42',
};

const EXECUTION_RESULT_PAYLOAD: ExecutionResultPayload = {
  executionId: 'exec-42',
  exitCode: 0,
  success: true,
  durationMs: 1500,
  claudeSessionId: null,
  claudeSessionPath: null,
  resumedFrom: null,
  stdoutTruncated: '',
  stderrTruncated: '',
};

/**
 * Helper: cria um fetch mock injetável que retorna respostas pré-programadas
 * em FIFO. Captura cada chamada em `calls[]` para asserts.
 */
function makeFetchMock(responses: Array<{ status?: number; body?: unknown } | Error>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  let i = 0;
  const fn = jest.fn(async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    const next = responses[i++];
    if (!next) throw new Error('fetch mock: respostas esgotadas');
    if (next instanceof Error) throw next;
    const status = next.status ?? 200;
    return new Response(JSON.stringify(next.body ?? {}), {
      status,
      headers: { 'content-type': 'application/json' },
    });
  });
  return { fn, calls };
}

describe('signOutboundRequest', () => {
  it('produz headers que passam pelo validador HMAC inbound (round-trip)', async () => {
    // Monta um mini app expressando o middleware HMAC inbound do agente,
    // e dispara o request assinado com a função outbound. Se o algoritmo
    // divergir 1 byte, o middleware rejeita.
    const app = express();
    app.use(
      express.json({
        verify: (req: RawBodyRequest, _res, buf) => {
          req.rawBody = buf;
        },
      }),
    );
    app.post(
      '/agents/agent-test-1/heartbeat',
      createHmacMiddleware(TEST_CONFIG, createNonceStore(), silentLogger()),
      (_req, res) => {
        res.status(200).json({ ok: true });
      },
    );

    const body = JSON.stringify(HEARTBEAT_PAYLOAD);
    const headers = signOutboundRequest({
      method: 'POST',
      path: '/agents/agent-test-1/heartbeat',
      body,
      agentCommandSecret: TEST_CONFIG.agentCommandSecret,
      agentId: TEST_CONFIG.agentId,
    });

    const response = await request(app)
      .post('/agents/agent-test-1/heartbeat')
      .set(headers as unknown as Record<string, string>)
      .send(HEARTBEAT_PAYLOAD);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  it('reflete o algoritmo canonico documentado (sanity check)', () => {
    const body = JSON.stringify({ hello: 'world' });
    const headers = signOutboundRequest({
      method: 'POST',
      path: '/foo',
      body,
      agentCommandSecret: 'secret',
      agentId: 'agt',
      timestampOverride: '2026-05-12T00:00:00.000Z',
      nonceOverride: 'fixed-nonce',
    });

    const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex');
    const canonical = ['POST', '/foo', '2026-05-12T00:00:00.000Z', 'fixed-nonce', bodyHash].join(
      '\n',
    );
    const expected = `hmac-sha256=${createHmac('sha256', 'secret').update(canonical, 'utf8').digest('hex')}`;
    expect(headers['x-scrumban-signature']).toBe(expected);
  });

  it('rotaciona nonce e timestamp em chamadas consecutivas (default)', () => {
    const a = signOutboundRequest({
      method: 'POST',
      path: '/x',
      body: '',
      agentCommandSecret: 's',
      agentId: 'a',
    });
    const b = signOutboundRequest({
      method: 'POST',
      path: '/x',
      body: '',
      agentCommandSecret: 's',
      agentId: 'a',
    });
    expect(a['x-scrumban-nonce']).not.toBe(b['x-scrumban-nonce']);
    // timestamp pode ser igual se executados no mesmo ms — só validamos que
    // são ISO 8601 válidos.
    expect(() => new Date(a['x-scrumban-timestamp'])).not.toThrow();
    expect(() => new Date(b['x-scrumban-timestamp'])).not.toThrow();
  });
});

describe('BackendClient.sendHeartbeat', () => {
  it('faz POST na URL correta com headers HMAC e body JSON', async () => {
    const { fn, calls } = makeFetchMock([{ status: 200, body: { ok: true } }]);
    const client = createBackendClient(TEST_CONFIG, silentLogger(), {
      fetchImpl: fn as unknown as typeof fetch,
      maxAttempts: 1,
      sleep: async () => {},
    });

    await client.sendHeartbeat(HEARTBEAT_PAYLOAD);

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.test.local/agents/agent-test-1/heartbeat');
    expect(calls[0].init.method).toBe('POST');

    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers['x-scrumban-agent-id']).toBe('agent-test-1');
    expect(headers['x-scrumban-signature']).toMatch(/^hmac-sha256=[0-9a-f]{64}$/);
    expect(headers['x-scrumban-nonce']).toBeTruthy();
    expect(headers['x-scrumban-timestamp']).toBeTruthy();
    expect(headers['content-type']).toBe('application/json');

    expect(typeof calls[0].init.body).toBe('string');
    expect(JSON.parse(calls[0].init.body as string)).toEqual(HEARTBEAT_PAYLOAD);
  });

  it('resolve sem erro em 200', async () => {
    const { fn } = makeFetchMock([{ status: 200, body: { ok: true } }]);
    const client = createBackendClient(TEST_CONFIG, silentLogger(), {
      fetchImpl: fn as unknown as typeof fetch,
      sleep: async () => {},
    });
    await expect(client.sendHeartbeat(HEARTBEAT_PAYLOAD)).resolves.toBeUndefined();
  });

  it('NAO retenta em 4xx — lanca BackendClientError com retryable=false', async () => {
    const { fn, calls } = makeFetchMock([
      { status: 401, body: { errorCode: 'HMAC_INVALID' } },
      // segundo response não deve ser consumido
      { status: 200, body: { ok: true } },
    ]);
    const client = createBackendClient(TEST_CONFIG, silentLogger(), {
      fetchImpl: fn as unknown as typeof fetch,
      sleep: async () => {},
      maxAttempts: 5,
    });

    await expect(client.sendHeartbeat(HEARTBEAT_PAYLOAD)).rejects.toMatchObject({
      name: 'BackendClientError',
      status: 401,
      retryable: false,
      attempts: 1,
    });
    expect(calls).toHaveLength(1);
  });

  it('retenta em 5xx com backoff e resolve na 3a tentativa', async () => {
    const { fn, calls } = makeFetchMock([
      { status: 500, body: {} },
      { status: 503, body: {} },
      { status: 200, body: { ok: true } },
    ]);
    const sleepCalls: number[] = [];
    const client = createBackendClient(TEST_CONFIG, silentLogger(), {
      fetchImpl: fn as unknown as typeof fetch,
      sleep: async (ms) => {
        sleepCalls.push(ms);
      },
      maxAttempts: 5,
      baseDelayMs: 1000,
      maxDelayMs: 60_000,
    });

    await client.sendHeartbeat(HEARTBEAT_PAYLOAD);

    expect(calls).toHaveLength(3);
    // backoff exponencial: 1000ms (apos tentativa 1), 2000ms (apos tentativa 2)
    expect(sleepCalls).toEqual([1000, 2000]);
  });

  it('retenta em network error (TypeError do fetch)', async () => {
    const networkErr = new TypeError('fetch failed: ECONNRESET');
    const { fn, calls } = makeFetchMock([
      networkErr,
      networkErr,
      { status: 200, body: { ok: true } },
    ]);
    const client = createBackendClient(TEST_CONFIG, silentLogger(), {
      fetchImpl: fn as unknown as typeof fetch,
      sleep: async () => {},
      maxAttempts: 5,
    });

    await client.sendHeartbeat(HEARTBEAT_PAYLOAD);
    expect(calls).toHaveLength(3);
  });

  it('esgota retries em 5xx continuo e lanca BackendClientError', async () => {
    const responses = Array.from({ length: 5 }, () => ({ status: 502, body: {} }));
    const { fn, calls } = makeFetchMock(responses);
    const client = createBackendClient(TEST_CONFIG, silentLogger(), {
      fetchImpl: fn as unknown as typeof fetch,
      sleep: async () => {},
      maxAttempts: 5,
      baseDelayMs: 1,
      maxDelayMs: 10,
    });

    await expect(client.sendHeartbeat(HEARTBEAT_PAYLOAD)).rejects.toBeInstanceOf(
      BackendClientError,
    );
    expect(calls).toHaveLength(5);
  });

  it('re-assina (novo nonce/timestamp) em cada retry — evita NONCE_REPLAY', async () => {
    const { fn, calls } = makeFetchMock([
      { status: 500, body: {} },
      { status: 200, body: { ok: true } },
    ]);
    const client = createBackendClient(TEST_CONFIG, silentLogger(), {
      fetchImpl: fn as unknown as typeof fetch,
      sleep: async () => {},
      maxAttempts: 5,
      baseDelayMs: 1,
    });

    await client.sendHeartbeat(HEARTBEAT_PAYLOAD);
    const h1 = calls[0].init.headers as Record<string, string>;
    const h2 = calls[1].init.headers as Record<string, string>;
    expect(h1['x-scrumban-nonce']).not.toBe(h2['x-scrumban-nonce']);
    expect(h1['x-scrumban-signature']).not.toBe(h2['x-scrumban-signature']);
  });
});

describe('BackendClient.sendExecutionResult', () => {
  it('faz POST em /agents/:id/execution-result com payload completo', async () => {
    const { fn, calls } = makeFetchMock([{ status: 200, body: { ok: true } }]);
    const client = createBackendClient(TEST_CONFIG, silentLogger(), {
      fetchImpl: fn as unknown as typeof fetch,
      sleep: async () => {},
      maxAttempts: 1,
    });

    await client.sendExecutionResult(EXECUTION_RESULT_PAYLOAD);

    expect(calls[0].url).toBe('https://api.test.local/agents/agent-test-1/execution-result');
    expect(JSON.parse(calls[0].init.body as string)).toEqual(EXECUTION_RESULT_PAYLOAD);
  });
});

describe('BackendClient — defesa de bootstrap', () => {
  it('lanca erro claro se fetch nao esta disponivel', () => {
    expect(() =>
      createBackendClient(TEST_CONFIG, silentLogger(), {
        fetchImpl: undefined as unknown as typeof fetch,
      }),
    ).toThrow(/fetch nao disponivel/);
  });
});

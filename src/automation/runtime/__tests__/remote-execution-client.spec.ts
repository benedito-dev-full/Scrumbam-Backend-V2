import { ServiceUnavailableException } from '@nestjs/common';
import { RemoteExecutionClient, RemoteExecutionRequest } from '../remote-execution-client';
import { AgentKeyService } from '../../agents/agent-key.service';

interface FetchMockResponse {
  ok: boolean;
  status: number;
  json: () => Promise<unknown>;
}

type FetchMock = jest.Mock<Promise<FetchMockResponse>, [string, RequestInit]>;

function buildClient(): {
  keyService: { decryptCommandSecret: jest.Mock<string, [string]> };
  client: RemoteExecutionClient;
} {
  const keyService = {
    decryptCommandSecret: jest.fn<string, [string]>().mockReturnValue('command-secret'),
  };
  return {
    keyService,
    client: new RemoteExecutionClient(keyService as unknown as AgentKeyService),
  };
}

function baseRequest(overrides: Partial<RemoteExecutionRequest> = {}): RemoteExecutionRequest {
  return {
    executionId: '10',
    projectId: '20',
    correlationId: 'corr-abc',
    projectSlug: 'scrumban-backend-v2',
    idClasseRisk: -301,
    prompt: 'refatore o servico X',
    resumeSessionId: null,
    timeoutSec: 1800,
    agent: {
      agentId: '30',
      tunnelPort: 20000,
      agentCommandSecretEncrypted: 'encrypted',
    },
    ...overrides,
  };
}

function mockFetchOk(response: unknown): FetchMock {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: true,
    status: 200,
    json: async () => response,
  } as FetchMockResponse) as unknown as FetchMock;
  global.fetch = fetchMock as unknown as typeof global.fetch;
  return fetchMock;
}

function mockFetchError(status: number, body: unknown = {}): FetchMock {
  const fetchMock = jest.fn().mockResolvedValue({
    ok: false,
    status,
    json: async () => body,
  } as FetchMockResponse) as unknown as FetchMock;
  global.fetch = fetchMock as unknown as typeof global.fetch;
  return fetchMock;
}

function readBody(fetchMock: FetchMock, callIndex = 0): Record<string, unknown> {
  const init = fetchMock.mock.calls[callIndex][1];
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

function readHeaders(fetchMock: FetchMock, callIndex = 0): Record<string, string> {
  const init = fetchMock.mock.calls[callIndex][1];
  return init.headers as Record<string, string>;
}

describe('RemoteExecutionClient (V2 protocol)', () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    jest.restoreAllMocks();
    global.fetch = originalFetch;
  });

  it('envia payload V2 com type RUN_CLAUDE_CODE e campos canonicos', async () => {
    const { client } = buildClient();
    const fetchMock = mockFetchOk({ accepted: true, executionId: '10' });

    const result = await client.execute(baseRequest());

    expect(result).toEqual({ accepted: true, executionId: '10' });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:20000/v1/execute',
      expect.objectContaining({ method: 'POST' }),
    );

    const body = readBody(fetchMock);
    expect(body.type).toBe('RUN_CLAUDE_CODE');
    expect(body.executionId).toBe('10');
    expect(body.projectSlug).toBe('scrumban-backend-v2');
    expect(body.idClasseRisk).toBe(-301);
    expect(body.prompt).toBe('refatore o servico X');
    expect(body.resumeSessionId).toBeNull();
    expect(body.timeoutSec).toBe(1800);
    const metadata = body.metadata as Record<string, unknown>;
    expect(metadata.correlationId).toBe('corr-abc');
    expect(typeof metadata.issuedAt).toBe('string');
    const issuedAt = metadata.issuedAt as string;
    expect(() => new Date(issuedAt).toISOString()).not.toThrow();
    expect(new Date(issuedAt).toISOString()).toBe(issuedAt);
  });

  it('payload V2 NAO contem campos shell legados (executable/args/cwd/env/workspace/command)', async () => {
    const { client } = buildClient();
    const fetchMock = mockFetchOk({ accepted: true, executionId: '10' });

    await client.execute(baseRequest());

    const body = readBody(fetchMock);
    expect(body.executable).toBeUndefined();
    expect(body.args).toBeUndefined();
    expect(body.cwd).toBeUndefined();
    expect(body.env).toBeUndefined();
    expect(body.workspace).toBeUndefined();
    expect(body.command).toBeUndefined();
    expect(body.maxOutputBytes).toBeUndefined();
    expect(body.timeoutMs).toBeUndefined();
  });

  it('inclui headers HMAC-SHA256 calculados via AgentKeyService.decryptCommandSecret', async () => {
    const { client, keyService } = buildClient();
    const fetchMock = mockFetchOk({ accepted: true, executionId: '10' });

    await client.execute(baseRequest());

    expect(keyService.decryptCommandSecret).toHaveBeenCalledWith('encrypted');

    const headers = readHeaders(fetchMock);
    expect(headers['x-scrumban-agent-id']).toBe('30');
    expect(headers['x-scrumban-execution-id']).toBe('10');
    expect(typeof headers['x-scrumban-timestamp']).toBe('string');
    expect(typeof headers['x-scrumban-nonce']).toBe('string');
    expect(headers['x-scrumban-signature']).toMatch(/^hmac-sha256=[a-f0-9]{64}$/);
    expect(headers['content-type']).toBe('application/json');
  });

  it('retorna {accepted:true, executionId} quando agente confirma', async () => {
    const { client } = buildClient();
    mockFetchOk({ accepted: true, executionId: '10' });

    const result = await client.execute(baseRequest());
    expect(result).toEqual({ accepted: true, executionId: '10' });
  });

  it('lanca ServiceUnavailableException quando HTTP nao-200', async () => {
    const { client } = buildClient();
    mockFetchError(503);

    await expect(client.execute(baseRequest())).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('lanca ServiceUnavailableException quando body !accepted', async () => {
    const { client } = buildClient();
    mockFetchOk({ accepted: false });

    await expect(client.execute(baseRequest())).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('lanca ServiceUnavailableException quando JSON body invalido', async () => {
    const { client } = buildClient();
    const fetchMock = jest.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => {
        throw new Error('invalid JSON');
      },
    } as FetchMockResponse) as unknown as FetchMock;
    global.fetch = fetchMock as unknown as typeof global.fetch;

    await expect(client.execute(baseRequest())).rejects.toBeInstanceOf(ServiceUnavailableException);
  });

  it('resumeSessionId null por default; quando preenchido aparece no body', async () => {
    const { client } = buildClient();
    const fetchMock = mockFetchOk({ accepted: true, executionId: '10' });

    // default: null
    await client.execute(baseRequest());
    expect(readBody(fetchMock, 0).resumeSessionId).toBeNull();

    // explicito: undefined → null
    await client.execute(baseRequest({ resumeSessionId: undefined }));
    expect(readBody(fetchMock, 1).resumeSessionId).toBeNull();

    // explicito: UUID
    await client.execute(baseRequest({ resumeSessionId: '550e8400-e29b-41d4-a716-446655440000' }));
    expect(readBody(fetchMock, 2).resumeSessionId).toBe('550e8400-e29b-41d4-a716-446655440000');
  });

  it('aceita idClasseRisk -302 (MEDIUM) e -303 (HIGH)', async () => {
    const { client } = buildClient();
    const fetchMock = mockFetchOk({ accepted: true, executionId: '10' });

    await client.execute(baseRequest({ idClasseRisk: -302 }));
    expect(readBody(fetchMock, 0).idClasseRisk).toBe(-302);

    await client.execute(baseRequest({ idClasseRisk: -303 }));
    expect(readBody(fetchMock, 1).idClasseRisk).toBe(-303);
  });

  it('URL correto inclui tunnelPort do agente', async () => {
    const { client } = buildClient();
    const fetchMock = mockFetchOk({ accepted: true, executionId: '10' });

    await client.execute(
      baseRequest({
        agent: {
          agentId: '99',
          tunnelPort: 22001,
          agentCommandSecretEncrypted: 'enc',
        },
      }),
    );

    expect(fetchMock).toHaveBeenCalledWith('http://127.0.0.1:22001/v1/execute', expect.anything());
  });
});

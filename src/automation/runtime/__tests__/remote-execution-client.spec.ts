import { RemoteExecutionClient } from '../remote-execution-client';

function streamFromLines(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(lines.join('\n')));
      controller.close();
    },
  });
}

describe('RemoteExecutionClient', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('envia payload estruturado assinado e grava stdout/stderr linha a linha', async () => {
    const keyService = { decryptCommandSecret: jest.fn().mockReturnValue('command-secret') };
    const logService = {
      recordOutputLine: jest.fn().mockResolvedValue(undefined),
    };
    const client = new RemoteExecutionClient(keyService as any, logService as any);
    const fetchMock = jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      body: streamFromLines([
        JSON.stringify({ type: 'stdout', line: 'line 1', sequence: 1 }),
        JSON.stringify({ type: 'stderr', line: 'line 2', sequence: 2 }),
        JSON.stringify({ type: 'exit', code: 0, durationMs: 12 }),
      ]),
    } as any);

    const context = { nextSequence: 1, bytesWritten: 0, truncated: false };
    const result = await client.execute(
      {
        executionId: '10',
        projectId: '20',
        correlationId: 'corr',
        agent: {
          agentId: '30',
          tunnelPort: 20000,
          agentCommandSecretEncrypted: 'encrypted',
        },
        workspace: '/srv/project/worktrees/exec-10',
        command: {
          executable: 'npm',
          args: ['test'],
          cwd: '.',
          env: { CI: 'true' },
          timeoutMs: 30000,
          maxOutputBytes: 1048576,
        },
      },
      context,
    );

    expect(fetchMock).toHaveBeenCalledWith(
      'http://127.0.0.1:20000/v1/execute',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'x-scrumban-agent-id': '30',
          'x-scrumban-execution-id': '10',
          'x-scrumban-signature': expect.stringMatching(/^hmac-sha256=/),
        }),
      }),
    );
    const body = JSON.parse((fetchMock.mock.calls[0][1] as any).body);
    expect(body).toEqual(expect.objectContaining({
      executable: 'npm',
      args: ['test'],
      workspace: '/srv/project/worktrees/exec-10',
    }));
    expect(result.exitCode).toBe(0);
    expect(logService.recordOutputLine).toHaveBeenCalledTimes(2);
    expect(logService.recordOutputLine).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ stream: 'stdout', line: 'line 1' }),
      context,
    );
  });

  it('trunca stdout/stderr retornados no mesmo limite enviado ao agent', async () => {
    const keyService = { decryptCommandSecret: jest.fn().mockReturnValue('command-secret') };
    const logService = {
      recordOutputLine: jest.fn().mockResolvedValue(undefined),
    };
    const client = new RemoteExecutionClient(keyService as any, logService as any);
    jest.spyOn(global, 'fetch' as any).mockResolvedValue({
      ok: true,
      body: streamFromLines([
        JSON.stringify({ type: 'stdout', line: '1234567890' }),
        JSON.stringify({ type: 'stderr', line: 'abcdefghij' }),
        JSON.stringify({ type: 'exit', code: 0 }),
      ]),
    } as any);

    const result = await client.execute(
      {
        executionId: '10',
        projectId: '20',
        correlationId: 'corr',
        agent: {
          agentId: '30',
          tunnelPort: 20000,
          agentCommandSecretEncrypted: 'encrypted',
        },
        workspace: '/srv/project/worktrees/exec-10',
        command: {
          executable: 'npm',
          args: ['test'],
          cwd: '.',
          timeoutMs: 30000,
          maxOutputBytes: 12,
        },
      },
      { nextSequence: 1, bytesWritten: 0, truncated: false },
    );

    expect(Buffer.byteLength(`${result.stdout}\n${result.stderr}`, 'utf8')).toBeLessThanOrEqual(12);
    expect(result.outputTruncated).toBe(true);
  });
});

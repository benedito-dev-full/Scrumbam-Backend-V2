/**
 * Specs do `warm-cache.handler.ts` (ADR-V2-045 — Cache Warmer).
 *
 * Cobertura (8 cenários):
 *  1. Happy path → success=true com tokens e custo extraídos do JSON
 *  2. Slug desconhecido → UNKNOWN_PROJECT_SLUG (execFile NÃO chamado)
 *  3. Path fora da allowlist → WORKSPACE_OUTSIDE_ALLOWED_ROOT
 *  4. Binário claude ausente (ENOENT) → CLAUDE_BINARY_MISSING
 *  5. Timeout do execFile → WARM_TIMEOUT
 *  6. JSON output malformado → CLAUDE_OUTPUT_PARSE_FAILED, métricas zero
 *  7. CLAUDE.md ausente → continua sem --system-prompt (warn log), success=true
 *  8. is_error:true no JSON → success=false, errorCode=CLAUDE_IS_ERROR
 *
 * Estratégia: mockar execFileImpl, resolveImpl, validateImpl, readFileImpl,
 * clockImpl. Sem filesystem real.
 */
import pino from 'pino';
import { AllowlistError } from '../src/claude-code/allowlist';
import { IdentityResolverError } from '../src/claude-code/identity-resolver';
import type { AgentConfig, CacheWarmerConfig } from '../src/config/schema';
import { warmCache, type WarmCacheDeps } from '../src/handlers/warm-cache.handler';

const TEST_CONFIG: AgentConfig = {
  agentId: 'agent-warm-test',
  agentApiKey: 'api',
  agentCommandSecret: 'secret',
  backendBaseUrl: 'https://api.test.local',
  backendTunnelHost: 'tunnel',
  backendTunnelPort: 22,
  tunnelPort: 39999,
  bindHost: '127.0.0.1',
  allowedProjectRoots: ['/home/dev/projetos'],
  claudeMdPath: '/home/dev/.claude/CLAUDE.md',
  agentSshKeyPath: '/etc/scrumban-agent/ssh_key',
  logLevel: 'error',
};

const WARMER_CONFIG: CacheWarmerConfig = {
  enabled: true,
  intervalMinutes: 40,
  projects: ['my-proj'],
  warmupPrompt: 'responda apenas ok. nao use ferramentas.',
  claudeFlags: ['--permission-mode=plan', '--max-turns=1'],
  timeoutSeconds: 30,
  dailyCostCapUsd: 1.0,
};

function silentLogger() {
  return pino({ level: 'silent' });
}

/** Helper para montar deps com defaults sãos. */
function makeDeps(overrides?: Partial<WarmCacheDeps>): WarmCacheDeps {
  return {
    config: TEST_CONFIG,
    cacheWarmerConfig: WARMER_CONFIG,
    logger: silentLogger(),
    execFileImpl: ((..._args: unknown[]) => {
      throw new Error('execFileImpl não mockado neste teste');
    }) as never,
    resolveImpl: () => '/home/dev/projetos/my-proj',
    validateImpl: () => '/home/dev/projetos/my-proj',
    readFileImpl: async () => '# CLAUDE.md content (~58k tokens)',
    clockImpl: () => 1700000000000, // fixed
    ...overrides,
  };
}

/** Builda mock do execFile que invoca o callback de forma síncrona. */
function mockExecFileSuccess(stdout: string, stderr = '') {
  return ((
    _bin: string,
    _args: string[],
    _opts: unknown,
    cb: (
      err: NodeJS.ErrnoException | null,
      stdout: string | Buffer,
      stderr: string | Buffer,
    ) => void,
  ) => {
    setImmediate(() => cb(null, stdout, stderr));
    return {
      on: () => {
        /* noop */
      },
    } as never;
  }) as never;
}

function mockExecFileError(
  err: Partial<NodeJS.ErrnoException> & {
    stdout?: string;
    stderr?: string;
    killed?: boolean;
    signal?: NodeJS.Signals | string;
  },
) {
  return ((
    _bin: string,
    _args: string[],
    _opts: unknown,
    cb: (e: NodeJS.ErrnoException | null, stdout: string | Buffer, stderr: string | Buffer) => void,
  ) => {
    setImmediate(() => {
      const e = Object.assign(new Error(err.message ?? 'fail'), err);
      cb(e as NodeJS.ErrnoException, err.stdout ?? '', err.stderr ?? '');
    });
    return {
      on: () => {
        /* noop */
      },
    } as never;
  }) as never;
}

const VALID_WARM_JSON = JSON.stringify({
  type: 'result',
  subtype: 'success',
  is_error: false,
  session_id: '22df17ba-7d3d-4c0c-ad5d-234a9ad4b03d',
  result: 'ok',
  duration_ms: 1200,
  total_cost_usd: 0.0028,
  usage: {
    input_tokens: 12,
    output_tokens: 3,
    cache_creation_input_tokens: 0,
    cache_read_input_tokens: 58077,
  },
});

describe('warmCache', () => {
  it('1) happy path → success=true com tokens e custo', async () => {
    const captured: { args?: string[]; cwd?: string } = {};
    const exec = ((
      _bin: string,
      args: string[],
      opts: { cwd?: string },
      cb: (e: null, stdout: string, stderr: string) => void,
    ) => {
      captured.args = args;
      captured.cwd = opts.cwd;
      setImmediate(() => cb(null, VALID_WARM_JSON, ''));
      return { on: () => undefined } as never;
    }) as never;

    const result = await warmCache({ projectSlug: 'my-proj' }, makeDeps({ execFileImpl: exec }));

    expect(result.success).toBe(true);
    expect(result.exitCode).toBe(0);
    expect(result.claudeSessionId).toBe('22df17ba-7d3d-4c0c-ad5d-234a9ad4b03d');
    expect(result.cacheReadTokens).toBe(58077);
    expect(result.cacheCreationTokens).toBe(0);
    expect(result.inputTokens).toBe(12);
    expect(result.outputTokens).toBe(3);
    expect(result.costUsd).toBe(0.0028);
    expect(result.errorCode).toBeUndefined();
    expect(result.projectSlug).toBe('my-proj');

    // Paridade — primeiro arg passado ao execFile deve ser '--system-prompt'.
    expect(captured.args?.[0]).toBe('--system-prompt');
    expect(captured.args?.[2]).toBe('-p');
    expect(captured.args?.[3]).toBe('responda apenas ok. nao use ferramentas.');
    expect(captured.args).toContain('--permission-mode=plan');
    expect(captured.args).toContain('--max-turns=1');
    expect(captured.cwd).toBe('/home/dev/projetos/my-proj');
  });

  it('2) slug desconhecido → UNKNOWN_PROJECT_SLUG (execFile NÃO chamado)', async () => {
    const exec = jest.fn();
    const result = await warmCache(
      { projectSlug: 'nao-existe' },
      makeDeps({
        execFileImpl: exec as never,
        resolveImpl: () => {
          throw new IdentityResolverError(
            'UNKNOWN_PROJECT_SLUG',
            'slug "nao-existe" nao encontrado no CLAUDE.md',
          );
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('UNKNOWN_PROJECT_SLUG');
    expect(exec).not.toHaveBeenCalled();
  });

  it('3) path fora da allowlist → WORKSPACE_OUTSIDE_ALLOWED_ROOT', async () => {
    const exec = jest.fn();
    const result = await warmCache(
      { projectSlug: 'my-proj' },
      makeDeps({
        execFileImpl: exec as never,
        validateImpl: () => {
          throw new AllowlistError('WORKSPACE_OUTSIDE_ALLOWED_ROOT', '/tmp fora de allowlist');
        },
      }),
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('WORKSPACE_OUTSIDE_ALLOWED_ROOT');
    expect(exec).not.toHaveBeenCalled();
  });

  it('4) binário claude ausente (ENOENT) → CLAUDE_BINARY_MISSING', async () => {
    const result = await warmCache(
      { projectSlug: 'my-proj' },
      makeDeps({
        execFileImpl: mockExecFileError({
          code: 'ENOENT',
          message: 'spawn claude ENOENT',
          stderr: 'claude: command not found',
        }),
      }),
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CLAUDE_BINARY_MISSING');
  });

  it('5) timeout do execFile → WARM_TIMEOUT', async () => {
    const result = await warmCache(
      { projectSlug: 'my-proj' },
      makeDeps({
        execFileImpl: mockExecFileError({
          killed: true,
          signal: 'SIGTERM',
          stdout: '',
          stderr: '',
        }),
      }),
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('WARM_TIMEOUT');
    expect(result.cacheReadTokens).toBe(0);
  });

  it('6) JSON malformado → CLAUDE_OUTPUT_PARSE_FAILED com métricas zero', async () => {
    const result = await warmCache(
      { projectSlug: 'my-proj' },
      makeDeps({
        execFileImpl: mockExecFileSuccess('isto não é JSON {{{', ''),
      }),
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CLAUDE_OUTPUT_PARSE_FAILED');
    expect(result.cacheCreationTokens).toBe(0);
    expect(result.cacheReadTokens).toBe(0);
    expect(result.claudeSessionId).toBeNull();
  });

  it('7) CLAUDE.md ausente → continua sem --system-prompt, success=true', async () => {
    const captured: { args?: string[] } = {};
    const exec = ((
      _bin: string,
      args: string[],
      _opts: unknown,
      cb: (e: null, stdout: string, stderr: string) => void,
    ) => {
      captured.args = args;
      setImmediate(() => cb(null, VALID_WARM_JSON, ''));
      return { on: () => undefined } as never;
    }) as never;

    const result = await warmCache(
      { projectSlug: 'my-proj' },
      makeDeps({
        execFileImpl: exec,
        readFileImpl: async () => {
          const err = new Error('ENOENT: no such file') as NodeJS.ErrnoException;
          err.code = 'ENOENT';
          throw err;
        },
      }),
    );

    expect(result.success).toBe(true);
    // Sem CLAUDE.md, primeiro arg deve ser `-p` (não `--system-prompt`).
    expect(captured.args?.[0]).toBe('-p');
    expect(captured.args?.[1]).toBe('responda apenas ok. nao use ferramentas.');
  });

  it('8) is_error=true no JSON → success=false, errorCode=CLAUDE_IS_ERROR', async () => {
    const errJson = JSON.stringify({
      type: 'result',
      is_error: true,
      session_id: '22df17ba-7d3d-4c0c-ad5d-234a9ad4b03d',
      total_cost_usd: 0.005,
      usage: {
        input_tokens: 5,
        output_tokens: 1,
        cache_creation_input_tokens: 0,
        cache_read_input_tokens: 0,
      },
    });

    const result = await warmCache(
      { projectSlug: 'my-proj' },
      makeDeps({ execFileImpl: mockExecFileSuccess(errJson, '') }),
    );

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CLAUDE_IS_ERROR');
    // Mesmo em erro, métricas e sessionId são preservadas para audit.
    expect(result.claudeSessionId).toBe('22df17ba-7d3d-4c0c-ad5d-234a9ad4b03d');
    expect(result.costUsd).toBe(0.005);
  });

  it('9) usage ausente no JSON → métricas zero (defesa)', async () => {
    const noUsageJson = JSON.stringify({
      type: 'result',
      is_error: false,
      session_id: '22df17ba-7d3d-4c0c-ad5d-234a9ad4b03d',
    });

    const result = await warmCache(
      { projectSlug: 'my-proj' },
      makeDeps({ execFileImpl: mockExecFileSuccess(noUsageJson, '') }),
    );

    expect(result.success).toBe(true);
    expect(result.cacheCreationTokens).toBe(0);
    expect(result.cacheReadTokens).toBe(0);
  });
});

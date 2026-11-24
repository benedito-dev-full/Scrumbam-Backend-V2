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
 *  7. (ADR-V2-083) argv com as MESMAS flags de sessão da task real do modo
 *     esteira; CLAUDE.md global NÃO é mais lido; `error_max_turns` com cache
 *     criado conta como warm bem-sucedido
 *  8. is_error:true no JSON → success=false, errorCode=CLAUDE_IS_ERROR
 *
 * Estratégia: mockar execFileImpl, resolveImpl, validateImpl,
 * clockImpl. Sem filesystem real.
 */
import pino from 'pino';
import { AllowlistError } from '../src/claude-code/allowlist';
import { IdentityResolverError } from '../src/claude-code/identity-resolver';
import type { AgentConfig, CacheWarmerConfig } from '../src/config/schema';
import { warmCache, type WarmCacheDeps } from '../src/handlers/warm-cache.handler';
import {
  PIPELINE_APPEND_SYSTEM_PROMPT,
  PIPELINE_RESULT_SCHEMA_JSON,
} from '../src/claude-code/pipeline-contract';

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
  pipelineTimeoutMaxSec: 21_600,
  prFallback: true,
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

    // Paridade (ADR-V2-083): mesmas flags de sessão da task real do modo esteira.
    expect(captured.args?.slice(0, 5)).toEqual([
      '--append-system-prompt',
      PIPELINE_APPEND_SYSTEM_PROMPT,
      '--json-schema',
      PIPELINE_RESULT_SCHEMA_JSON,
      '--exclude-dynamic-system-prompt-sections',
    ]);
    expect(captured.args).not.toContain('--system-prompt');
    expect(captured.args?.[5]).toBe('-p');
    expect(captured.args?.[6]).toBe('responda apenas ok. nao use ferramentas.');
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

  it('7) error_max_turns (json-schema + max-turns=1) COM cache criado → warm bem-sucedido', async () => {
    // Verificado no CLI 2.1.330: com --json-schema e --max-turns=1 o CLI sai com
    // exit 1 / subtype error_max_turns, mas o prefixo já foi cacheado.
    const maxTurnsJson = JSON.stringify({
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      session_id: '22df17ba-7d3d-4c0c-ad5d-234a9ad4b03d',
      total_cost_usd: 0.0036,
      usage: {
        input_tokens: 2,
        output_tokens: 10,
        cache_creation_input_tokens: 17446,
        cache_read_input_tokens: 12235,
      },
    });
    const exec = ((
      _bin: string,
      _args: string[],
      _opts: unknown,
      cb: (e: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const err = Object.assign(new Error('exit 1'), { code: 1, stdout: maxTurnsJson, stderr: '' });
      setImmediate(() => cb(err, maxTurnsJson, ''));
      return { on: () => undefined } as never;
    }) as never;

    const result = await warmCache({ projectSlug: 'my-proj' }, makeDeps({ execFileImpl: exec }));

    expect(result.success).toBe(true);
    expect(result.cacheCreationTokens).toBe(17446);
    expect(result.errorCode).toBeUndefined();
  });

  it('7b) error_max_turns SEM cache (0 tokens) continua sendo falha', async () => {
    const noCache = JSON.stringify({
      type: 'result',
      subtype: 'error_max_turns',
      is_error: true,
      session_id: '22df17ba-7d3d-4c0c-ad5d-234a9ad4b03d',
      usage: { cache_creation_input_tokens: 0, cache_read_input_tokens: 0 },
    });
    const exec = ((
      _bin: string,
      _args: string[],
      _opts: unknown,
      cb: (e: Error | null, stdout: string, stderr: string) => void,
    ) => {
      setImmediate(() => cb(Object.assign(new Error('x'), { code: 1, stdout: noCache }), noCache, ''));
      return { on: () => undefined } as never;
    }) as never;

    const result = await warmCache({ projectSlug: 'my-proj' }, makeDeps({ execFileImpl: exec }));

    expect(result.success).toBe(false);
    expect(result.errorCode).toBe('CLAUDE_IS_ERROR');
  });

  it('N4: stderr do CLI com segredo do ambiente → errorMessage redigido', async () => {
    const SECRET = 'sk-ant-WARM-SEGREDO-123456';
    const exec = ((
      _bin: string,
      _args: string[],
      _opts: unknown,
      cb: (e: Error | null, stdout: string, stderr: string) => void,
    ) => {
      const err = Object.assign(new Error('exit 1'), { code: 1, stdout: 'nao-json', stderr: `auth falhou key=${SECRET}` });
      setImmediate(() => cb(err, 'nao-json', `auth falhou key=${SECRET}`));
      return { on: () => undefined } as never;
    }) as never;

    const result = await warmCache(
      { projectSlug: 'my-proj' },
      makeDeps({ execFileImpl: exec, env: { ANTHROPIC_API_KEY: SECRET } }),
    );

    expect(result.errorCode).toBe('CLAUDE_OUTPUT_PARSE_FAILED');
    expect(result.errorMessage).toBe('auth falhou key=[REDACTED]');
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

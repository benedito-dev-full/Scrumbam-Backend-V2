/**
 * Testes unitários — OperacaoExecucaoClaude
 *
 * Cobre: constructor, calcula() (risk gate + command validator),
 * gravarComoAwaitingApproval(), _truncate(), e integração com Risk Gate patterns.
 *
 * MOCKS:
 *   - PrismaService: dVFS.findFirst, $queryRaw, $transaction, dPedido.*
 *   - agentTunnelService: stub (F6) → retorna resultado mock
 *   - eventProducer: stub → addInternalEvent jest.fn()
 *
 * @see ADR-V2-005 (OperacaoExecucaoClaude extends OperacaoPedido)
 * @see ADR-V2-006 (risk via idClasse -301/-302/-303)
 * @see src/engine/dvfs/risk-gate-validator.js
 * @see src/engine/dvfs/command-validator.js
 */

import { Logger } from '@nestjs/common';
import * as fs from 'fs';
import * as path from 'path';
import OperacaoExecucaoClaude from '../OperacaoExecucaoClaude';

// ---- Carrega scripts reais DVFS (chaves 3 e 4) ----
// Testa com os scripts reais para garantir alinhamento com dvfs.seed.ts

// __dirname = src/engine/lib/operacao/__tests__
// dvfs dir  = src/engine/dvfs  → subir 3 níveis para src/engine, depois entrar em dvfs
const DVFS_DIR = path.join(__dirname, '..', '..', '..', 'dvfs');

function readDvfsScript(name: string): string {
  const fullPath = path.join(DVFS_DIR, name);
  return fs.readFileSync(fullPath, 'utf8');
}

// Scripts reais
const riskGateScript = readDvfsScript('risk-gate-validator.js');
const commandValidatorScript = readDvfsScript('command-validator.js');

// ---- Mock builder ----

/**
 * Constrói mock Prisma com scripts DVFS configuráveis por chaveScript.
 * DvfsLoaderHelper faz 2 chamadas por chave: idClasse concreto (null) → fallback -300 (script).
 */
function buildMockPrismaWithScripts(scriptMap: Map<number, string>) {
  return {
    $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(1000001) }]),
    $transaction: jest.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      return fn({
        dPedido: {
          create: jest.fn().mockResolvedValue({ chave: BigInt(1000001) }),
        },
      });
    }),
    dPedido: {
      create: jest.fn().mockResolvedValue({ chave: BigInt(1000001) }),
      update: jest.fn().mockResolvedValue({ chave: BigInt(1000001) }),
    },
    dVFS: {
      findFirst: jest.fn().mockImplementation(({ where }: { where: any }) => {
        const chaveScript = where.chaveScript;
        const conteudo = scriptMap.get(chaveScript);
        if (conteudo !== undefined) {
          return Promise.resolve({ chave: BigInt(100), chaveScript, conteudo, ativo: true });
        }
        return Promise.resolve(null);
      }),
    },
    dProject: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    dTask: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
    dEvento: {
      create: jest.fn().mockResolvedValue({ chave: BigInt(200) }),
    },
  };
}

/**
 * Cria params padrão para OperacaoExecucaoClaude com scripts reais.
 */
function buildDefaultParams(overrides: Partial<{
  commandText: string;
  commandCwd: string;
  mockPrisma: any;
}> = {}) {
  const scriptMap = new Map<number, string>([
    [3, riskGateScript],
    [4, commandValidatorScript],
    [5, '(function(op){})'],
    [6, '(function(op){})'],
    [7, '(function(op){})'],
  ]);

  const mockPrisma = overrides.mockPrisma ?? buildMockPrismaWithScripts(scriptMap);

  return {
    usuario: '42',
    classe: '-300',
    bd: mockPrisma,
    projectId: '100',
    agentId: '200',
    taskId: undefined,
    command: {
      text: overrides.commandText ?? 'adicionar testes unitários no módulo auth',
      cwd: overrides.commandCwd ?? '',
      timeoutMs: 60000,
    },
    correlationId: 'test-corr-001',
    agentTunnelService: {
      runClaudeCode: jest.fn().mockResolvedValue({
        sessionId: 'sess-001',
        sessionPath: '/tmp/sess',
        stdout: 'done',
        stderr: '',
        exitCode: 0,
        headBefore: 'abc',
        headAfter: 'def',
        commitMessage: 'feat: tests',
        pushedAt: new Date().toISOString(),
        filesChanged: 3,
      }),
    },
    eventProducer: {
      addInternalEvent: jest.fn().mockResolvedValue(undefined),
    },
  };
}

// ---- Setup global ----

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

// ---- Testes ----

describe('OperacaoExecucaoClaude — constructor', () => {
  it('deve inicializar projectId, agentId, correlationId como BigInt/string', () => {
    const params = buildDefaultParams();
    const op = new OperacaoExecucaoClaude(params as any);

    expect((op as any).projectId).toBe(BigInt(100));
    expect((op as any).agentId).toBe(BigInt(200));
    expect((op as any).correlationId).toBe('test-corr-001');
  });

  it('deve inicializar dados.command e dados.audit corretamente', () => {
    const params = buildDefaultParams({ commandText: 'my command' });
    const op = new OperacaoExecucaoClaude(params as any);

    expect(op.dados.command.text).toBe('my command');
    expect(op.dados.audit?.correlationId).toBe('test-corr-001');
    expect(op.dados.audit?.triggeredBy).toBe('42');
    expect(op.dados.audit?.agentId).toBe('200');
    expect(op.dados.audit?.projectId).toBe('100');
  });

  it('não deve populaR dados.task se taskId não fornecido', () => {
    const params = buildDefaultParams();
    const op = new OperacaoExecucaoClaude(params as any);
    expect(op.dados.task).toBeUndefined();
  });

  it('deve popular dados.task se taskId fornecido', () => {
    const params = buildDefaultParams();
    (params as any).taskId = '999';
    const op = new OperacaoExecucaoClaude(params as any);
    expect(op.dados.task?.id).toBe('999');
    expect((op as any).taskId).toBe(BigInt(999));
  });
});

describe('OperacaoExecucaoClaude — Risk Gate via script DVFS chave=3', () => {
  it('deve classificar LOW para texto genérico sem patterns', async () => {
    const params = buildDefaultParams({ commandText: 'adicionar comentários no código' });
    const op = new OperacaoExecucaoClaude(params as any);

    await op.nova();
    await op.calcula();

    expect(op.dados.risk?.level).toBe('LOW');
    expect((op as any)._classeBase).toBe('-301');
  });

  it('deve classificar HIGH para texto com "rm -rf"', async () => {
    const params = buildDefaultParams({ commandText: 'execute rm -rf /tmp/test' });
    const op = new OperacaoExecucaoClaude(params as any);

    await op.nova();
    await op.calcula();

    expect(op.dados.risk?.level).toBe('HIGH');
    expect((op as any)._classeBase).toBe('-303');
  });

  it('deve classificar HIGH para "DROP TABLE"', async () => {
    const params = buildDefaultParams({ commandText: 'run DROP TABLE users' });
    const op = new OperacaoExecucaoClaude(params as any);

    await op.nova();
    await op.calcula();

    expect(op.dados.risk?.level).toBe('HIGH');
  });

  it('deve classificar MEDIUM para texto com "git reset --hard"', async () => {
    const params = buildDefaultParams({ commandText: 'executar git reset --hard origin/main' });
    const op = new OperacaoExecucaoClaude(params as any);

    await op.nova();
    await op.calcula();

    expect(op.dados.risk?.level).toBe('MEDIUM');
    expect((op as any)._classeBase).toBe('-302');
  });

  it('deve classificar HIGH para "TRUNCATE TABLE" (Task 2: expandido para HIGH)', async () => {
    // Task 2: TRUNCATE promovido para HIGH (perda total de dados, irreversível)
    // Na Task 1 era MEDIUM mas o plano de expansão (25 HIGH) inclui TRUNCATE
    const params = buildDefaultParams({ commandText: 'TRUNCATE TABLE sessions' });
    const op = new OperacaoExecucaoClaude(params as any);

    await op.nova();
    await op.calcula();

    expect(op.dados.risk?.level).toBe('HIGH');
  });

  it('deve popular matchedPatterns após classificação HIGH', async () => {
    const params = buildDefaultParams({ commandText: 'git push --force origin main' });
    const op = new OperacaoExecucaoClaude(params as any);

    await op.nova();
    await op.calcula();

    expect(op.dados.risk?.level).toBe('HIGH');
    expect(op.dados.risk?.matchedPatterns.length).toBeGreaterThan(0);
    expect(op.dados.risk?.classifiedAt).toBeTruthy();
  });
});

describe('OperacaoExecucaoClaude — Command Validator via script DVFS chave=4', () => {
  it('deve rejeitar cwd com ".." (path traversal)', async () => {
    const params = buildDefaultParams({ commandCwd: '../../../etc' });
    const op = new OperacaoExecucaoClaude(params as any);

    await op.nova();

    await expect(op.calcula()).rejects.toThrow(/path traversal|Path traversal/i);
  });

  it('deve rejeitar command.text vazio', async () => {
    const params = buildDefaultParams({ commandText: '   ' });
    const op = new OperacaoExecucaoClaude(params as any);

    await op.nova();

    await expect(op.calcula()).rejects.toThrow(/command.text|vazio/i);
  });

  it('deve rejeitar command.text > 50000 caracteres', async () => {
    const longText = 'a'.repeat(50001);
    const params = buildDefaultParams({ commandText: longText });
    const op = new OperacaoExecucaoClaude(params as any);

    await op.nova();

    await expect(op.calcula()).rejects.toThrow(/50000/);
  });

  it('deve aceitar cwd vazio (sem path traversal)', async () => {
    const params = buildDefaultParams({ commandCwd: '', commandText: 'refactor auth module' });
    const op = new OperacaoExecucaoClaude(params as any);

    await op.nova();
    await expect(op.calcula()).resolves.not.toThrow();
  });
});

describe('OperacaoExecucaoClaude — gravarComoAwaitingApproval', () => {
  it('deve setar dados.approval.status = awaiting_approval', async () => {
    const params = buildDefaultParams({ commandText: 'git push --force origin main' });
    const op = new OperacaoExecucaoClaude(params as any);

    await op.nova();
    await op.calcula(); // classifica HIGH

    await op.gravarComoAwaitingApproval();

    expect(op.dados.approval?.status).toBe('awaiting_approval');
    expect(op.dados.approval?.expiresAt).toBeTruthy();
  });

  it('deve popular expiresAt com 1h por default', async () => {
    const params = buildDefaultParams({ commandText: 'rm -rf /tmp/something' });
    const op = new OperacaoExecucaoClaude(params as any);

    const before = Date.now();
    await op.nova();
    await op.calcula();
    await op.gravarComoAwaitingApproval();

    const expiresAt = new Date(op.dados.approval!.expiresAt!).getTime();
    const expectedMin = before + 3600000 - 1000; // 1h - 1s margem
    const expectedMax = before + 3600000 + 1000; // 1h + 1s margem
    expect(expiresAt).toBeGreaterThanOrEqual(expectedMin);
    expect(expiresAt).toBeLessThanOrEqual(expectedMax);
  });
});

describe('OperacaoExecucaoClaude — _truncate (privado, acesso via cast)', () => {
  it('deve retornar string original se <= maxBytes', () => {
    const params = buildDefaultParams();
    const op = new OperacaoExecucaoClaude(params as any);
    const truncate = (op as any)._truncate.bind(op);

    const result = truncate('hello world', 100);
    expect(result).toBe('hello world');
  });

  it('deve truncar string > maxBytes e adicionar sufixo [TRUNCATED]', () => {
    const params = buildDefaultParams();
    const op = new OperacaoExecucaoClaude(params as any);
    const truncate = (op as any)._truncate.bind(op);

    const bigStr = 'a'.repeat(200);
    const result = truncate(bigStr, 100);

    expect(result).toContain('[TRUNCATED]');
    expect(Buffer.byteLength(result, 'utf8')).toBeGreaterThan(100);
    // O início deve ter os primeiros 100 bytes
    expect(result.startsWith('a')).toBe(true);
  });

  it('deve retornar undefined se entrada é undefined', () => {
    const params = buildDefaultParams();
    const op = new OperacaoExecucaoClaude(params as any);
    const truncate = (op as any)._truncate.bind(op);

    expect(truncate(undefined, 1024)).toBeUndefined();
  });
});

describe('OperacaoExecucaoClaude — aprova() e dados.approval', () => {
  it('deve setar approval.status = approved após aprova()', async () => {
    const params = buildDefaultParams({ commandText: 'adicionar logs no módulo tasks' });
    const op = new OperacaoExecucaoClaude(params as any);

    await op.nova();
    await op.calcula();
    await op.aprova({ aprovador: 'auto:risk-gate-low' });

    expect(op.dados.approval?.status).toBe('approved');
    expect(op.dados.approval?.approvedBy).toBe('auto:risk-gate-low');
    expect(op.dados.approval?.decidedAt).toBeTruthy();
  });
});

describe('OperacaoExecucaoClaude — setExecucaoData', () => {
  it('deve mesclar dados sem sobrescrever campos existentes', () => {
    const params = buildDefaultParams({ commandText: 'original command' });
    const op = new OperacaoExecucaoClaude(params as any);

    op.setExecucaoData({ risk: { level: 'LOW', explanation: 'OK', matchedPatterns: [], classifiedAt: '2026-01-01T00:00:00Z' } });

    expect(op.dados.command.text).toBe('original command');
    expect(op.dados.risk?.level).toBe('LOW');
    expect(op.dados.audit?.correlationId).toBe('test-corr-001');
  });
});

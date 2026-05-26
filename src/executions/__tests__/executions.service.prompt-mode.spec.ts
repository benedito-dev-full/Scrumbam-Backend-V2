/* eslint-disable @typescript-eslint/no-explicit-any */
import { Logger } from '@nestjs/common';
import { ExecutionsService } from '../executions.service';
import { ExecuteCommandDto } from '../dto/execute-command.dto';
import { CommandValidatorService } from '../services/command-validator.service';

/**
 * Integration test do modo PROMPT do ExecutionsService (ADR-V2-049).
 *
 * Cobre fluxo end-to-end interno: dto `{ taskId }` →
 *   PromptBuilderService.buildFromTaskId() →
 *   OperacaoExecucaoClaude com `prompt` + `taskType` →
 *   dados.prompt + dados.taskType persistidos no DPedido (snapshot mockado).
 *
 * Padrão de mocking idêntico ao `executions.service.unit.spec.ts` (incluindo
 * DVFS chaves 3-7 stubadas) para que `op.calcula()` e `op.grava()` não
 * lancem. Capturamos o `dados` final via spy em `dPedido.findFirst` (que é
 * chamado APÓS Engine persistir).
 */
beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

function buildRiskGateScript(riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'): string {
  return `(async function riskGateValidator(op) {
    if (!op.dados) op.dados = {};
    op.dados.risk = {
      level: '${riskLevel}',
      explanation: 'Mock: ${riskLevel}',
      matchedPatterns: [],
      classifiedAt: new Date().toISOString()
    };
  })`;
}

function buildService() {
  // Snapshot do "DPedido persistido" após op.grava() — capturado pelo create do $transaction
  const persisted: { dados: any } = { dados: null };

  const mockPrisma: any = {
    dProject: {
      findFirst: jest.fn().mockResolvedValue({ chave: BigInt(100), dados: {}, excluido: false }),
    },
    dVincula: {
      findFirst: jest.fn().mockImplementation(({ where }: { where: any }) => {
        if (where?.idClasse === BigInt(-185)) {
          // primary agent link
          return Promise.resolve({
            chave: BigInt(900),
            entidade: {
              chave: BigInt(100),
              dados: { statusCode: '-510', tunnelPort: 20000 },
            },
          });
        }
        // membership ok
        return Promise.resolve({ idClasse: BigInt(-171) });
      }),
    },
    dPedido: {
      findFirst: jest.fn().mockImplementation(() =>
        Promise.resolve({
          chave: BigInt(1000001),
          idClasse: BigInt(-301),
          idPessoa: BigInt(42),
          dados: persisted.dados,
          criadoEm: new Date(),
          atualizadoEm: new Date(),
        }),
      ),
      update: jest.fn().mockResolvedValue({}),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(1000001) }]),
    $transaction: jest.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) =>
      fn({
        dPedido: {
          create: jest.fn().mockImplementation(({ data }: any) => {
            persisted.dados = data?.dados ?? null;
            return Promise.resolve({ chave: BigInt(1000001) });
          }),
        },
      }),
    ),
    dVFS: {
      findFirst: jest.fn().mockImplementation(({ where }: { where: any }) => {
        const scripts: Record<number, string> = {
          3: buildRiskGateScript('LOW'),
          4: '(async function commandValidator(op) {})',
          5: '(async function posCalculo(op) {})',
          6: '(async function preGravacao(op) {})',
          7: '(async function posGravacao(op) {})',
        };
        const conteudo = scripts[where.chaveScript];
        return conteudo
          ? Promise.resolve({
              chave: BigInt(100),
              chaveScript: where.chaveScript,
              conteudo,
              ativo: true,
            })
          : Promise.resolve(null);
      }),
    },
    dEvento: {
      create: jest.fn().mockResolvedValue({ chave: BigInt(200) }),
    },
  };

  const mockEntidade = {
    getEntidadeIdFromUserGroup: jest.fn().mockResolvedValue(BigInt(42)),
  };
  const mockClaude = {
    runClaudeCode: jest.fn().mockResolvedValue({ exitCode: 0 }),
  };
  const mockEventProducer = { addInternalEvent: jest.fn() };
  const mockCommandValidator = { validate: jest.fn(), validateText: jest.fn() };
  const mockAgentTunnel = {
    probe: jest.fn().mockResolvedValue({ tunnelOk: true, latencyMs: 1 }),
  };
  const mockExecutionQueue = {
    enqueueExecution: jest.fn().mockResolvedValue(undefined),
  };
  const mockPromptBuilder = {
    buildFromTaskId: jest.fn().mockResolvedValue({
      prompt:
        'Você é um agente de automação do Scrumban. Implemente a task abaixo.\n\nTask #42 — criar AGENT_TEST.md\n\nCriterios: faça TODAS as mudanças.',
      taskType: 'code',
      taskName: 'criar AGENT_TEST.md',
    }),
  };

  const service = new ExecutionsService(
    mockPrisma as any,
    mockEntidade as any,
    mockClaude as any,
    mockEventProducer as any,
    mockCommandValidator as any,
    mockAgentTunnel as any,
    mockExecutionQueue as any,
    mockPromptBuilder as any,
  );

  return {
    service,
    persisted,
    mockPrisma,
    mockPromptBuilder,
    mockCommandValidator,
    mockExecutionQueue,
  };
}

describe('ExecutionsService — modo PROMPT (ADR-V2-049)', () => {
  it('chama PromptBuilder.buildFromTaskId quando dto.taskId presente', async () => {
    const { service, mockPromptBuilder } = buildService();
    const dto: ExecuteCommandDto = { taskId: '42' };

    await service.execute('100', dto, '7');

    expect(mockPromptBuilder.buildFromTaskId).toHaveBeenCalledTimes(1);
    expect(mockPromptBuilder.buildFromTaskId).toHaveBeenCalledWith('42', '100', '7');
  });

  it('persiste dados.prompt e dados.taskType no DPedido (modo PROMPT)', async () => {
    const { service, persisted } = buildService();
    const dto: ExecuteCommandDto = { taskId: '42' };

    await service.execute('100', dto, '7');

    expect(persisted.dados).toBeTruthy();
    expect(persisted.dados.prompt).toContain('agente de automação do Scrumban');
    expect(persisted.dados.prompt).toContain('Task #42 — criar AGENT_TEST.md');
    expect(persisted.dados.taskType).toBe('code');
    // dados.task.id é populado para rastreamento
    expect(persisted.dados.task?.id).toBe('42');
    // dados.command ainda existe (placeholder estruturado p/ CommandValidator)
    expect(persisted.dados.command.executable).toBe('claude');
    expect(persisted.dados.command.args[0]).toBe('-p');
    // Reviewer fix C1: args[1] é o marker simbólico, não o prompt real.
    expect(persisted.dados.command.args[1]).toBe('task-built-prompt-placeholder');
  });

  it('NÃO chama PromptBuilder quando dto.command presente (modo COMMAND)', async () => {
    const { service, mockPromptBuilder, persisted } = buildService();
    const dto: ExecuteCommandDto = {
      command: {
        executable: 'npm',
        args: ['test'],
        timeoutMs: 60000,
      },
    };

    await service.execute('100', dto, '7');

    expect(mockPromptBuilder.buildFromTaskId).not.toHaveBeenCalled();
    expect(persisted.dados.prompt).toBeUndefined();
    expect(persisted.dados.taskType).toBeUndefined();
    expect(persisted.dados.command.executable).toBe('npm');
  });

  it('NÃO chama PromptBuilder no modo HÍBRIDO (taskId + command — command vence)', async () => {
    const { service, mockPromptBuilder, persisted } = buildService();
    const dto: ExecuteCommandDto = {
      taskId: '42',
      command: {
        executable: 'claude',
        args: ['-p', 'manual override'],
        timeoutMs: 600000,
      },
    };

    await service.execute('100', dto, '7');

    expect(mockPromptBuilder.buildFromTaskId).not.toHaveBeenCalled();
    // No híbrido: dados.task.id é populado (audit) mas prompt fica vazio
    expect(persisted.dados.task?.id).toBe('42');
    expect(persisted.dados.prompt).toBeUndefined();
    expect(persisted.dados.command.args[1]).toBe('manual override');
  });

  it('valida command estruturado mesmo no modo PROMPT (CommandValidator é chamado)', async () => {
    const { service, mockCommandValidator } = buildService();
    const dto: ExecuteCommandDto = { taskId: '42' };

    await service.execute('100', dto, '7');

    expect(mockCommandValidator.validate).toHaveBeenCalledTimes(1);
    const arg = mockCommandValidator.validate.mock.calls[0][0];
    expect(arg.executable).toBe('claude');
    expect(arg.args[0]).toBe('-p');
    // Reviewer fix C1: args[1] agora é o marker simbólico `<task-built-prompt>`
    // (sem metacaracteres) — o prompt REAL fica em dados.prompt.
    expect(arg.args[1]).toBe('task-built-prompt-placeholder');
  });

  /**
   * Reviewer fix C1 + M1 (review-2026-05-26-prompt-builder.md):
   *
   * Garante que o placeholder gerado pelo modo PROMPT passa pelo
   * `CommandValidatorService` REAL (não mockado). Antes do fix, o prompt
   * natural com parênteses (`(3-5 linhas)`) batia em
   * `DANGEROUS_CHARS = /[|&;\`$()<>]/` e o `validate()` lançava
   * `BadRequestException` — toda execução em modo PROMPT virava 400 em
   * produção. Mock do CommandValidator mascarou o bug nos testes existentes.
   */
  it('placeholder do modo PROMPT passa pelo CommandValidatorService REAL sem rejeição (fix C1)', async () => {
    const persisted: { dados: any } = { dados: null };
    const mockPrisma: any = {
      dProject: {
        findFirst: jest.fn().mockResolvedValue({ chave: BigInt(100), dados: {}, excluido: false }),
      },
      dVincula: {
        findFirst: jest.fn().mockImplementation(({ where }: { where: any }) => {
          if (where?.idClasse === BigInt(-185)) {
            return Promise.resolve({
              chave: BigInt(900),
              entidade: {
                chave: BigInt(100),
                dados: { statusCode: '-510', tunnelPort: 20000 },
              },
            });
          }
          return Promise.resolve({ idClasse: BigInt(-171) });
        }),
      },
      dPedido: {
        findFirst: jest.fn().mockImplementation(() =>
          Promise.resolve({
            chave: BigInt(1000001),
            idClasse: BigInt(-301),
            idPessoa: BigInt(42),
            dados: persisted.dados,
            criadoEm: new Date(),
            atualizadoEm: new Date(),
          }),
        ),
        update: jest.fn().mockResolvedValue({}),
      },
      $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(1000001) }]),
      $transaction: jest.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) =>
        fn({
          dPedido: {
            create: jest.fn().mockImplementation(({ data }: any) => {
              persisted.dados = data?.dados ?? null;
              return Promise.resolve({ chave: BigInt(1000001) });
            }),
          },
        }),
      ),
      dVFS: {
        findFirst: jest.fn().mockImplementation(({ where }: { where: any }) => {
          const scripts: Record<number, string> = {
            3: buildRiskGateScript('LOW'),
            4: '(async function commandValidator(op) {})',
            5: '(async function posCalculo(op) {})',
            6: '(async function preGravacao(op) {})',
            7: '(async function posGravacao(op) {})',
          };
          const conteudo = scripts[where.chaveScript];
          return conteudo
            ? Promise.resolve({
                chave: BigInt(100),
                chaveScript: where.chaveScript,
                conteudo,
                ativo: true,
              })
            : Promise.resolve(null);
        }),
      },
      dEvento: { create: jest.fn().mockResolvedValue({ chave: BigInt(200) }) },
    };
    const mockEntidade = {
      getEntidadeIdFromUserGroup: jest.fn().mockResolvedValue(BigInt(42)),
    };
    const mockClaude = { runClaudeCode: jest.fn().mockResolvedValue({ exitCode: 0 }) };
    const mockEventProducer = { addInternalEvent: jest.fn() };
    const mockAgentTunnel = {
      probe: jest.fn().mockResolvedValue({ tunnelOk: true, latencyMs: 1 }),
    };
    const mockExecutionQueue = { enqueueExecution: jest.fn().mockResolvedValue(undefined) };
    // Mock PromptBuilder retorna prompt COM parênteses + metacaracteres (caso real)
    const mockPromptBuilder = {
      buildFromTaskId: jest.fn().mockResolvedValue({
        prompt:
          'Você é um agente de automação do Scrumban. Implemente a task abaixo (3-5 linhas) — execute o que precisar e retorne $resultado.',
        taskType: 'code',
        taskName: 'criar AGENT_TEST.md',
      }),
    };

    // CommandValidator REAL (não mockado).
    const realCommandValidator = new CommandValidatorService();
    const validateSpy = jest.spyOn(realCommandValidator, 'validate');

    const service = new ExecutionsService(
      mockPrisma,
      mockEntidade as any,
      mockClaude as any,
      mockEventProducer as any,
      realCommandValidator,
      mockAgentTunnel as any,
      mockExecutionQueue as any,
      mockPromptBuilder as any,
    );

    const dto: ExecuteCommandDto = { taskId: '42' };

    // Não deve lançar BadRequestException — placeholder simbólico passa.
    await expect(service.execute('100', dto, '7')).resolves.toBeTruthy();

    // Garante que o validador REAL foi chamado e não rejeitou.
    expect(validateSpy).toHaveBeenCalledTimes(1);
    const arg = validateSpy.mock.calls[0][0];
    expect(arg.executable).toBe('claude');
    expect(arg.args[1]).toBe('task-built-prompt-placeholder');

    // Defense-in-depth: o prompt REAL (com parênteses e $) fica em dados.prompt,
    // NÃO em args[1]. Garante que a sanitização do CommandValidator não
    // alcança o prompt natural.
    expect(persisted.dados.prompt).toContain('(3-5 linhas)');
    expect(persisted.dados.prompt).toContain('$resultado');
    expect(persisted.dados.command.args[1]).toBe('task-built-prompt-placeholder');
  });

  it('LOW risk → execução enfileirada (modo PROMPT)', async () => {
    const { service, mockExecutionQueue } = buildService();
    const dto: ExecuteCommandDto = { taskId: '42' };

    await service.execute('100', dto, '7');

    expect(mockExecutionQueue.enqueueExecution).toHaveBeenCalledTimes(1);
  });

  it('lança UnprocessableEntityException quando nem taskId nem command presentes', async () => {
    const { service } = buildService();
    const dto: ExecuteCommandDto = {};

    await expect(service.execute('100', dto, '7')).rejects.toThrow(
      /taskId.*command|command.*taskId/i,
    );
  });
});

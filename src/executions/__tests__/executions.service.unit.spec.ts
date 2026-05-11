import { ForbiddenException, Logger, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { ExecutionsService } from '../executions.service';
import { ExecuteCommandDto } from '../dto/execute-command.dto';

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

function buildService(overrides: {
  riskLevel?: 'LOW' | 'MEDIUM' | 'HIGH';
  projectExists?: boolean;
  membershipExists?: boolean;
  agentId?: string | null;
} = {}) {
  const {
    riskLevel = 'LOW',
    projectExists = true,
    membershipExists = true,
    agentId = '100',
  } = overrides;

  const mockPrisma = {
    dProject: {
      findFirst: jest.fn().mockResolvedValue(
        projectExists ? { chave: BigInt(100), dados: {}, excluido: false } : null,
      ),
    },
    dVincula: {
      findFirst: jest.fn().mockImplementation(({ where }: { where: any }) => {
        if (where?.idClasse === BigInt(-185)) {
          return Promise.resolve(agentId !== null
            ? {
                chave: BigInt(900),
                entidade: {
                  chave: BigInt(agentId),
                  dados: { statusCode: '-510', tunnelPort: 20000 },
                },
              }
            : null);
        }

        return Promise.resolve(membershipExists ? { idClasse: BigInt(-171) } : null);
      }),
    },
    dPedido: {
      findFirst: jest.fn().mockResolvedValue(null),
      update: jest.fn().mockResolvedValue({ chave: BigInt(1000001), dados: {}, criadoEm: new Date(), atualizadoEm: new Date() }),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(1000001) }]),
    $transaction: jest.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => fn({
      dPedido: {
        create: jest.fn().mockResolvedValue({ chave: BigInt(1000001) }),
      },
    })),
    dVFS: {
      findFirst: jest.fn().mockImplementation(({ where }: { where: any }) => {
        const scripts: Record<number, string> = {
          3: buildRiskGateScript(riskLevel),
          4: '(async function commandValidator(op) {})',
          5: '(async function posCalculo(op) {})',
          6: '(async function preGravacao(op) {})',
          7: '(async function posGravacao(op) {})',
        };
        const conteudo = scripts[where.chaveScript];
        return conteudo ? Promise.resolve({ chave: BigInt(100), chaveScript: where.chaveScript, conteudo, ativo: true }) : Promise.resolve(null);
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
    runClaudeCode: jest.fn().mockResolvedValue({
      exitCode: 0,
      headBefore: 'abc1234',
      headAfter: 'abc1234',
      stdout: '[STUB] done',
      stderr: '',
    }),
  };
  const mockEventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };
  const mockCommandValidator = { validate: jest.fn(), validateText: jest.fn() };
  const mockAgentTunnel = {
    probe: jest.fn().mockResolvedValue({ tunnelOk: true, latencyMs: 1 }),
  };
  const mockExecutionQueue = {
    enqueueExecution: jest.fn().mockResolvedValue(undefined),
  };

  const service = new ExecutionsService(
    mockPrisma as any,
    mockEntidade as any,
    mockClaude as any,
    mockEventProducer as any,
    mockCommandValidator as any,
    mockAgentTunnel as any,
    mockExecutionQueue as any,
  );

  return { service, mockPrisma, mockCommandValidator, mockAgentTunnel, mockExecutionQueue };
}

describe('ExecutionsService.execute()', () => {
  const baseDto: ExecuteCommandDto = {
    command: {
      executable: 'npm',
      args: ['test'],
      cwd: '.',
      timeoutMs: 600000,
    },
  };

  it('deve lancar NotFoundException se projeto nao existe', async () => {
    const { service } = buildService({ projectExists: false });

    await expect(service.execute('100', baseDto, '1')).rejects.toThrow(NotFoundException);
  });

  it('deve lancar ForbiddenException se user nao e membro', async () => {
    const { service } = buildService({ membershipExists: false });

    await expect(service.execute('100', baseDto, '1')).rejects.toThrow(ForbiddenException);
  });

  it('deve lancar UnprocessableEntityException se agent primary nao existe', async () => {
    const { service } = buildService({ agentId: null });

    await expect(service.execute('100', baseDto, '1')).rejects.toThrow(UnprocessableEntityException);
  });

  it('deve criar execution LOW como queued e enfileirar job', async () => {
    const { service, mockPrisma, mockExecutionQueue } = buildService({ riskLevel: 'LOW' });
    mockPrisma.dPedido.findFirst.mockResolvedValue({
      chave: BigInt(1000001),
      idClasse: BigInt(-301),
      idPessoa: BigInt(42),
      dados: {
        approval: { status: 'queued' },
        command: { text: 'npm test', executable: 'npm', args: ['test'] },
        audit: { projectId: '100', triggeredBy: '42', agentId: '100', correlationId: 'test' },
        risk: { level: 'LOW', matchedPatterns: [] },
        riskLevelCode: '-525',
      },
      criadoEm: new Date(),
      atualizadoEm: new Date(),
    });

    const result = await service.execute('100', baseDto, '1');

    expect(result.riskLevel).toBe('LOW');
    expect(result.approval.status).toBe('queued');
    expect(mockExecutionQueue.enqueueExecution).toHaveBeenCalledWith({
      executionId: '1000001',
      projectId: '100',
      agentId: '100',
    });
  });

  it('deve persistir MEDIUM como awaiting_approval', async () => {
    const { service, mockPrisma } = buildService({ riskLevel: 'MEDIUM' });
    mockPrisma.dPedido.findFirst.mockResolvedValue({
      chave: BigInt(1000002),
      idClasse: BigInt(-302),
      idPessoa: BigInt(42),
      dados: {
        approval: { status: 'awaiting_approval' },
        command: { text: 'npm test', executable: 'npm', args: ['test'] },
        audit: { projectId: '100', triggeredBy: '42', agentId: '100', correlationId: 'test' },
        risk: { level: 'MEDIUM', matchedPatterns: [] },
        riskLevelCode: '-526',
      },
      criadoEm: new Date(),
      atualizadoEm: new Date(),
    });

    const result = await service.execute('100', baseDto, '1');

    expect(result.riskLevel).toBe('MEDIUM');
    expect(result.approval.status).toBe('awaiting_approval');
    expect(result.approval.approvedBy).toBeUndefined();
  });

  it('deve persistir HIGH como awaiting_approval', async () => {
    const { service, mockPrisma } = buildService({ riskLevel: 'HIGH' });
    mockPrisma.dPedido.findFirst.mockResolvedValue({
      chave: BigInt(1000003),
      idClasse: BigInt(-303),
      idPessoa: BigInt(42),
      dados: {
        approval: { status: 'awaiting_approval' },
        command: { text: 'npm test', executable: 'npm', args: ['test'] },
        audit: { projectId: '100', triggeredBy: '42', agentId: '100', correlationId: 'test' },
        risk: { level: 'HIGH', matchedPatterns: [] },
        riskLevelCode: '-527',
      },
      criadoEm: new Date(),
      atualizadoEm: new Date(),
    });

    const result = await service.execute('100', baseDto, '1');

    expect(result.riskLevel).toBe('HIGH');
    expect(result.approval.status).toBe('awaiting_approval');
  });

  it('deve validar comando antes do Engine', async () => {
    const { service, mockCommandValidator } = buildService({ riskLevel: 'LOW' });

    await service.execute('100', baseDto, '1');

    expect(mockCommandValidator.validate).toHaveBeenCalledWith(baseDto.command);
  });

  it('nao deve criar DPedido quando validator rejeita comando', async () => {
    const { service, mockPrisma, mockCommandValidator } = buildService({ riskLevel: 'LOW' });
    mockCommandValidator.validate.mockImplementation(() => {
      throw new UnprocessableEntityException('comando rejeitado');
    });

    await expect(service.execute('100', baseDto, '1')).rejects.toThrow(UnprocessableEntityException);

    expect(mockPrisma.$queryRaw).not.toHaveBeenCalled();
    expect(mockPrisma.$transaction).not.toHaveBeenCalled();
  });
});

/**
 * Testes unitários — ApprovalFlowService
 *
 * Cobre: approve(), reject(), rollback() — incluindo race condition.
 *
 * @see src/executions/approval-flow.service.ts
 */

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ApprovalFlowService } from '../approval-flow.service';
import { RejectExecutionDto } from '../dto/reject-execution.dto';
import { ApproveExecutionDto } from '../dto/approve-execution.dto';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

// ---- Builders ----

function buildPedidoAwaitingApproval(overrides: object = {}) {
  return {
    chave: BigInt(1000001),
    idClasse: BigInt(-303),
    idPessoa: BigInt(42),
    idLocEscritu: BigInt(100),
    aprovado: false,
    baixado: false,
    dados: {
      approval: {
        status: 'awaiting_approval',
        expiresAt: new Date(Date.now() + 3600000).toISOString(),
      },
      command: { text: 'DROP TABLE users' },
      audit: {
        projectId: '100',
        agentId: '100',
        triggeredBy: '42',
        correlationId: 'test-corr-001',
      },
      risk: { level: 'HIGH', matchedPatterns: [{ pattern: '/DROP/', level: 'HIGH' }] },
    },
    criadoEm: new Date(),
    atualizadoEm: new Date(),
    ...overrides,
  };
}

function buildMockPrismaForApproval(overrides: {
  pedido?: object | null;
  executeRawCount?: number;
  membershipClass?: bigint;
} = {}) {
  const {
    pedido = buildPedidoAwaitingApproval(),
    executeRawCount = 1,
    membershipClass = BigInt(-171),
  } = overrides;

  let findFirstCallCount = 0;
  const updatedPedido = pedido
    ? {
        ...(pedido as any),
        aprovado: true,
        dados: {
          ...(pedido as any).dados,
          approval: {
            ...(pedido as any).dados.approval,
            status: 'approved',
            approvedBy: '42',
            decidedAt: new Date().toISOString(),
          },
        },
      }
    : null;

  return {
    dPedido: {
      findFirst: jest.fn().mockImplementation(() => {
        findFirstCallCount++;
        // Segunda chamada retorna pedido atualizado
        if (findFirstCallCount >= 2 && updatedPedido) {
          return Promise.resolve(updatedPedido);
        }
        return Promise.resolve(pedido);
      }),
      update: jest.fn().mockResolvedValue(updatedPedido),
    },
    dVincula: {
      findFirst: jest.fn().mockResolvedValue(
        membershipClass ? { idClasse: membershipClass } : null,
      ),
    },
    $executeRaw: jest.fn().mockResolvedValue(executeRawCount),
    $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(1000002) }]),
    $transaction: jest.fn().mockImplementation(async (fn: any) => {
      return fn({
        dPedido: {
          create: jest.fn().mockResolvedValue({ chave: BigInt(1000002) }),
        },
      });
    }),
    dVFS: {
      findFirst: jest.fn().mockResolvedValue(null),
    },
  };
}

function buildMockEntidadeService(entidadeId = BigInt(42)) {
  return {
    getEntidadeIdFromUserGroup: jest.fn().mockResolvedValue(entidadeId),
  };
}

function buildApprovalService(prismaOverrides = {}) {
  const mockPrisma = buildMockPrismaForApproval(prismaOverrides as any);
  const mockEntidade = buildMockEntidadeService();
  const mockEventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };
  const mockExecutionQueue = { enqueueExecution: jest.fn().mockResolvedValue(undefined) };

  const service = new ApprovalFlowService(
    mockPrisma as any,
    mockEntidade as any,
    mockEventProducer as any,
    mockExecutionQueue as any,
  );

  return { service, mockPrisma, mockEntidade, mockEventProducer, mockExecutionQueue };
}

// ---- Testes: approve() ----

describe('ApprovalFlowService.approve()', () => {
  it('deve falhar fechado mesmo se execution nao existe', async () => {
    const { service } = buildApprovalService({ pedido: null });

    await expect(
      service.approve('9999', '1', {}),
    ).rejects.toThrow(NotFoundException);
  });

  it('deve lançar BadRequestException se execution não está em awaiting_approval', async () => {
    const pedidoAprovado = buildPedidoAwaitingApproval({
      dados: {
        approval: { status: 'approved', approvedBy: '99' },
        command: { text: 'test' },
        audit: { projectId: '100', agentId: 'a', triggeredBy: '42', correlationId: 'c' },
      },
    });

    const { service } = buildApprovalService({ pedido: pedidoAprovado });

    await expect(
      service.approve('1000001', '1', {}),
    ).rejects.toThrow(BadRequestException);
  });

  it('deve lançar ForbiddenException se user não é MANAGER', async () => {
    const { service } = buildApprovalService({
      membershipClass: null,
    } as any);

    await expect(
      service.approve('1000001', '1', {}),
    ).rejects.toThrow(ForbiddenException);
  });

  it('deve lançar ConflictException em race condition (executeRaw retorna 0)', async () => {
    const { service } = buildApprovalService({ executeRawCount: 0 });

    await expect(
      service.approve('1000001', '1', {}),
    ).rejects.toThrow(ConflictException);
  });

  it('deve retornar ExecutionResponseDto após aprovação bem-sucedida', async () => {
    const { service, mockEventProducer, mockExecutionQueue } = buildApprovalService();
    const dto: ApproveExecutionDto = { notes: 'Aprovado após revisão' };

    const result = await service.approve('1000001', '1', dto);

    expect(result).toBeDefined();
    expect(result.id).toBeDefined();
    expect(result.riskLevel).toBeDefined();
    expect(mockEventProducer.addInternalEvent).toHaveBeenCalledWith(
      'execution.approved',
      expect.objectContaining({ executionId: '1000001', approvedBy: '42' }),
      'test-corr-001',
      { source: ApprovalFlowService.name },
    );
    expect(mockExecutionQueue.enqueueExecution).toHaveBeenCalledWith({
      executionId: '1000001',
      projectId: '100',
      agentId: '100',
    });
  });
});

// ---- Testes: reject() ----

describe('ApprovalFlowService.reject()', () => {
  it('deve falhar fechado mesmo se execution nao existe', async () => {
    const { service } = buildApprovalService({ pedido: null });

    const dto: RejectExecutionDto = { reason: 'Operação irreversível no banco' };
    await expect(
      service.reject('9999', '1', dto),
    ).rejects.toThrow(NotFoundException);
  });

  it('deve lançar BadRequestException se não está em awaiting_approval', async () => {
    const pedidoRejeitado = buildPedidoAwaitingApproval({
      dados: {
        approval: { status: 'rejected', rejectedBy: '99' },
        command: { text: 'test' },
        audit: { projectId: '100', agentId: 'a', triggeredBy: '42', correlationId: 'c' },
      },
    });

    const { service } = buildApprovalService({ pedido: pedidoRejeitado });

    const dto: RejectExecutionDto = { reason: 'Operação irreversível no banco de dados' };
    await expect(
      service.reject('1000001', '1', dto),
    ).rejects.toThrow(BadRequestException);
  });

  it('deve lançar ConflictException em race condition (executeRaw retorna 0)', async () => {
    const { service } = buildApprovalService({ executeRawCount: 0 });

    const dto: RejectExecutionDto = { reason: 'Operação muito arriscada para produção' };
    await expect(
      service.reject('1000001', '1', dto),
    ).rejects.toThrow(ConflictException);
  });

  it('deve persistir com status=rejected e reason correto', async () => {
    const mockPrisma = buildMockPrismaForApproval();

    // Fazer findFirst retornar pedido rejeitado na segunda chamada
    const rejectedPedido = {
      ...buildPedidoAwaitingApproval(),
      dados: {
        ...buildPedidoAwaitingApproval().dados,
        approval: {
          status: 'rejected',
          rejectedBy: '42',
          rejectedReason: 'Operação muito arriscada para produção',
          decidedAt: new Date().toISOString(),
        },
      },
    };

    let callCount = 0;
    mockPrisma.dPedido.findFirst = jest.fn().mockImplementation(() => {
      callCount++;
      if (callCount >= 2) return Promise.resolve(rejectedPedido);
      return Promise.resolve(buildPedidoAwaitingApproval());
    });

    const mockEntidade = buildMockEntidadeService();
    const mockEventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };
    const mockExecutionQueue = { enqueueExecution: jest.fn().mockResolvedValue(undefined) };

    const service = new ApprovalFlowService(
      mockPrisma as any,
      mockEntidade as any,
      mockEventProducer as any,
      mockExecutionQueue as any,
    );

    const dto: RejectExecutionDto = { reason: 'Operação muito arriscada para produção' };
    const result = await service.reject('1000001', '1', dto);

    expect(result.approval.status).toBe('rejected');
    expect(result.approval.rejectedReason).toBe('Operação muito arriscada para produção');
  });
});

// ---- Testes: rollback() ----

describe('ApprovalFlowService.rollback()', () => {
  it('deve falhar fechado mesmo se execution nao existe', async () => {
    const { service } = buildApprovalService({ pedido: null });

    await expect(service.rollback('9999', '1')).rejects.toThrow(BadRequestException);
  });

  it('deve lançar BadRequestException se não tem git.headBefore', async () => {
    const pedidoSemGit = buildPedidoAwaitingApproval({
      dados: {
        approval: { status: 'approved' },
        command: { text: 'test' },
        audit: { projectId: '100', agentId: 'a', triggeredBy: '42', correlationId: 'c' },
        // sem git
      },
    });

    const { service } = buildApprovalService({ pedido: pedidoSemGit });

    await expect(service.rollback('1000001', '1')).rejects.toThrow(BadRequestException);
  });

  it('deve falhar fechado sem criar nova execution de rollback', async () => {
    const pedidoComGit = buildPedidoAwaitingApproval({
      dados: {
        approval: { status: 'approved' },
        command: { text: 'adicione testes' },
        audit: { projectId: '100', agentId: 'a', triggeredBy: '42', correlationId: 'c' },
        git: { headBefore: 'abc1234', headAfter: 'def5678', branch: 'scrumban/auto-1' },
      },
    });

    const { service } = buildApprovalService({ pedido: pedidoComGit });

    await expect(service.rollback('1000001', '1')).rejects.toThrow(BadRequestException);
  });
});

// ---- Testes: Sweeper ----

describe('ApprovalFlowSweeperService', () => {
  it('não deve chamar $executeRaw se não há candidatos expirados', async () => {
    // Import inline para testar isoladamente
    const { ApprovalFlowSweeperService } = await import('../approval-flow-sweeper.service');

    const futureDate = new Date(Date.now() + 3600000).toISOString();
    const mockPrisma = {
      dPedido: {
        findMany: jest.fn().mockResolvedValue([
          {
            chave: BigInt(1),
            dados: {
              approval: { status: 'awaiting_approval', expiresAt: futureDate },
            },
          },
        ]),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
    };

    const eventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };
    const sweeper = new ApprovalFlowSweeperService(mockPrisma as any, eventProducer as any);
    const count = await sweeper.expireStaleApprovals();

    expect(count).toBe(0);
    expect(mockPrisma.$executeRaw).not.toHaveBeenCalled();
  });

  it('deve chamar $executeRaw com IDs dos candidatos expirados', async () => {
    const { ApprovalFlowSweeperService } = await import('../approval-flow-sweeper.service');

    const pastDate = new Date(Date.now() - 1000).toISOString(); // já venceu
    const mockPrisma = {
      dPedido: {
        findMany: jest.fn().mockResolvedValue([
          {
            chave: BigInt(1001),
            dados: {
              approval: { status: 'awaiting_approval', expiresAt: pastDate },
            },
          },
          {
            chave: BigInt(1002),
            dados: {
              approval: { status: 'awaiting_approval', expiresAt: pastDate },
            },
          },
          {
            chave: BigInt(1003),
            dados: {
              approval: { status: 'awaiting_approval', expiresAt: new Date(Date.now() + 3600000).toISOString() },
            },
          },
        ]),
      },
      $executeRaw: jest.fn().mockResolvedValue(2),
    };

    const eventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };
    const sweeper = new ApprovalFlowSweeperService(mockPrisma as any, eventProducer as any);
    const count = await sweeper.expireStaleApprovals();

    expect(count).toBe(2); // apenas 2 expirados (1003 não expirou)
    expect(mockPrisma.$executeRaw).toHaveBeenCalledTimes(1);
  });
});

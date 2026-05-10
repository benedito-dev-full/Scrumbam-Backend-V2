/**
 * Testes unitários — ExecutionsService
 *
 * Cobre: execute() com riscos LOW/MEDIUM/HIGH, erros de validação.
 *
 * Mocks: PrismaService, EntidadeService, ClaudeRunnerService,
 *        OperacaoExecucaoClaude (via jest.mock).
 *
 * @see src/executions/executions.service.ts
 */

import { ForbiddenException, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { Logger } from '@nestjs/common';
import { ExecutionsService } from '../executions.service';
import { ExecuteCommandDto } from '../dto/execute-command.dto';

// ---- Mocks globais ----

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

// ---- Builder de mocks ----

function buildMockPrisma(overrides: {
  projectDados?: object;
  projectExists?: boolean;
  membershipExists?: boolean;
  pedidoResult?: object;
} = {}) {
  const {
    projectDados = { automation: { idAgent: '100' } },
    projectExists = true,
    membershipExists = true,
    pedidoResult = null,
  } = overrides;

  return {
    dProject: {
      findFirst: jest.fn().mockResolvedValue(
        projectExists
          ? { chave: BigInt(100), dados: projectDados, excluido: false }
          : null,
      ),
    },
    dVincula: {
      findFirst: jest.fn().mockResolvedValue(
        membershipExists
          ? { idClasse: BigInt(-171) }
          : null,
      ),
    },
    dPedido: {
      findFirst: jest.fn().mockResolvedValue(pedidoResult),
      update: jest.fn().mockResolvedValue({ chave: BigInt(1000001), dados: {}, criadoEm: new Date(), atualizadoEm: new Date() }),
    },
    $queryRaw: jest.fn().mockResolvedValue([{ nextval: BigInt(1000001) }]),
    $transaction: jest.fn().mockImplementation(async (fn: (tx: any) => Promise<any>) => {
      return fn({
        dPedido: {
          create: jest.fn().mockResolvedValue({ chave: BigInt(1000001) }),
        },
      });
    }),
    dVFS: {
      findFirst: jest.fn().mockImplementation(({ where }: { where: any }) => {
        const { chaveScript } = where;
        const scripts: Record<number, string> = {
          3: buildRiskGateScript('LOW'),
          4: '(async function commandValidator(op) {})',
          5: '(async function posCalculo(op) {})',
          6: '(async function preGravacao(op) {})',
          7: '(async function posGravacao(op) {})',
        };
        const conteudo = scripts[chaveScript];
        if (conteudo) {
          return Promise.resolve({ chave: BigInt(100), chaveScript, conteudo, ativo: true });
        }
        return Promise.resolve(null);
      }),
    },
    dEvento: {
      create: jest.fn().mockResolvedValue({ chave: BigInt(200) }),
    },
  };
}

function buildMockEntidadeService(entidadeId = BigInt(42)) {
  return {
    getEntidadeIdFromUserGroup: jest.fn().mockResolvedValue(entidadeId),
  };
}

function buildMockClaudeRunner() {
  return {
    runClaudeCode: jest.fn().mockResolvedValue({
      exitCode: 0,
      headBefore: 'abc1234',
      headAfter: 'def5678',
      branch: 'scrumban/auto-1000001',
      filesChanged: 2,
      stdout: '[STUB] done',
      stderr: '',
    }),
  };
}

/** Constrói script risk-gate que classifica como riskLevel específico */
function buildRiskGateScript(riskLevel: 'LOW' | 'MEDIUM' | 'HIGH'): string {
  return `(async function riskGateValidator(op) {
    if (!op.dados) op.dados = {};
    op.dados.risk = {
      level: '${riskLevel}',
      explanation: 'Mock: ${riskLevel}',
      matchedPatterns: ${riskLevel !== 'LOW' ? '[{ pattern: "/test/", level: "' + riskLevel + '" }]' : '[]'},
      classifiedAt: new Date().toISOString(),
    };
  })`;
}

/** Cria mock Prisma com risk gate configurado para nível específico */
function buildMockPrismaWithRisk(riskLevel: 'LOW' | 'MEDIUM' | 'HIGH') {
  const base = buildMockPrisma();
  base.dVFS.findFirst = jest.fn().mockImplementation(({ where }: { where: any }) => {
    const { chaveScript } = where;
    const scripts: Record<number, string> = {
      3: buildRiskGateScript(riskLevel),
      4: '(async function commandValidator(op) {})',
      5: '(async function posCalculo(op) {})',
      6: '(async function preGravacao(op) {})',
      7: '(async function posGravacao(op) {})',
    };
    const conteudo = scripts[chaveScript];
    if (conteudo) {
      return Promise.resolve({ chave: BigInt(100), chaveScript, conteudo, ativo: true });
    }
    return Promise.resolve(null);
  });
  return base;
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

  const projectDados = agentId !== null
    ? { automation: { idAgent: agentId } }
    : {};

  const mockPrisma = buildMockPrismaWithRisk(riskLevel);
  mockPrisma.dProject.findFirst = jest.fn().mockResolvedValue(
    projectExists
      ? { chave: BigInt(100), dados: projectDados, excluido: false }
      : null,
  );
  mockPrisma.dVincula.findFirst = jest.fn().mockResolvedValue(
    membershipExists ? { idClasse: BigInt(-171) } : null,
  );

  const mockEntidade = buildMockEntidadeService();
  const mockClaude = buildMockClaudeRunner();
  // F7 Bloco Q: ExecutionsService recebe EventProducerService real (4º parâmetro).
  // Mock absorve silenciosamente — testes existentes não devem mudar comportamento.
  const mockEventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };

  const service = new ExecutionsService(
    mockPrisma as any,
    mockEntidade as any,
    mockClaude as any,
    mockEventProducer as any,
  );

  return { service, mockPrisma, mockEntidade, mockClaude, mockEventProducer };
}

// ---- Testes ----

describe('ExecutionsService.execute()', () => {
  const baseDto: ExecuteCommandDto = {
    text: 'adicione testes unitários ao AuthService',
  };

  describe('validações de entrada', () => {
    it('deve lançar NotFoundException se projeto não existe', async () => {
      const { service } = buildService({ projectExists: false });

      await expect(
        service.execute('100', baseDto, '1'),
      ).rejects.toThrow(NotFoundException);
    });

    it('deve lançar ForbiddenException se user não é membro', async () => {
      const { service } = buildService({ membershipExists: false });

      await expect(
        service.execute('100', baseDto, '1'),
      ).rejects.toThrow(ForbiddenException);
    });

    it('deve lançar UnprocessableEntityException se agente não configurado', async () => {
      const { service } = buildService({ agentId: null });

      await expect(
        service.execute('100', baseDto, '1'),
      ).rejects.toThrow(UnprocessableEntityException);
    });
  });

  describe('decisão de approval', () => {
    it('deve aprovar automaticamente execução LOW', async () => {
      const { service, mockPrisma } = buildService({ riskLevel: 'LOW' });

      // Mock do findFirst pós-gravação para retornar o pedido
      mockPrisma.dPedido.findFirst.mockResolvedValue({
        chave: BigInt(1000001),
        idClasse: BigInt(-301),
        idPessoa: BigInt(42),
        dados: {
          approval: { status: 'approved', approvedBy: 'auto:risk-gate-low' },
          command: { text: baseDto.text },
          audit: { projectId: '100', triggeredBy: '42', agentId: '100', correlationId: 'test' },
          risk: { level: 'LOW', matchedPatterns: [] },
        },
        criadoEm: new Date(),
        atualizadoEm: new Date(),
      });

      const result = await service.execute('100', baseDto, '1');

      expect(result.riskLevel).toBe('LOW');
      expect(result.approval.status).toBe('approved');
      expect(result.approval.approvedBy).toBe('auto:risk-gate-low');
    });

    it('deve aprovar automaticamente execução MEDIUM', async () => {
      const { service, mockPrisma } = buildService({ riskLevel: 'MEDIUM' });

      mockPrisma.dPedido.findFirst.mockResolvedValue({
        chave: BigInt(1000002),
        idClasse: BigInt(-302),
        idPessoa: BigInt(42),
        dados: {
          approval: { status: 'approved', approvedBy: 'auto:risk-gate-medium' },
          command: { text: baseDto.text },
          audit: { projectId: '100', triggeredBy: '42', agentId: '100', correlationId: 'test' },
          risk: { level: 'MEDIUM', matchedPatterns: [] },
        },
        criadoEm: new Date(),
        atualizadoEm: new Date(),
      });

      const result = await service.execute('100', baseDto, '1');

      expect(result.riskLevel).toBe('MEDIUM');
      expect(result.approval.status).toBe('approved');
      expect(result.approval.approvedBy).toBe('auto:risk-gate-medium');
    });

    it('deve persistir HIGH como awaiting_approval (sem auto-aprovação)', async () => {
      const { service, mockPrisma } = buildService({ riskLevel: 'HIGH' });

      mockPrisma.dPedido.findFirst.mockResolvedValue({
        chave: BigInt(1000003),
        idClasse: BigInt(-303),
        idPessoa: BigInt(42),
        dados: {
          approval: { status: 'awaiting_approval', expiresAt: new Date(Date.now() + 3600000).toISOString() },
          command: { text: 'DROP TABLE users' },
          audit: { projectId: '100', triggeredBy: '42', agentId: '100', correlationId: 'test' },
          risk: { level: 'HIGH', matchedPatterns: [{ pattern: '/DROP/', level: 'HIGH' }] },
        },
        criadoEm: new Date(),
        atualizadoEm: new Date(),
      });

      const result = await service.execute('100', { text: 'DROP TABLE users' }, '1');

      expect(result.riskLevel).toBe('HIGH');
      expect(result.approval.status).toBe('awaiting_approval');
      // Não deve ter approvedBy para HIGH awaiting
      expect(result.approval.approvedBy).toBeUndefined();
    });
  });

  describe('saída', () => {
    it('deve retornar ExecutionResponseDto com campos obrigatórios', async () => {
      const { service, mockPrisma } = buildService({ riskLevel: 'LOW' });

      mockPrisma.dPedido.findFirst.mockResolvedValue({
        chave: BigInt(1000001),
        idClasse: BigInt(-301),
        idPessoa: BigInt(42),
        dados: {
          approval: { status: 'approved', approvedBy: 'auto:risk-gate-low' },
          command: { text: baseDto.text },
          audit: { projectId: '100', triggeredBy: '42', agentId: '100', correlationId: 'test' },
          risk: { level: 'LOW', matchedPatterns: [] },
        },
        criadoEm: new Date(),
        atualizadoEm: new Date(),
      });

      const result = await service.execute('100', baseDto, '1');

      expect(result.id).toBeDefined();
      expect(result.riskLevel).toBeDefined();
      expect(result.approval).toBeDefined();
      expect(result.command).toBeDefined();
      expect(result.createdAt).toBeDefined();
      expect(typeof result.id).toBe('string');
    });
  });
});

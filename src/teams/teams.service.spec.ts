import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException } from '@nestjs/common';
import { TeamsService } from './teams.service';
import { PrismaService } from '../prisma.service';

/**
 * Testes unitários de TeamsService.
 *
 * Testa criação de times, unicidade de prefix por org,
 * atomicidade da transaction e queries de membership.
 */
describe('TeamsService', () => {
  let service: TeamsService;
  let prisma: {
    dEntidade: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
    };
    dVincula: {
      create: jest.Mock;
      findFirst: jest.Mock;
      findMany: jest.Mock;
      count: jest.Mock;
      update: jest.Mock;
      updateMany: jest.Mock;
      groupBy: jest.Mock;
    };
    dTabela: {
      create: jest.Mock;
      findFirst: jest.Mock;
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };

  const mockTeam = {
    chave: BigInt(200),
    nome: 'Backend Team',
    dados: { key: 'BACK' },
    idEstab: BigInt(100),
    criadoEm: new Date('2026-05-09'),
    atualizadoEm: new Date('2026-05-09'),
  };

  const mockOrgAdminVinculo = { chave: BigInt(1) };
  const mockLeadMembership = { metaDados: { cargo: 'LEAD' } };

  beforeEach(async () => {
    prisma = {
      dEntidade: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
      },
      dVincula: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        count: jest.fn(),
        update: jest.fn(),
        updateMany: jest.fn(),
        groupBy: jest.fn(),
      },
      dTabela: {
        create: jest.fn(),
        findFirst: jest.fn(),
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [TeamsService, { provide: PrismaService, useValue: prisma }],
    }).compile();

    service = module.get<TeamsService>(TeamsService);
  });

  /**
   * Spec 1: create — prefix único por org (conflito deve lançar ConflictException)
   */
  it('create: lança ConflictException se prefix já existe na organização', async () => {
    // Arrange: org membership válido
    prisma.dVincula.findFirst.mockResolvedValue(mockOrgAdminVinculo); // user é membro
    // Teams existentes na org
    prisma.dEntidade.findMany.mockResolvedValue([{ chave: BigInt(200) }]);
    // Counter com mesmo prefix já existe
    prisma.dTabela.findFirst.mockResolvedValue({
      metaDados: { prefix: 'BACK', lastSeq: 5 },
    });

    // Act & Assert
    await expect(
      service.create('100', { nome: 'Backend Team', prefix: 'BACK' }, BigInt(1)),
    ).rejects.toThrow(ConflictException);

    // $transaction não deve ter sido chamado
    expect(prisma.$transaction).not.toHaveBeenCalled();
  });

  /**
   * Spec 2: create — transaction atômica (team + counter + membership)
   */
  it('create: transaction cria team + issue counter + membership LEAD atomicamente', async () => {
    // Arrange: org membership válido
    prisma.dVincula.findFirst.mockResolvedValue(mockOrgAdminVinculo);
    prisma.dEntidade.findMany.mockResolvedValue([]); // sem teams existentes
    prisma.dTabela.findFirst.mockResolvedValue(null); // sem counter com mesmo prefix
    prisma.$transaction.mockImplementation(async (cb: (tx: typeof prisma) => Promise<unknown>) =>
      cb(prisma),
    );
    prisma.dEntidade.create.mockResolvedValue(mockTeam);
    prisma.dTabela.create.mockResolvedValue({ chave: BigInt(300) });
    prisma.dVincula.create.mockResolvedValue({ chave: BigInt(400) });
    prisma.dVincula.count.mockResolvedValue(1);

    // Act
    const result = await service.create('100', { nome: 'Backend Team', prefix: 'BACK' }, BigInt(1));

    // Assert: 3 creates na transaction (team + counter + membership)
    expect(prisma.dEntidade.create).toHaveBeenCalledTimes(1);
    expect(prisma.dTabela.create).toHaveBeenCalledTimes(1);
    expect(prisma.dVincula.create).toHaveBeenCalledTimes(1);
    expect(result.prefix).toBe('BACK');
    expect(result.orgId).toBe('100');
  });

  /**
   * Spec 3: findMine — retorna times de múltiplas orgs
   */
  it('findMine: retorna todos os times onde o usuário é membro (cross-org)', async () => {
    // Arrange: 2 vinculos de team membership em orgs diferentes
    const mockVinculos = [
      {
        idLocEscritu: BigInt(200),
        locEscritu: {
          ...mockTeam,
          excluido: false,
        },
      },
      {
        idLocEscritu: BigInt(201),
        locEscritu: {
          chave: BigInt(201),
          nome: 'Frontend Team',
          dados: { key: 'FRONT' },
          idEstab: BigInt(150), // org diferente
          criadoEm: new Date(),
          atualizadoEm: new Date(),
          excluido: false,
        },
      },
    ];
    prisma.dVincula.findMany.mockResolvedValue(mockVinculos);
    prisma.dVincula.groupBy.mockResolvedValue([
      { idLocEscritu: BigInt(200), _count: { chave: 2 } },
      { idLocEscritu: BigInt(201), _count: { chave: 1 } },
    ]);

    // Act
    const result = await service.findMine(BigInt(999));

    // Assert: 2 times de 2 orgs diferentes
    expect(result.items).toHaveLength(2);
    expect(result.items[0].orgId).toBe('100');
    expect(result.items[1].orgId).toBe('150');
  });

  /**
   * Spec 4: delete — não pode deletar time se houver projetos vinculados
   * (projetos vinculados via DProject ficam para verificação futura em F5-C)
   * Aqui testamos o fluxo básico de delete bem-sucedido
   */
  it('delete: cascade soft-deleta memberships e counters antes do team', async () => {
    // Arrange
    prisma.dEntidade.findFirst.mockResolvedValue({ chave: BigInt(200), idEstab: BigInt(100) });
    prisma.dVincula.findFirst.mockResolvedValue(mockLeadMembership); // user é LEAD
    prisma.dVincula.findFirst.mockResolvedValue(mockLeadMembership);
    prisma.$transaction.mockImplementation(async (cb: (tx: typeof prisma) => Promise<unknown>) =>
      cb(prisma),
    );
    prisma.dVincula.updateMany.mockResolvedValue({ count: 3 });
    prisma.dTabela.updateMany.mockResolvedValue({ count: 1 });
    prisma.dEntidade.update.mockResolvedValue({ chave: BigInt(200) });

    // Act
    await service.delete('200', BigInt(1));

    // Assert: cascade (memberships -181, project-team links -182, counters, team)
    expect(prisma.dVincula.updateMany).toHaveBeenCalledTimes(2);
    expect(prisma.dTabela.updateMany).toHaveBeenCalledTimes(1);
    expect(prisma.dEntidade.update).toHaveBeenCalledWith(
      expect.objectContaining({ data: { excluido: true } }),
    );
  });

  /**
   * Bug #2 (review Task 19 — ADR-V2-029): delete de time não cascateava
   * vínculos -182 PROJECT_TEAM_LINK, deixando-os zumbis. Este teste prova
   * que ambos os vínculos (-181 membership + -182 project-link) são
   * soft-deletados na mesma transação.
   */
  it('delete: cascade soft-deleta vínculos -182 PROJECT_TEAM_LINK (regressão Bug #2)', async () => {
    // Arrange
    prisma.dEntidade.findFirst.mockResolvedValue({ chave: BigInt(200), idEstab: BigInt(100) });
    prisma.dVincula.findFirst.mockResolvedValue(mockLeadMembership);
    prisma.$transaction.mockImplementation(async (cb: (tx: typeof prisma) => Promise<unknown>) =>
      cb(prisma),
    );
    prisma.dVincula.updateMany.mockResolvedValue({ count: 2 });
    prisma.dTabela.updateMany.mockResolvedValue({ count: 1 });
    prisma.dEntidade.update.mockResolvedValue({ chave: BigInt(200) });

    // Act
    await service.delete('200', BigInt(1));

    // Assert: updateMany foi chamado especificamente para -182 (PROJECT_TEAM_LINK)
    const projectLinkCascade = prisma.dVincula.updateMany.mock.calls.find((call: unknown[]) => {
      const arg = call[0] as { where?: { idClasse?: bigint } };
      return arg.where?.idClasse === BigInt(-182);
    });
    expect(projectLinkCascade).toBeDefined();
    expect(projectLinkCascade[0]).toEqual({
      where: { idLocEscritu: BigInt(200), idClasse: BigInt(-182), excluido: false },
      data: { excluido: true },
    });

    // Cascade total: 2 updateMany em DVincula (-181 e -182) + 1 em DTabela
    expect(prisma.dVincula.updateMany).toHaveBeenCalledTimes(2);
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { ForbiddenException } from '@nestjs/common';
import { OrganizationsService } from './organizations.service';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../common/services/audit.service';

/**
 * Testes unitários de OrganizationsService.
 *
 * Usa mocks de PrismaService e AuditService para testar a lógica
 * isolada da transação atômica e regras de negócio.
 */
describe('OrganizationsService', () => {
  let service: OrganizationsService;
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
      updateMany: jest.Mock;
    };
    dProject: {
      updateMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let auditService: { log: jest.Mock };

  const mockOrg = {
    chave: BigInt(100),
    nome: 'Acme Corp',
    dados: { description: 'Test org' },
    criadoEm: new Date('2026-05-09'),
    atualizadoEm: new Date('2026-05-09'),
  };

  const mockTeam = {
    chave: BigInt(200),
    nome: 'Default Team',
    dados: { key: 'DEV' },
    idEstab: BigInt(100),
    criadoEm: new Date('2026-05-09'),
    atualizadoEm: new Date('2026-05-09'),
  };

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
        updateMany: jest.fn(),
      },
      dProject: {
        updateMany: jest.fn(),
      },
      $transaction: jest.fn(),
    };

    auditService = { log: jest.fn().mockResolvedValue(undefined) };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        OrganizationsService,
        { provide: PrismaService, useValue: prisma },
        { provide: AuditService, useValue: auditService },
      ],
    }).compile();

    service = module.get<OrganizationsService>(OrganizationsService);
  });

  /**
   * Spec 1: create — transaction cria 5 registros atomicamente
   */
  it('create: transaction cria org + team + counter + vincula admin + vincula lead (5 registros)', async () => {
    // Arrange: simular $transaction executando o callback
    prisma.$transaction.mockImplementation(async (cb: (tx: typeof prisma) => Promise<unknown>) =>
      cb(prisma),
    );
    prisma.dEntidade.create
      .mockResolvedValueOnce(mockOrg)    // org
      .mockResolvedValueOnce(mockTeam);  // team
    prisma.dTabela.create.mockResolvedValue({ chave: BigInt(300) }); // counter
    prisma.dVincula.create.mockResolvedValue({ chave: BigInt(400) }); // 2x calls
    prisma.dVincula.count.mockResolvedValue(1);

    // Act
    const result = await service.create({ nome: 'Acme Corp' }, BigInt(1));

    // Assert: 5 creates (org + team + counter + admin vinculo + lead vinculo)
    expect(prisma.dEntidade.create).toHaveBeenCalledTimes(2);
    expect(prisma.dTabela.create).toHaveBeenCalledTimes(1);
    expect(prisma.dVincula.create).toHaveBeenCalledTimes(2);
    expect(result.id).toBe('100');
    expect(result.nome).toBe('Acme Corp');

    // audit emitido APÓS commit
    expect(auditService.log).toHaveBeenCalledWith('org.created', BigInt(100), expect.any(Object), BigInt(1));
  });

  /**
   * Spec 2: create — rollback total se qualquer step falhar
   */
  it('create: se transaction falhar, $transaction propaga o erro', async () => {
    // Arrange: $transaction lança erro
    prisma.$transaction.mockRejectedValue(new Error('DB connection lost'));

    // Act & Assert
    await expect(service.create({ nome: 'Fail Corp' }, BigInt(1))).rejects.toThrow('DB connection lost');
    // Audit NÃO deve ter sido chamado (falha antes do commit)
    expect(auditService.log).not.toHaveBeenCalled();
  });

  /**
   * Spec 3: findMany — retorna apenas orgs onde user é membro
   */
  it('findMany: retorna apenas orgs onde o usuário é membro via DVincula', async () => {
    // Arrange
    const mockVinculo = {
      idLocEscritu: BigInt(100),
      locEscritu: {
        chave: BigInt(100),
        nome: 'Acme Corp',
        dados: {},
        criadoEm: new Date(),
        atualizadoEm: new Date(),
        excluido: false,
      },
    };
    prisma.dVincula.findMany.mockResolvedValue([mockVinculo]);
    prisma.dVincula.groupBy.mockResolvedValue([
      { idLocEscritu: BigInt(100), _count: { chave: 3 } },
    ]);

    // Act
    const result = await service.findMany(BigInt(999));

    // Assert: apenas 1 org retornada (a que o user é membro)
    expect(result.items).toHaveLength(1);
    expect(result.items[0].id).toBe('100');
    expect(result.items[0].memberCount).toBe(3);
  });

  /**
   * Spec 4: delete — cascade não deixa órfãos
   */
  it('delete: cascade soft-deleta todos os recursos filhos da org', async () => {
    // Arrange: user é ADMIN
    prisma.dVincula.findFirst.mockResolvedValue({ chave: BigInt(1) }); // admin check
    prisma.dEntidade.findFirst.mockResolvedValue({ chave: BigInt(100), nome: 'Acme Corp' }); // org exists
    prisma.dEntidade.findMany.mockResolvedValue([{ chave: BigInt(200) }]); // 1 team

    prisma.$transaction.mockImplementation(async (cb: (tx: typeof prisma) => Promise<unknown>) =>
      cb(prisma),
    );
    prisma.dVincula.updateMany.mockResolvedValue({ count: 2 });
    prisma.dTabela.updateMany.mockResolvedValue({ count: 1 });
    prisma.dEntidade.updateMany.mockResolvedValue({ count: 1 });
    prisma.dProject.updateMany.mockResolvedValue({ count: 0 });
    prisma.dEntidade.update.mockResolvedValue({ chave: BigInt(100) });

    // Act
    await service.delete('100', BigInt(1));

    // Assert: updateMany foi chamado para vinculos dos teams + vinculos da org + projects + org
    expect(prisma.dVincula.updateMany).toHaveBeenCalledTimes(2); // team memberships + org vinculos
    expect(prisma.dTabela.updateMany).toHaveBeenCalledTimes(1); // issue counters
    expect(prisma.dEntidade.updateMany).toHaveBeenCalledTimes(1); // teams
    expect(prisma.dProject.updateMany).toHaveBeenCalledTimes(1); // projects
    expect(prisma.dEntidade.update).toHaveBeenCalledWith(
      expect.objectContaining({ where: { chave: BigInt(100) }, data: { excluido: true } }),
    );
  });

  /**
   * Spec 5: addMember — cria DVincula -162 MEMBER
   */
  it('addMember: cria DVincula -162 (MEMBER) para o usuário target', async () => {
    // Arrange: executante é ADMIN
    prisma.dVincula.findFirst
      .mockResolvedValueOnce({ chave: BigInt(1) }) // requireAdminRole → admin check
      .mockResolvedValueOnce(null);                // existingMember → não existe ainda
    prisma.dEntidade.findFirst.mockResolvedValue({ chave: BigInt(999) }); // target user exists
    prisma.dVincula.create.mockResolvedValue({ chave: BigInt(500) });

    // Act
    await service.addMember('100', { userId: '999', role: 'MEMBER' }, BigInt(1));

    // Assert
    expect(prisma.dVincula.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idClasse: BigInt(-162), // ORG_ROLE_MEMBER
          idLocEscritu: BigInt(100),
          idEntidade: BigInt(999),
          metaDados: { cargo: 'MEMBER' },
        }),
      }),
    );
  });

  /**
   * Spec 6: updateMemberRole — atualiza metaDados.cargo
   */
  it('updateMemberRole: atualiza idClasse e metaDados.cargo do DVincula', async () => {
    // Arrange: executante é ADMIN, membro existe
    prisma.dVincula.findFirst
      .mockResolvedValueOnce({ chave: BigInt(1) }) // requireAdminRole
      .mockResolvedValueOnce({ chave: BigInt(400), metaDados: { cargo: 'MEMBER' } }); // vinculo existente
    prisma.dVincula.update.mockResolvedValue({ chave: BigInt(400) });

    // Act
    await service.updateMemberRole('100', '999', { role: 'ADMIN' }, BigInt(1));

    // Assert
    expect(prisma.dVincula.update).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idClasse: BigInt(-161), // ORG_ROLE_ADMIN
          metaDados: expect.objectContaining({ cargo: 'ADMIN' }),
        }),
      }),
    );
  });

  /**
   * Spec 7: findOne — lança ForbiddenException se usuário não é membro
   */
  it('findOne: lança ForbiddenException se usuário não é membro da org', async () => {
    prisma.dEntidade.findFirst.mockResolvedValue(mockOrg); // org existe
    prisma.dVincula.findFirst.mockResolvedValue(null); // mas user não é membro

    await expect(service.findOne('100', BigInt(999))).rejects.toThrow(ForbiddenException);
  });

  /**
   * Spec 8: removeMember — não pode remover último ADMIN
   */
  it('removeMember: lança ForbiddenException ao tentar remover o único ADMIN', async () => {
    prisma.dVincula.findFirst
      .mockResolvedValueOnce({ chave: BigInt(1) }) // requireAdminRole: executante é ADMIN
      .mockResolvedValueOnce({ chave: BigInt(400), idClasse: BigInt(-161) }); // vinculo do target é ADMIN
    prisma.dVincula.count.mockResolvedValue(1); // apenas 1 ADMIN na org

    await expect(service.removeMember('100', '999', BigInt(1))).rejects.toThrow(ForbiddenException);
  });
});

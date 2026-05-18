import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { FoldersService } from './folders.service';
import { PrismaService } from '../prisma.service';
import { RoleResolverService } from '../auth/services/role-resolver.service';

/**
 * Unit tests para FoldersService (ADR-V2-FOLDERS-001).
 *
 * Mock Prisma + mock RoleResolverService. Cobre 9 métodos públicos
 * + 1 método de batch (resolveFolderIdsForProjects).
 */
describe('FoldersService', () => {
  let service: FoldersService;
  let prisma: {
    dEntidade: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      update: jest.Mock;
    };
    dVincula: {
      findMany: jest.Mock;
      findFirst: jest.Mock;
      groupBy: jest.Mock;
      count: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
    };
    dProject: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let roleResolver: { getOrgRole: jest.Mock };

  const ORG_ID = BigInt(100);
  const USER_ID = BigInt(150);
  const FOLDER_ID = BigInt(500);
  const PROJECT_ID = BigInt(300);

  const mockFolderRow = {
    chave: FOLDER_ID,
    nome: 'Cliente Acme',
    idEstab: ORG_ID,
    criadoEm: new Date('2026-05-18'),
    atualizadoEm: new Date('2026-05-18'),
  };

  const mockOrgEntity = { chave: ORG_ID };
  const mockProjectRow = { chave: PROJECT_ID, idEstab: ORG_ID };

  beforeEach(async () => {
    prisma = {
      dEntidade: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        update: jest.fn(),
      },
      dVincula: {
        findMany: jest.fn(),
        findFirst: jest.fn(),
        groupBy: jest.fn(),
        count: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
      },
      dProject: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
      },
      $transaction: jest.fn(async (cb: (tx: typeof prisma) => Promise<unknown>) => cb(prisma)),
    };
    roleResolver = { getOrgRole: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        FoldersService,
        { provide: PrismaService, useValue: prisma },
        { provide: RoleResolverService, useValue: roleResolver },
      ],
    }).compile();

    service = module.get<FoldersService>(FoldersService);
  });

  describe('create()', () => {
    it('cria folder com projectCount=0 quando user tem acesso à org', async () => {
      roleResolver.getOrgRole.mockResolvedValue('ADMIN');
      prisma.dEntidade.findFirst.mockResolvedValueOnce(mockOrgEntity); // ensureOrgExists
      prisma.dEntidade.create.mockResolvedValue(mockFolderRow);

      const result = await service.create({ nome: 'Cliente Acme', organizationId: '100' }, USER_ID);

      expect(result.id).toBe('500');
      expect(result.nome).toBe('Cliente Acme');
      expect(result.organizationId).toBe('100');
      expect(result.projectCount).toBe(0);
      expect(prisma.dEntidade.create).toHaveBeenCalledWith({
        data: { idClasse: BigInt(-155), nome: 'Cliente Acme', idEstab: BigInt(100) },
        select: expect.any(Object),
      });
    });

    it('lança ForbiddenException se user não é membro da org', async () => {
      roleResolver.getOrgRole.mockResolvedValue(null);

      await expect(service.create({ nome: 'X', organizationId: '100' }, USER_ID)).rejects.toThrow(
        ForbiddenException,
      );
      expect(prisma.dEntidade.create).not.toHaveBeenCalled();
    });

    it('lança NotFoundException se organização não existe', async () => {
      roleResolver.getOrgRole.mockResolvedValue('MEMBER');
      prisma.dEntidade.findFirst.mockResolvedValueOnce(null); // org inexistente

      await expect(service.create({ nome: 'X', organizationId: '999' }, USER_ID)).rejects.toThrow(
        NotFoundException,
      );
    });
  });

  describe('findAllByOrg()', () => {
    it('lista folders ordenadas por nome com counts em batch (N+1 ZERO)', async () => {
      roleResolver.getOrgRole.mockResolvedValue('MEMBER');
      prisma.dEntidade.findMany.mockResolvedValue([
        { ...mockFolderRow, chave: BigInt(501), nome: 'Acme' },
        { ...mockFolderRow, chave: BigInt(502), nome: 'Zeta' },
      ]);
      prisma.dVincula.groupBy.mockResolvedValue([
        { idLocEscritu: BigInt(501), _count: { chave: 3 } },
        { idLocEscritu: BigInt(502), _count: { chave: 1 } },
      ]);

      const result = await service.findAllByOrg('100', USER_ID);

      expect(result.items).toHaveLength(2);
      expect(result.items[0].id).toBe('501');
      expect(result.items[0].projectCount).toBe(3);
      expect(result.items[1].projectCount).toBe(1);
      // 1 findMany + 1 groupBy = 2 queries, ZERO N+1
      expect(prisma.dEntidade.findMany).toHaveBeenCalledTimes(1);
      expect(prisma.dVincula.groupBy).toHaveBeenCalledTimes(1);
    });

    it('retorna lista vazia sem chamar groupBy quando não há folders', async () => {
      roleResolver.getOrgRole.mockResolvedValue('MEMBER');
      prisma.dEntidade.findMany.mockResolvedValue([]);

      const result = await service.findAllByOrg('100', USER_ID);

      expect(result.items).toEqual([]);
      expect(prisma.dVincula.groupBy).not.toHaveBeenCalled();
    });

    it('respeita ordenação alfabética por nome (CEO Q3)', async () => {
      roleResolver.getOrgRole.mockResolvedValue('MEMBER');
      prisma.dEntidade.findMany.mockResolvedValue([]);

      await service.findAllByOrg('100', USER_ID);

      expect(prisma.dEntidade.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ orderBy: { nome: 'asc' } }),
      );
    });

    it('lança ForbiddenException se user não é membro da org', async () => {
      roleResolver.getOrgRole.mockResolvedValue(null);

      await expect(service.findAllByOrg('100', USER_ID)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('findById()', () => {
    it('retorna folder com projectCount', async () => {
      prisma.dEntidade.findFirst.mockResolvedValue(mockFolderRow);
      roleResolver.getOrgRole.mockResolvedValue('MEMBER');
      prisma.dVincula.count.mockResolvedValue(2);

      const result = await service.findById('500', USER_ID);

      expect(result.id).toBe('500');
      expect(result.projectCount).toBe(2);
    });

    it('lança NotFoundException se folder não existe', async () => {
      prisma.dEntidade.findFirst.mockResolvedValue(null);

      await expect(service.findById('999', USER_ID)).rejects.toThrow(NotFoundException);
    });

    it('lança ForbiddenException se user não tem acesso à org da pasta', async () => {
      prisma.dEntidade.findFirst.mockResolvedValue(mockFolderRow);
      roleResolver.getOrgRole.mockResolvedValue(null);

      await expect(service.findById('500', USER_ID)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('update()', () => {
    it('renomeia a folder e retorna projectCount atualizado', async () => {
      prisma.dEntidade.findFirst.mockResolvedValue(mockFolderRow);
      roleResolver.getOrgRole.mockResolvedValue('ADMIN');
      prisma.dEntidade.update.mockResolvedValue({ ...mockFolderRow, nome: 'Cliente Novo' });
      prisma.dVincula.count.mockResolvedValue(1);

      const result = await service.update('500', { nome: 'Cliente Novo' }, USER_ID);

      expect(result.nome).toBe('Cliente Novo');
      expect(result.projectCount).toBe(1);
      expect(prisma.dEntidade.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { chave: FOLDER_ID },
          data: { nome: 'Cliente Novo' },
        }),
      );
    });

    it('não toca em campos quando dto.nome é undefined', async () => {
      prisma.dEntidade.findFirst.mockResolvedValue(mockFolderRow);
      roleResolver.getOrgRole.mockResolvedValue('ADMIN');
      prisma.dEntidade.update.mockResolvedValue(mockFolderRow);
      prisma.dVincula.count.mockResolvedValue(0);

      await service.update('500', {}, USER_ID);

      expect(prisma.dEntidade.update).toHaveBeenCalledWith(expect.objectContaining({ data: {} }));
    });
  });

  describe('delete()', () => {
    it('soft-deleta folder + cascata dos vínculos -183 em transação (CEO Q4)', async () => {
      prisma.dEntidade.findFirst.mockResolvedValue(mockFolderRow);
      roleResolver.getOrgRole.mockResolvedValue('ADMIN');

      await service.delete('500', USER_ID);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.dVincula.updateMany).toHaveBeenCalledWith({
        where: {
          idClasse: BigInt(-183),
          idLocEscritu: FOLDER_ID,
          excluido: false,
        },
        data: { excluido: true },
      });
      expect(prisma.dEntidade.update).toHaveBeenCalledWith({
        where: { chave: FOLDER_ID },
        data: { excluido: true },
      });
    });

    it('lança NotFoundException quando folder não existe', async () => {
      prisma.dEntidade.findFirst.mockResolvedValue(null);

      await expect(service.delete('999', USER_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('listProjects()', () => {
    it('retorna projects vinculados ativos', async () => {
      prisma.dEntidade.findFirst.mockResolvedValue(mockFolderRow);
      roleResolver.getOrgRole.mockResolvedValue('MEMBER');
      prisma.dVincula.findMany.mockResolvedValue([{ idEntidade: PROJECT_ID }]);
      prisma.dProject.findMany.mockResolvedValue([
        { chave: PROJECT_ID, nome: 'Backend Acme', idEstab: ORG_ID },
      ]);

      const result = await service.listProjects('500', USER_ID);

      expect(result.items).toHaveLength(1);
      expect(result.items[0]).toEqual({ id: '300', nome: 'Backend Acme', orgId: '100' });
    });

    it('retorna vazio sem chamar dProject.findMany quando folder vazia', async () => {
      prisma.dEntidade.findFirst.mockResolvedValue(mockFolderRow);
      roleResolver.getOrgRole.mockResolvedValue('MEMBER');
      prisma.dVincula.findMany.mockResolvedValue([]);

      const result = await service.listProjects('500', USER_ID);

      expect(result.items).toEqual([]);
      expect(prisma.dProject.findMany).not.toHaveBeenCalled();
    });
  });

  describe('listUnassigned()', () => {
    it('retorna apenas projects sem vínculo ativo -183 (limbo)', async () => {
      roleResolver.getOrgRole.mockResolvedValue('MEMBER');
      prisma.dProject.findMany.mockResolvedValue([
        { chave: BigInt(300), nome: 'Backend', idEstab: ORG_ID },
        { chave: BigInt(301), nome: 'Frontend', idEstab: ORG_ID },
        { chave: BigInt(302), nome: 'Mobile', idEstab: ORG_ID },
      ]);
      // Apenas project 301 está em alguma folder
      prisma.dVincula.findMany.mockResolvedValue([{ idEntidade: BigInt(301) }]);

      const result = await service.listUnassigned('100', USER_ID);

      expect(result.items).toHaveLength(2);
      expect(result.items.map((p) => p.id).sort()).toEqual(['300', '302']);
    });

    it('retorna vazio quando org não tem projects', async () => {
      roleResolver.getOrgRole.mockResolvedValue('MEMBER');
      prisma.dProject.findMany.mockResolvedValue([]);

      const result = await service.listUnassigned('100', USER_ID);

      expect(result.items).toEqual([]);
      // Não deve chamar dVincula.findMany se não há projects
      expect(prisma.dVincula.findMany).not.toHaveBeenCalled();
    });
  });

  describe('moveProject()', () => {
    it('soft-deleta vínculo anterior e cria novo em transação (race-safe)', async () => {
      prisma.dEntidade.findFirst.mockResolvedValue(mockFolderRow);
      roleResolver.getOrgRole.mockResolvedValue('ADMIN');
      prisma.dProject.findFirst.mockResolvedValue(mockProjectRow);

      await service.moveProject('500', '300', USER_ID);

      expect(prisma.$transaction).toHaveBeenCalledTimes(1);
      expect(prisma.dVincula.updateMany).toHaveBeenCalledWith({
        where: {
          idClasse: BigInt(-183),
          idEntidade: PROJECT_ID,
          excluido: false,
        },
        data: { excluido: true },
      });
      expect(prisma.dVincula.create).toHaveBeenCalledWith({
        data: {
          idClasse: BigInt(-183),
          idLocEscritu: FOLDER_ID,
          idEntidade: PROJECT_ID,
        },
      });
    });

    it('lança ConflictException se project pertence a outra org', async () => {
      prisma.dEntidade.findFirst.mockResolvedValue(mockFolderRow);
      roleResolver.getOrgRole.mockResolvedValue('ADMIN');
      prisma.dProject.findFirst.mockResolvedValue({
        chave: PROJECT_ID,
        idEstab: BigInt(999), // outra org!
      });

      await expect(service.moveProject('500', '300', USER_ID)).rejects.toThrow(ConflictException);
      expect(prisma.dVincula.create).not.toHaveBeenCalled();
    });

    it('lança NotFoundException se project não existe', async () => {
      prisma.dEntidade.findFirst.mockResolvedValue(mockFolderRow);
      roleResolver.getOrgRole.mockResolvedValue('ADMIN');
      prisma.dProject.findFirst.mockResolvedValue(null);

      await expect(service.moveProject('500', '999', USER_ID)).rejects.toThrow(NotFoundException);
    });
  });

  describe('unmoveProject()', () => {
    it('soft-deleta vínculo entre folder e project (idempotente)', async () => {
      prisma.dEntidade.findFirst.mockResolvedValue(mockFolderRow);
      roleResolver.getOrgRole.mockResolvedValue('ADMIN');

      await service.unmoveProject('500', '300', USER_ID);

      expect(prisma.dVincula.updateMany).toHaveBeenCalledWith({
        where: {
          idClasse: BigInt(-183),
          idLocEscritu: FOLDER_ID,
          idEntidade: PROJECT_ID,
          excluido: false,
        },
        data: { excluido: true },
      });
    });
  });

  describe('resolveFolderIdsForProjects()', () => {
    it('retorna map vazio para array vazio (early return)', async () => {
      const result = await service.resolveFolderIdsForProjects([]);

      expect(result.size).toBe(0);
      expect(prisma.dVincula.findMany).not.toHaveBeenCalled();
    });

    it('inicializa todos projects com null e sobrescreve com folderId quando vínculo existe', async () => {
      prisma.dVincula.findMany.mockResolvedValue([
        { idEntidade: BigInt(300), idLocEscritu: BigInt(500) },
      ]);

      const result = await service.resolveFolderIdsForProjects([
        BigInt(300),
        BigInt(301),
        BigInt(302),
      ]);

      expect(result.get('300')).toBe('500');
      expect(result.get('301')).toBeNull();
      expect(result.get('302')).toBeNull();
    });
  });
});

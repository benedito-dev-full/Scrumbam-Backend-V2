import { Test } from '@nestjs/testing';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { TimezoneService } from '../../common/services/timezone.service';
import { CorrelationIdService } from '../../common/services/correlation-id.service';
import { EventProducerService } from '../../eventos/core/event-producer.service';
import { RoleResolverService } from '../../auth/services/role-resolver.service';
import { DelayJustificationsService } from '../delay-justifications.service';

/** dueDate no passado → tarefa atrasada com estado aberto. */
const PAST_DUE = new Date('2020-01-01T12:00:00Z');

describe('DelayJustificationsService', () => {
  let service: DelayJustificationsService;
  let prisma: {
    dTask: { findFirst: jest.Mock; findMany: jest.Mock };
    dProject: { findFirst: jest.Mock };
    dEvento: {
      findFirst: jest.Mock;
      findMany: jest.Mock;
      create: jest.Mock;
      updateMany: jest.Mock;
      update: jest.Mock;
    };
    $transaction: jest.Mock;
  };
  let roleResolver: { getOrgRole: jest.Mock };
  let eventProducer: { addInternalEvent: jest.Mock };

  const REQUESTER = BigInt(42);
  const ASSIGNEE = BigInt(42);
  const OTHER = BigInt(99);

  beforeEach(async () => {
    prisma = {
      dTask: { findFirst: jest.fn(), findMany: jest.fn() },
      dProject: { findFirst: jest.fn() },
      dEvento: {
        findFirst: jest.fn(),
        findMany: jest.fn(),
        create: jest.fn(),
        updateMany: jest.fn(),
        update: jest.fn(),
      },
      // Executa o callback com o próprio mock como "tx".
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    roleResolver = { getOrgRole: jest.fn() };
    eventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };

    const module = await Test.createTestingModule({
      providers: [
        DelayJustificationsService,
        TimezoneService,
        { provide: PrismaService, useValue: prisma },
        { provide: RoleResolverService, useValue: roleResolver },
        { provide: EventProducerService, useValue: eventProducer },
        { provide: CorrelationIdService, useValue: { getOrGenerate: () => 'corr-1' } },
      ],
    }).compile();

    service = module.get(DelayJustificationsService);
  });

  const overdueTask = (over: Partial<Record<string, unknown>> = {}) => ({
    chave: BigInt(777),
    idAssignee: ASSIGNEE,
    idProject: BigInt(10),
    dueDate: PAST_DUE,
    dados: { v3: { state: 'READY' } },
    atualizadoEm: new Date(),
    ...over,
  });

  const createdEvento = (over: Partial<Record<string, unknown>> = {}) => ({
    chave: BigInt(9001),
    identificadorExterno: '777',
    descricao: 'texto',
    metaDados: {
      taskId: '777',
      motivoClasse: '-535',
      texto: 'texto',
      projetoId: '10',
      autorId: '42',
      delayDays: 5,
      delayKind: 'OPEN',
      version: 1,
      supersededBy: null,
    },
    criadoEm: new Date('2026-07-09T14:00:00Z'),
    idEntidade: ASSIGNEE,
    entidade: { chave: ASSIGNEE, nome: 'Maria' },
    ...over,
  });

  describe('createOrEdit', () => {
    it('cria a primeira justificativa (version 1) como assignee e emite evento', async () => {
      prisma.dTask.findFirst.mockResolvedValue(overdueTask());
      prisma.dEvento.findFirst.mockResolvedValue(null); // sem vigente
      prisma.dEvento.updateMany.mockResolvedValue({ count: 0 });
      prisma.dEvento.create.mockResolvedValue(createdEvento());

      const res = await service.createOrEdit(
        '777',
        { motivoClasse: '-535', texto: 'texto' },
        REQUESTER,
      );

      expect(prisma.dEvento.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            idClasse: BigInt(-503),
            identificadorExterno: '777',
            excluido: false,
          }),
          data: { excluido: true },
        }),
      );
      // taskId em identificadorExterno; autorId em idEntidade (ADR-V2-058)
      expect(prisma.dEvento.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            idClasse: BigInt(-503),
            idEntidade: REQUESTER,
            identificadorExterno: '777',
          }),
        }),
      );
      // primeira versão → não linka anterior
      expect(prisma.dEvento.update).not.toHaveBeenCalled();
      expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
        'delay.justified',
        expect.objectContaining({ taskId: '777', version: 1 }),
        'corr-1',
        expect.any(Object),
      );
      expect(res.id).toBe('9001');
      expect(res.version).toBe(1);
      expect(res.autorNome).toBe('Maria');
    });

    it('edita (supersede) incrementando a versão e linkando a anterior', async () => {
      prisma.dTask.findFirst.mockResolvedValue(overdueTask());
      prisma.dEvento.findFirst.mockResolvedValue({
        chave: BigInt(8000),
        metaDados: { version: 1, taskId: '777' },
      });
      prisma.dEvento.updateMany.mockResolvedValue({ count: 1 });
      prisma.dEvento.create.mockResolvedValue(createdEvento({ metaDados: { version: 2 } }));
      prisma.dEvento.update.mockResolvedValue({});

      const res = await service.createOrEdit('777', { motivoClasse: '-536' }, REQUESTER);

      // linka anterior → nova via supersededBy
      expect(prisma.dEvento.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { chave: BigInt(8000) },
          data: expect.objectContaining({
            metaDados: expect.objectContaining({ supersededBy: '9001' }),
          }),
        }),
      );
      expect(res.version).toBe(2);
    });

    it('403 quando não é assignee nem org ADMIN', async () => {
      prisma.dTask.findFirst.mockResolvedValue(overdueTask({ idAssignee: OTHER }));
      prisma.dProject.findFirst.mockResolvedValue({ idEstab: BigInt(500) });
      roleResolver.getOrgRole.mockResolvedValue('MEMBER');

      await expect(
        service.createOrEdit('777', { motivoClasse: '-535' }, REQUESTER),
      ).rejects.toThrow(ForbiddenException);
      expect(prisma.dEvento.create).not.toHaveBeenCalled();
    });

    it('permite org ADMIN da org dona do projeto (não-assignee)', async () => {
      prisma.dTask.findFirst.mockResolvedValue(overdueTask({ idAssignee: OTHER }));
      prisma.dProject.findFirst.mockResolvedValue({ idEstab: BigInt(500) });
      roleResolver.getOrgRole.mockResolvedValue('ADMIN');
      prisma.dEvento.findFirst.mockResolvedValue(null);
      prisma.dEvento.updateMany.mockResolvedValue({ count: 0 });
      prisma.dEvento.create.mockResolvedValue(createdEvento({ idEntidade: REQUESTER }));

      const res = await service.createOrEdit('777', { motivoClasse: '-535' }, REQUESTER);
      expect(res.id).toBe('9001');
      expect(roleResolver.getOrgRole).toHaveBeenCalledWith(REQUESTER, BigInt(500));
    });

    it('400 quando a tarefa não está atrasada', async () => {
      prisma.dTask.findFirst.mockResolvedValue(
        overdueTask({ dueDate: new Date('2999-01-01T00:00:00Z') }),
      );
      await expect(
        service.createOrEdit('777', { motivoClasse: '-535' }, REQUESTER),
      ).rejects.toThrow(BadRequestException);
    });

    it('404 quando a task não existe', async () => {
      prisma.dTask.findFirst.mockResolvedValue(null);
      await expect(
        service.createOrEdit('777', { motivoClasse: '-535' }, REQUESTER),
      ).rejects.toThrow(NotFoundException);
    });
  });

  describe('getVigente', () => {
    it('retorna null quando não há justificativa', async () => {
      prisma.dTask.findFirst.mockResolvedValue(overdueTask());
      prisma.dEvento.findFirst.mockResolvedValue(null);
      const res = await service.getVigente('777', REQUESTER);
      expect(res).toBeNull();
    });

    it('mapeia a vigente para DTO', async () => {
      prisma.dTask.findFirst.mockResolvedValue(overdueTask());
      prisma.dEvento.findFirst.mockResolvedValue(createdEvento());
      const res = await service.getVigente('777', REQUESTER);
      expect(res).toMatchObject({ id: '9001', taskId: '777', motivoClasse: '-535', version: 1 });
    });

    it('403 para não-assignee não-admin', async () => {
      prisma.dTask.findFirst.mockResolvedValue(overdueTask({ idAssignee: OTHER }));
      prisma.dProject.findFirst.mockResolvedValue({ idEstab: BigInt(500) });
      roleResolver.getOrgRole.mockResolvedValue('VIEWER');
      await expect(service.getVigente('777', REQUESTER)).rejects.toThrow(ForbiddenException);
    });
  });

  describe('getPendingCount', () => {
    it('conta apenas atrasadas sem justificativa vigente (2 queries, zero N+1)', async () => {
      prisma.dTask.findMany.mockResolvedValue([
        {
          chave: BigInt(1),
          dueDate: PAST_DUE,
          dados: { v3: { state: 'READY' } },
          atualizadoEm: new Date(),
        },
        {
          chave: BigInt(2),
          dueDate: PAST_DUE,
          dados: { v3: { state: 'READY' } },
          atualizadoEm: new Date(),
        },
        // no prazo (futuro) → não conta
        {
          chave: BigInt(3),
          dueDate: new Date('2999-01-01'),
          dados: { v3: { state: 'READY' } },
          atualizadoEm: new Date(),
        },
      ]);
      // task 1 já justificada, task 2 não
      prisma.dEvento.findMany.mockResolvedValue([{ identificadorExterno: '1' }]);

      const res = await service.getPendingCount(REQUESTER);

      expect(prisma.dTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ idAssignee: REQUESTER, excluido: false }),
        }),
      );
      expect(prisma.dEvento.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            idClasse: BigInt(-503),
            excluido: false,
            identificadorExterno: { in: ['1', '2'] },
          }),
        }),
      );
      expect(res).toEqual({ pendingCount: 1, projectId: null });
    });

    it('recorta por projectId e evita a 2ª query quando não há atrasadas', async () => {
      prisma.dTask.findMany.mockResolvedValue([]);
      const res = await service.getPendingCount(REQUESTER, '10');
      expect(prisma.dTask.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: expect.objectContaining({ idProject: BigInt(10) }) }),
      );
      expect(prisma.dEvento.findMany).not.toHaveBeenCalled();
      expect(res).toEqual({ pendingCount: 0, projectId: '10' });
    });
  });
});

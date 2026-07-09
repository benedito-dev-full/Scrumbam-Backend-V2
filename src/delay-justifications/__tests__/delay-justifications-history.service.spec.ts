import { Test } from '@nestjs/testing';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { TimezoneService } from '../../common/services/timezone.service';
import { CorrelationIdService } from '../../common/services/correlation-id.service';
import { EventProducerService } from '../../eventos/core/event-producer.service';
import { RoleResolverService } from '../../auth/services/role-resolver.service';
import { DelayJustificationsService } from '../delay-justifications.service';

/**
 * Testes de `getHistory` (Fase 2 — ADR-V2-070).
 *
 * Cobre: 404 (task ausente), RBAC (assignee OK; org ADMIN OK; terceiro → 403),
 * e a montagem do histórico (todas as versões, ordem por versão desc, flags
 * `isVigente`/`supersededBy`).
 */
describe('DelayJustificationsService.getHistory', () => {
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
      $transaction: jest.fn(async (cb: (tx: unknown) => unknown) => cb(prisma)),
    };
    roleResolver = { getOrgRole: jest.fn() };

    const module = await Test.createTestingModule({
      providers: [
        DelayJustificationsService,
        TimezoneService,
        { provide: PrismaService, useValue: prisma },
        { provide: RoleResolverService, useValue: roleResolver },
        {
          provide: EventProducerService,
          useValue: { addInternalEvent: jest.fn().mockResolvedValue(undefined) },
        },
        { provide: CorrelationIdService, useValue: { getOrGenerate: () => 'corr-1' } },
      ],
    }).compile();

    service = module.get(DelayJustificationsService);
  });

  const task = (over: Record<string, unknown> = {}) => ({
    chave: BigInt(777),
    idAssignee: ASSIGNEE,
    idProject: BigInt(10),
    dueDate: new Date('2020-01-01T12:00:00Z'),
    dados: { v3: { state: 'READY' } },
    atualizadoEm: new Date(),
    ...over,
  });

  const eventoRow = (over: Record<string, unknown> = {}) => ({
    chave: BigInt(9001),
    identificadorExterno: '777',
    descricao: 'texto',
    criadoEm: new Date('2026-07-01T10:00:00Z'),
    idEntidade: ASSIGNEE,
    excluido: false,
    metaDados: { taskId: '777', motivoClasse: '-535', version: 1, supersededBy: null },
    entidade: { chave: ASSIGNEE, nome: 'Maria' },
    ...over,
  });

  it('404 quando a task não existe', async () => {
    prisma.dTask.findFirst.mockResolvedValue(null);
    await expect(service.getHistory('777', ASSIGNEE)).rejects.toBeInstanceOf(NotFoundException);
  });

  it('403 quando o requester não é assignee nem org ADMIN', async () => {
    prisma.dTask.findFirst.mockResolvedValue(task());
    prisma.dProject.findFirst.mockResolvedValue({ idEstab: BigInt(10) });
    roleResolver.getOrgRole.mockResolvedValue('MEMBER');

    await expect(service.getHistory('777', OTHER)).rejects.toBeInstanceOf(ForbiddenException);
  });

  it('org ADMIN (não-assignee) acessa o histórico', async () => {
    prisma.dTask.findFirst.mockResolvedValue(task());
    prisma.dProject.findFirst.mockResolvedValue({ idEstab: BigInt(10) });
    roleResolver.getOrgRole.mockResolvedValue('ADMIN');
    prisma.dEvento.findMany.mockResolvedValue([eventoRow()]);

    const res = await service.getHistory('777', OTHER);
    expect(res.total).toBe(1);
  });

  it('assignee lê o próprio histórico com versões ordenadas por versão desc e flags corretas', async () => {
    prisma.dTask.findFirst.mockResolvedValue(task());
    // Ordem cronológica desc (como vem do banco): vigente primeiro.
    prisma.dEvento.findMany.mockResolvedValue([
      eventoRow({
        chave: BigInt(9002),
        excluido: false,
        criadoEm: new Date('2026-07-02T10:00:00Z'),
        metaDados: { taskId: '777', motivoClasse: '-535', version: 2, supersededBy: null },
      }),
      eventoRow({
        chave: BigInt(9001),
        excluido: true,
        criadoEm: new Date('2026-07-01T10:00:00Z'),
        metaDados: { taskId: '777', motivoClasse: '-531', version: 1, supersededBy: '9002' },
      }),
    ]);

    const res = await service.getHistory('777', ASSIGNEE);

    expect(res.taskId).toBe('777');
    expect(res.total).toBe(2);
    expect(res.items[0]).toMatchObject({
      id: '9002',
      version: 2,
      isVigente: true,
      supersededBy: null,
      motivoClasse: '-535',
    });
    expect(res.items[1]).toMatchObject({
      id: '9001',
      version: 1,
      isVigente: false,
      supersededBy: '9002',
      motivoClasse: '-531',
    });
    // findMany busca TODAS as versões (sem filtro excluido).
    expect(prisma.dEvento.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ identificadorExterno: '777' }),
      }),
    );
    const call = prisma.dEvento.findMany.mock.calls[0][0];
    expect(call.where).not.toHaveProperty('excluido');
  });
});

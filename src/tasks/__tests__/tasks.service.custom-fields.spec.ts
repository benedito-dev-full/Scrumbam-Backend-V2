import { BadRequestException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { PrismaService } from '../../prisma.service';
import { CorrelationIdService } from '../../common/services/correlation-id.service';
import { TimezoneService } from '../../common/services/timezone.service';
import { EventProducerService } from '../../eventos/core/event-producer.service';
import { PhaseHierarchyService } from '../services/phase-hierarchy.service';
import { PhaseMetricsService } from '../services/phase-metrics.service';
import { TasksIdentifierService } from '../tasks-identifier.service';
import { TasksService } from '../tasks.service';

type PrismaMock = {
  dProject: { findFirst: jest.Mock };
  dTask: { create: jest.Mock; findFirst: jest.Mock; findMany: jest.Mock; update: jest.Mock };
  dTabela: { findFirst: jest.Mock; findMany: jest.Mock; create: jest.Mock; update: jest.Mock };
  dEntidade: { findFirst: jest.Mock };
  dPedido: { findMany: jest.Mock };
  $transaction: jest.Mock;
};

/** Helper: monta uma DTask suficiente para `TasksService.buildResponse`. */
function makeTask(overrides: Partial<Record<string, unknown>> = {}) {
  return {
    chave: BigInt(7),
    idClasse: BigInt(-154),
    nome: 'Task',
    descricao: null,
    idProject: BigInt(1),
    idPai: null,
    idStatus: null,
    idPriority: null,
    idAssignee: null,
    idSprint: null,
    dueDate: null,
    dados: { identifier: 'DEV-7', v3: { state: 'INBOX' }, fields: {} },
    criadoEm: new Date('2026-05-30T00:00:00.000Z'),
    atualizadoEm: new Date('2026-05-30T00:00:00.000Z'),
    ...overrides,
  };
}

/** Helper: schema minimo de `DProject.tableFields`. */
function tableFields(columns: Array<Record<string, unknown>>) {
  return { version: 1, columns };
}

describe('TasksService custom fields update', () => {
  let service: TasksService;
  let prisma: PrismaMock;

  beforeEach(async () => {
    const prismaMock: PrismaMock = {
      dProject: { findFirst: jest.fn() },
      dTask: {
        create: jest.fn(),
        findFirst: jest.fn(),
        findMany: jest.fn(),
        update: jest.fn(),
      },
      dTabela: {
        findFirst: jest.fn(),
        findMany: jest.fn().mockResolvedValue([]),
        create: jest.fn(),
        update: jest.fn(),
      },
      dEntidade: { findFirst: jest.fn().mockResolvedValue({ nome: 'Tester' }) },
      dPedido: { findMany: jest.fn().mockResolvedValue([]) },
      $transaction: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TasksService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: TasksIdentifierService, useValue: { getNextIdentifier: jest.fn() } },
        { provide: EventProducerService, useValue: { addInternalEvent: jest.fn() } },
        { provide: CorrelationIdService, useValue: { getOrGenerate: jest.fn() } },
        {
          provide: PhaseHierarchyService,
          useValue: {
            validateNoCycle: jest.fn(),
            validateProjectConsistency: jest.fn(),
            softDeleteCascade: jest.fn(),
          },
        },
        { provide: PhaseMetricsService, useValue: { compute: jest.fn() } },
        {
          provide: TimezoneService,
          useValue: {
            getPeriodDates: jest.fn(),
            toStartOfDayBrazil: jest.fn(),
            toEndOfDayBrazil: jest.fn(),
            applyDateFilters: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(TasksService);
    prisma = module.get(PrismaService) as unknown as PrismaMock;
  });

  it('mescla dados.fields por chave sem apagar celulas existentes', async () => {
    const dadosAtuais = {
      identifier: 'DEV-7',
      v3: { state: 'INBOX' },
      fields: { f_text: 'antigo', f_num: 10 },
    };
    let updateData: Record<string, unknown> | null = null;

    prisma.dTask.findFirst.mockResolvedValue(makeTask({ dados: dadosAtuais }));
    prisma.dProject.findFirst.mockResolvedValue({
      tableFields: tableFields([
        { key: 'f_text', type: 'text', label: 'Texto', order: 0 },
        { key: 'f_num', type: 'number', label: 'Numero', order: 1 },
      ]),
    });
    prisma.dTask.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      updateData = data;
      return Promise.resolve(makeTask({ dados: data.dados }));
    });

    const result = await service.update('7', { dados: { fields: { f_text: 'novo' } } });

    expect(updateData).not.toBeNull();
    const dadosPersistidos = (updateData as unknown as Record<string, unknown>).dados as Record<
      string,
      unknown
    >;
    expect(dadosPersistidos.fields).toEqual({ f_text: 'novo', f_num: 10 });
    expect(dadosPersistidos.identifier).toBe('DEV-7');
    expect((result.dados as Record<string, unknown>).fields).toEqual({
      f_text: 'novo',
      f_num: 10,
    });
    expect(prisma.dProject.findFirst).toHaveBeenCalledTimes(1);
    expect(prisma.dProject.findFirst).toHaveBeenCalledWith({
      where: { chave: BigInt(1), excluido: false },
      select: { tableFields: true },
    });
  });

  it('ignora chaves desconhecidas no payload de fields', async () => {
    const dadosAtuais = {
      identifier: 'DEV-7',
      v3: { state: 'INBOX' },
      fields: { f_text: 'mantem' },
    };
    let updateData: Record<string, unknown> | null = null;

    prisma.dTask.findFirst.mockResolvedValue(makeTask({ dados: dadosAtuais }));
    prisma.dProject.findFirst.mockResolvedValue({
      tableFields: tableFields([{ key: 'f_text', type: 'text', label: 'Texto', order: 0 }]),
    });
    prisma.dTask.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      updateData = data;
      return Promise.resolve(makeTask({ dados: data.dados }));
    });

    await service.update('7', { dados: { fields: { f_unknown: 'nao persiste' } } });

    expect(updateData).not.toBeNull();
    const dadosPersistidos = (updateData as unknown as Record<string, unknown>).dados as Record<
      string,
      unknown
    >;
    expect(dadosPersistidos.fields).toEqual({ f_text: 'mantem' });
  });

  it('remove a chave quando valor null limpa celula opcional', async () => {
    const dadosAtuais = {
      identifier: 'DEV-7',
      v3: { state: 'INBOX' },
      fields: { f_text: 'mantem', f_num: 10 },
    };
    let updateData: Record<string, unknown> | null = null;

    prisma.dTask.findFirst.mockResolvedValue(makeTask({ dados: dadosAtuais }));
    prisma.dProject.findFirst.mockResolvedValue({
      tableFields: tableFields([
        { key: 'f_text', type: 'text', label: 'Texto', order: 0 },
        { key: 'f_num', type: 'number', label: 'Numero', order: 1 },
      ]),
    });
    prisma.dTask.update.mockImplementation(({ data }: { data: Record<string, unknown> }) => {
      updateData = data;
      return Promise.resolve(makeTask({ dados: data.dados }));
    });

    await service.update('7', { dados: { fields: { f_num: null } } });

    expect(updateData).not.toBeNull();
    const dadosPersistidos = (updateData as unknown as Record<string, unknown>).dados as Record<
      string,
      unknown
    >;
    expect(dadosPersistidos.fields).toEqual({ f_text: 'mantem' });
  });

  it('rejeita valor invalido antes de persistir update', async () => {
    prisma.dTask.findFirst.mockResolvedValue(
      makeTask({ dados: { identifier: 'DEV-7', v3: { state: 'INBOX' }, fields: {} } }),
    );
    prisma.dProject.findFirst.mockResolvedValue({
      tableFields: tableFields([{ key: 'f_num', type: 'number', label: 'Numero', order: 0 }]),
    });

    await expect(
      service.update('7', { dados: { fields: { f_num: 'invalido' } } }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.dTask.update).not.toHaveBeenCalled();
  });

  it('rejeita null em coluna required antes de persistir update', async () => {
    prisma.dTask.findFirst.mockResolvedValue(
      makeTask({ dados: { identifier: 'DEV-7', v3: { state: 'INBOX' }, fields: {} } }),
    );
    prisma.dProject.findFirst.mockResolvedValue({
      tableFields: tableFields([
        { key: 'f_req', type: 'text', label: 'Obrigatorio', order: 0, required: true },
      ]),
    });

    await expect(
      service.update('7', { dados: { fields: { f_req: null } } }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.dTask.update).not.toHaveBeenCalled();
  });

  it('rejeita dados.fields em task sem projeto (idProject null)', async () => {
    prisma.dTask.findFirst.mockResolvedValue(makeTask({ idProject: null }));

    await expect(
      service.update('7', { dados: { fields: { f_text: 'x' } } }),
    ).rejects.toThrow(BadRequestException);

    expect(prisma.dTask.update).not.toHaveBeenCalled();
  });
});

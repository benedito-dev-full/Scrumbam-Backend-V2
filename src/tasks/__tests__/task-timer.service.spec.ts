import { Test, TestingModule } from '@nestjs/testing';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TaskTimerService } from '../services/task-timer.service';
import { PrismaService } from '../../prisma.service';
import { EventProducerService } from '../../eventos/core/event-producer.service';
import { CorrelationIdService } from '../../common/services/correlation-id.service';
import { ManualTimerSession } from '../schemas/task-dados.schema';

/**
 * Testes unitários do TaskTimerService (ADR-V2-057).
 *
 * Cobrem: aritmética server-side anti-fraude, regra 1-timer (409),
 * pause/stop sem sessão aberta (409), agregação por usuário com batch de nomes,
 * tenant gate (404 anti-enumeration), e separação total do fluxo de IA.
 */
describe('TaskTimerService', () => {
  let service: TaskTimerService;
  let prisma: {
    dTask: { findFirst: jest.Mock; update: jest.Mock };
    dEntidade: { findMany: jest.Mock };
  };
  let eventProducer: { addInternalEvent: jest.Mock };

  /** Constrói um registro DTask de mock com dados.telemetry.manualTimers. */
  function makeTask(
    manualTimers: ManualTimerSession[] = [],
    overrides: Partial<{
      chave: bigint;
      idProject: bigint | null;
      extraTelemetry: Record<string, unknown>;
      extraDados: Record<string, unknown>;
    }> = {},
  ) {
    return {
      chave: overrides.chave ?? BigInt(7),
      idProject: overrides.idProject ?? BigInt(1),
      dados: {
        identifier: 'DEV-7',
        v3: { state: 'INBOX' },
        ...overrides.extraDados,
        telemetry: {
          ...overrides.extraTelemetry,
          manualTimers,
        },
      },
    };
  }

  beforeEach(async () => {
    const prismaMock = {
      dTask: {
        findFirst: jest.fn(),
        update: jest.fn().mockResolvedValue({}),
      },
      dEntidade: { findMany: jest.fn().mockResolvedValue([]) },
    };
    const eventProducerMock = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };
    const correlationIdMock = { getOrGenerate: jest.fn().mockReturnValue('corr-1') };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TaskTimerService,
        { provide: PrismaService, useValue: prismaMock },
        { provide: EventProducerService, useValue: eventProducerMock },
        { provide: CorrelationIdService, useValue: correlationIdMock },
      ],
    }).compile();

    service = module.get(TaskTimerService);
    prisma = module.get(PrismaService) as typeof prisma;
    eventProducer = module.get(EventProducerService) as typeof eventProducer;
  });

  afterEach(() => jest.clearAllMocks());

  /** Extrai o manualTimers persistido na última chamada de dTask.update. */
  function persistedManualTimers(): ManualTimerSession[] {
    const call = prisma.dTask.update.mock.calls.at(-1)?.[0];
    return call.data.dados.telemetry.manualTimers as ManualTimerSession[];
  }

  // ─── start ────────────────────────────────────────────────────────────────

  describe('start()', () => {
    it('abre sessão com userId do JWT (não do body) e startedAt server-side', async () => {
      prisma.dTask.findFirst.mockResolvedValue(makeTask([]));

      const before = Date.now();
      const res = await service.start('7', BigInt(42));
      const after = Date.now();

      const timers = persistedManualTimers();
      expect(timers).toHaveLength(1);
      expect(timers[0].userId).toBe('42');
      expect(timers[0].endedAt).toBeUndefined();
      const started = new Date(timers[0].startedAt).getTime();
      expect(started).toBeGreaterThanOrEqual(before);
      expect(started).toBeLessThanOrEqual(after);
      expect(res.manualTimers).toBe(timers);
    });

    it('lança 409 se já há sessão aberta (de qualquer usuário) — regra 1-timer', async () => {
      prisma.dTask.findFirst.mockResolvedValue(
        makeTask([{ userId: '99', startedAt: '2026-06-01T10:00:00.000Z' }]),
      );

      await expect(service.start('7', BigInt(42))).rejects.toBeInstanceOf(ConflictException);
      expect(prisma.dTask.update).not.toHaveBeenCalled();
    });

    it('NÃO emite DEvento de auditoria no start', async () => {
      prisma.dTask.findFirst.mockResolvedValue(makeTask([]));
      await service.start('7', BigInt(42));
      expect(eventProducer.addInternalEvent).not.toHaveBeenCalled();
    });
  });

  // ─── close (pause / stop) ───────────────────────────────────────────────────

  describe('close() — pause/stop', () => {
    it('grava endedAt + durationMs SERVER-SIDE (anti-fraude)', async () => {
      const startedAt = new Date(Date.now() - 60_000).toISOString(); // 1 min atrás
      prisma.dTask.findFirst.mockResolvedValue(makeTask([{ userId: '42', startedAt }]));

      await service.close('7', BigInt(42), undefined, 'pause');

      const timers = persistedManualTimers();
      expect(timers[0].endedAt).toBeDefined();
      // duração ~60000ms; calculada do Date do servidor, não do body
      expect(timers[0].durationMs).toBeGreaterThanOrEqual(59_000);
      expect(timers[0].durationMs).toBeLessThanOrEqual(61_000);
    });

    it('lança 409 se não há sessão aberta para o usuário', async () => {
      prisma.dTask.findFirst.mockResolvedValue(makeTask([]));
      await expect(service.close('7', BigInt(42), undefined, 'stop')).rejects.toBeInstanceOf(
        ConflictException,
      );
      expect(prisma.dTask.update).not.toHaveBeenCalled();
    });

    it('lança 409 se a sessão aberta é de OUTRO usuário', async () => {
      prisma.dTask.findFirst.mockResolvedValue(
        makeTask([{ userId: '99', startedAt: '2026-06-01T10:00:00.000Z' }]),
      );
      await expect(service.close('7', BigInt(42), undefined, 'pause')).rejects.toBeInstanceOf(
        ConflictException,
      );
    });

    it('emite timer.paused APÓS persistência com payload {taskId, userId, durationMs}', async () => {
      const startedAt = new Date(Date.now() - 30_000).toISOString();
      prisma.dTask.findFirst.mockResolvedValue(makeTask([{ userId: '42', startedAt }]));

      await service.close('7', BigInt(42), undefined, 'pause');

      expect(prisma.dTask.update).toHaveBeenCalledTimes(1);
      expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
        'timer.paused',
        expect.objectContaining({ taskId: '7', userId: '42', projectId: '1' }),
        'corr-1',
      );
      const payload = eventProducer.addInternalEvent.mock.calls[0][1];
      expect(typeof payload.durationMs).toBe('number');
    });

    it('emite timer.stopped no stop', async () => {
      const startedAt = new Date(Date.now() - 1000).toISOString();
      prisma.dTask.findFirst.mockResolvedValue(makeTask([{ userId: '42', startedAt }]));
      await service.close('7', BigInt(42), undefined, 'stop');
      expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
        'timer.stopped',
        expect.objectContaining({ taskId: '7', userId: '42' }),
        'corr-1',
      );
    });
  });

  // ─── tenant gate ────────────────────────────────────────────────────────────

  describe('tenant gate (ADR-V2-042)', () => {
    it('404 anti-enumeration quando task fora do accessibleProjectIds', async () => {
      prisma.dTask.findFirst.mockResolvedValue(makeTask([], { idProject: BigInt(99) }));
      await expect(service.start('7', BigInt(42), ['1', '2'])).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('404 quando task inexistente', async () => {
      prisma.dTask.findFirst.mockResolvedValue(null);
      await expect(service.start('7', BigInt(42), ['1'])).rejects.toBeInstanceOf(
        NotFoundException,
      );
    });

    it('permite quando projectId está no scope', async () => {
      prisma.dTask.findFirst.mockResolvedValue(makeTask([], { idProject: BigInt(1) }));
      await expect(service.start('7', BigInt(42), ['1'])).resolves.toBeDefined();
    });
  });

  // ─── preservação do fluxo de IA ──────────────────────────────────────────────

  describe('separação manual × IA (ADR-V2-057)', () => {
    it('NÃO sobrescreve workSessions/cycleTime/leadTime ao persistir manualTimers', async () => {
      prisma.dTask.findFirst.mockResolvedValue(
        makeTask([], {
          extraTelemetry: {
            workSessions: [{ startedAt: '2026-06-01T08:00:00.000Z', endedAt: '2026-06-01T09:00:00.000Z' }],
            cycleTime: 3600000,
            leadTime: 7200000,
            readyAt: '2026-06-01T07:00:00.000Z',
          },
        }),
      );

      await service.start('7', BigInt(42));

      const telemetry = prisma.dTask.update.mock.calls[0][0].data.dados.telemetry;
      expect(telemetry.workSessions).toEqual([
        { startedAt: '2026-06-01T08:00:00.000Z', endedAt: '2026-06-01T09:00:00.000Z' },
      ]);
      expect(telemetry.cycleTime).toBe(3600000);
      expect(telemetry.leadTime).toBe(7200000);
      expect(telemetry.readyAt).toBe('2026-06-01T07:00:00.000Z');
      expect(telemetry.manualTimers).toHaveLength(1);
    });

    it('preserva campos não-telemetria do dados (identifier, v3)', async () => {
      prisma.dTask.findFirst.mockResolvedValue(makeTask([]));
      await service.start('7', BigInt(42));
      const dados = prisma.dTask.update.mock.calls[0][0].data.dados;
      expect(dados.identifier).toBe('DEV-7');
      expect(dados.v3).toEqual({ state: 'INBOX' });
    });
  });

  // ─── buildTimerState (agregação pura) ─────────────────────────────────────────

  describe('buildTimerState()', () => {
    it('retorna null quando não há manualTimers', () => {
      expect(service.buildTimerState(undefined)).toBeNull();
      expect(service.buildTimerState([])).toBeNull();
    });

    it('agrega durationMs por usuário e ordena por userId asc', () => {
      const timers: ManualTimerSession[] = [
        { userId: '43', startedAt: 'x', endedAt: 'y', durationMs: 1000 },
        { userId: '42', startedAt: 'x', endedAt: 'y', durationMs: 2000 },
        { userId: '42', startedAt: 'x', endedAt: 'y', durationMs: 500 },
      ];
      const state = service.buildTimerState(timers, new Map([['42', 'Fulano']]));
      expect(state).not.toBeNull();
      expect(state!.running).toBe(false);
      expect(state!.totalsByUser).toEqual([
        { userId: '42', userName: 'Fulano', totalMs: 2500 },
        { userId: '43', userName: null, totalMs: 1000 },
      ]);
    });

    it('reflete sessão aberta em running/runningUserId/runningStartedAt', () => {
      const timers: ManualTimerSession[] = [
        { userId: '42', startedAt: 's1', endedAt: 'e1', durationMs: 1000 },
        { userId: '43', startedAt: 's2' }, // aberta
      ];
      const state = service.buildTimerState(timers);
      expect(state!.running).toBe(true);
      expect(state!.runningUserId).toBe('43');
      expect(state!.runningStartedAt).toBe('s2');
      // sessão aberta (sem durationMs) NÃO entra no total
      expect(state!.totalsByUser).toEqual([{ userId: '42', userName: null, totalMs: 1000 }]);
    });
  });

  // ─── buildTimerStateMap (batch ZERO N+1) ──────────────────────────────────────

  describe('buildTimerStateMap()', () => {
    it('hidrata nomes em UMA query batch (ZERO N+1)', async () => {
      prisma.dEntidade.findMany.mockResolvedValue([
        { chave: BigInt(42), nome: 'Fulano' },
        { chave: BigInt(43), nome: 'Beltrano' },
      ]);

      const tasks = [
        {
          chave: BigInt(7),
          dados: {
            telemetry: {
              manualTimers: [
                { userId: '42', startedAt: 'x', endedAt: 'y', durationMs: 1000 },
                { userId: '43', startedAt: 'x', endedAt: 'y', durationMs: 2000 },
              ],
            },
          },
        },
        { chave: BigInt(8), dados: { telemetry: {} } }, // sem timer → ausente do map
      ];

      const map = await service.buildTimerStateMap(tasks);

      expect(prisma.dEntidade.findMany).toHaveBeenCalledTimes(1);
      expect(map.has('7')).toBe(true);
      expect(map.has('8')).toBe(false);
      const totals = map.get('7')!.totalsByUser;
      expect(totals).toEqual([
        { userId: '42', userName: 'Fulano', totalMs: 1000 },
        { userId: '43', userName: 'Beltrano', totalMs: 2000 },
      ]);
    });

    it('não consulta DEntidade quando nenhuma task tem timer', async () => {
      const map = await service.buildTimerStateMap([
        { chave: BigInt(7), dados: { telemetry: {} } },
      ]);
      expect(prisma.dEntidade.findMany).not.toHaveBeenCalled();
      expect(map.size).toBe(0);
    });
  });
});

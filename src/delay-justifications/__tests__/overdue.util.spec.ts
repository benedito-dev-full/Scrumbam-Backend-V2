import { TimezoneService } from '../../common/services/timezone.service';
import { TaskDados, TaskStatus } from '../../tasks/schemas/task-dados.schema';
import { computeOverdue } from '../overdue.util';

/**
 * Testes do critério de atraso por DIA DE CALENDÁRIO (America/Sao_Paulo).
 *
 * `TimezoneService` é usado REAL (sem deps de DI) para exercitar a conversão
 * de fuso de verdade. Datas em UTC com horas de Brasília em mente:
 * Brasília = UTC−03:00.
 */
describe('computeOverdue', () => {
  const tz = new TimezoneService();

  /** Helper: monta dados com estado V3. */
  const withState = (state: TaskStatus): TaskDados => ({ v3: { state } });

  it('não atrasada quando dueDate é null', () => {
    const r = computeOverdue(
      { dueDate: null, dados: withState('READY'), atualizadoEm: new Date() },
      tz,
    );
    expect(r).toEqual({ isOverdue: false, delayKind: null, delayDays: 0 });
  });

  it('aberta no prazo (hoje == dia do prazo) → não atrasada', () => {
    // dueDate 2026-07-05 12:00 BRT; now 2026-07-05 20:00 BRT (mesmo dia)
    const dueDate = new Date('2026-07-05T15:00:00Z'); // 12:00 BRT
    const now = new Date('2026-07-05T23:00:00Z'); // 20:00 BRT
    const r = computeOverdue(
      { dueDate, dados: withState('EXECUTING'), atualizadoEm: now },
      tz,
      now,
    );
    expect(r.isOverdue).toBe(false);
  });

  it('aberta e atrasada (OPEN) → delayDays = dias de calendário', () => {
    const dueDate = new Date('2026-07-01T15:00:00Z'); // 01/07 BRT
    const now = new Date('2026-07-05T15:00:00Z'); // 05/07 BRT
    const r = computeOverdue({ dueDate, dados: withState('READY'), atualizadoEm: now }, tz, now);
    expect(r).toEqual({ isOverdue: true, delayKind: 'OPEN', delayDays: 4 });
  });

  it('concluída no prazo (doneAt no mesmo dia) → não atrasada', () => {
    const dueDate = new Date('2026-07-05T15:00:00Z');
    const dados: TaskDados = {
      v3: { state: 'DONE' },
      telemetry: { doneAt: '2026-07-05T22:00:00Z' }, // 19:00 BRT, mesmo dia
    };
    const r = computeOverdue({ dueDate, dados, atualizadoEm: new Date() }, tz);
    expect(r.isOverdue).toBe(false);
  });

  it('concluída com atraso (COMPLETED_LATE) usa telemetry.doneAt', () => {
    const dueDate = new Date('2026-07-01T15:00:00Z'); // 01/07
    const dados: TaskDados = {
      v3: { state: 'DONE' },
      telemetry: { doneAt: '2026-07-04T12:00:00Z' }, // 04/07 (3 dias depois)
    };
    // atualizadoEm bem depois (ruído) NÃO deve ser usado — doneAt vence
    const r = computeOverdue(
      { dueDate, dados, atualizadoEm: new Date('2026-07-20T00:00:00Z') },
      tz,
    );
    expect(r).toEqual({ isOverdue: true, delayKind: 'COMPLETED_LATE', delayDays: 3 });
  });

  it('VALIDATED sem doneAt cai para v3.movedAt (fallback)', () => {
    const dueDate = new Date('2026-07-01T15:00:00Z'); // 01/07
    const dados: TaskDados = {
      v3: { state: 'VALIDATED', movedAt: '2026-07-03T12:00:00Z' }, // 03/07
      telemetry: {},
    };
    const r = computeOverdue({ dueDate, dados, atualizadoEm: new Date() }, tz);
    expect(r).toEqual({ isOverdue: true, delayKind: 'COMPLETED_LATE', delayDays: 2 });
  });

  it('estado terminal sem doneAt nem movedAt cai para atualizadoEm (último recurso)', () => {
    const dueDate = new Date('2026-07-01T15:00:00Z'); // 01/07
    const dados: TaskDados = { v3: { state: 'DONE' }, telemetry: {} };
    const atualizadoEm = new Date('2026-07-06T12:00:00Z'); // 06/07
    const r = computeOverdue({ dueDate, dados, atualizadoEm }, tz);
    expect(r).toEqual({ isOverdue: true, delayKind: 'COMPLETED_LATE', delayDays: 5 });
  });

  it('VALIDATING é tratado como concluído (doneAt persiste)', () => {
    const dueDate = new Date('2026-07-01T15:00:00Z');
    const dados: TaskDados = {
      v3: { state: 'VALIDATING' },
      telemetry: { doneAt: '2026-07-02T12:00:00Z' }, // 02/07
    };
    const r = computeOverdue({ dueDate, dados, atualizadoEm: new Date() }, tz);
    expect(r).toEqual({ isOverdue: true, delayKind: 'COMPLETED_LATE', delayDays: 1 });
  });

  /* ── Virada de dia ──────────────────────────────────────────────────────────
   * NOTA: a fixture destes dois casos foi corrigida. Antes usavam
   * `dueDate = 2026-07-05T02:00:00Z` chamando isso de "prazo 04/07 em Brasília"
   * — ou seja, tratavam `dueDate` como um INSTANTE com hora do dia. O sistema
   * nunca produz esse valor: o prazo é uma DATA CIVIL, persistida como
   * meia-noite UTC (`new Date('2026-07-04')` → `2026-07-04T00:00:00.000Z`), e a
   * UI é um date-picker sem hora. A premissa antiga é o que fazia toda task com
   * prazo HOJE nascer atrasada. Ver `overdue-due-today.spec.ts`. */

  it('virada de dia: prazo 04/07, agora 05/07 00:30 BRT → atrasada 1 dia', () => {
    const dueDate = new Date('2026-07-04T00:00:00.000Z'); // data civil 04/07
    // now: 05/07 00:30 BRT = 2026-07-05T03:30:00Z (já é dia 05 em Brasília)
    const now = new Date('2026-07-05T03:30:00Z');
    const r = computeOverdue(
      { dueDate, dados: { v3: { state: 'READY' } }, atualizadoEm: now },
      tz,
      now,
    );
    expect(r).toEqual({ isOverdue: true, delayKind: 'OPEN', delayDays: 1 });
  });

  it('ainda 04/07 em Brasília (20:30 BRT do próprio dia do prazo) → NÃO atrasada', () => {
    const dueDate = new Date('2026-07-04T00:00:00.000Z'); // data civil 04/07
    const now = new Date('2026-07-04T23:30:00Z'); // 20:30 BRT do dia 04
    const r = computeOverdue(
      { dueDate, dados: { v3: { state: 'READY' } }, atualizadoEm: now },
      tz,
      now,
    );
    expect(r.isOverdue).toBe(false);
  });

  it('sem estado V3 (dados vazio) trata como aberto', () => {
    const dueDate = new Date('2026-07-01T15:00:00Z');
    const now = new Date('2026-07-03T15:00:00Z');
    const r = computeOverdue({ dueDate, dados: null, atualizadoEm: now }, tz, now);
    expect(r).toEqual({ isOverdue: true, delayKind: 'OPEN', delayDays: 2 });
  });
});

import { TimezoneService } from '../../common/services/timezone.service';
import { computeOverdue } from '../overdue.util';

/**
 * Regressão: **task que vence HOJE não está atrasada.**
 *
 * O `dueDate` chega do banco como meia-noite UTC (`2026-07-13T00:00:00.000Z`),
 * porque a API recebe a data civil `'2026-07-13'` e faz `new Date(...)`. Em
 * America/Sao_Paulo isso é 21:00 do dia 12 — e o código antigo normalizava esse
 * valor para "o dia em Brasília", obtendo o dia 12. Resultado: toda tarefa com
 * prazo hoje nascia com 1 dia de atraso, e a justificativa de atraso era exigida
 * indevidamente.
 *
 * Atrasada = o DIA do prazo JÁ PASSOU. No dia do prazo, a tarefa vence hoje.
 */
describe('computeOverdue — prazo é dia civil, não instante', () => {
  const tz = new TimezoneService();

  /** `dueDate` como o banco persiste: meia-noite UTC da data civil escolhida. */
  const dueDate = (civil: string) => new Date(`${civil}T00:00:00.000Z`);

  /** Um instante real durante o dia, em Brasília (14h BRT = 17h UTC). */
  const duranteODia = (civil: string) => new Date(`${civil}T17:00:00.000Z`);

  const aberta = {
    dados: { v3: { state: 'READY' as const } },
    atualizadoEm: new Date(),
  };

  it('NÃO está atrasada no próprio dia do prazo (o bug do painel)', () => {
    const r = computeOverdue(
      { ...aberta, dueDate: dueDate('2026-07-13') },
      tz,
      duranteODia('2026-07-13'),
    );

    expect(r.isOverdue).toBe(false);
    expect(r.delayDays).toBe(0);
  });

  it('NÃO está atrasada nem no fim do dia do prazo (23h BRT)', () => {
    const r = computeOverdue(
      { ...aberta, dueDate: dueDate('2026-07-13') },
      tz,
      new Date('2026-07-14T02:00:00.000Z'), // 23h de 13/07 em Brasília
    );

    expect(r.isOverdue).toBe(false);
  });

  it('passa a estar atrasada no dia SEGUINTE, com 1 dia', () => {
    const r = computeOverdue(
      { ...aberta, dueDate: dueDate('2026-07-13') },
      tz,
      duranteODia('2026-07-14'),
    );

    expect(r.isOverdue).toBe(true);
    expect(r.delayKind).toBe('OPEN');
    expect(r.delayDays).toBe(1);
  });

  it('conta os dias de atraso corretamente (4 dias)', () => {
    const r = computeOverdue(
      { ...aberta, dueDate: dueDate('2026-07-01') },
      tz,
      duranteODia('2026-07-05'),
    );

    expect(r.delayDays).toBe(4);
  });

  it('concluir no próprio dia do prazo NÃO é conclusão atrasada', () => {
    const r = computeOverdue(
      {
        dueDate: dueDate('2026-07-13'),
        dados: {
          v3: { state: 'DONE' as const },
          telemetry: { doneAt: duranteODia('2026-07-13').toISOString() },
        },
        atualizadoEm: new Date(),
      },
      tz,
      duranteODia('2026-07-20'),
    );

    expect(r.isOverdue).toBe(false);
  });

  it('concluir no dia seguinte ao prazo É conclusão atrasada', () => {
    const r = computeOverdue(
      {
        dueDate: dueDate('2026-07-13'),
        dados: {
          v3: { state: 'DONE' as const },
          telemetry: { doneAt: duranteODia('2026-07-14').toISOString() },
        },
        atualizadoEm: new Date(),
      },
      tz,
      duranteODia('2026-07-20'),
    );

    expect(r.isOverdue).toBe(true);
    expect(r.delayKind).toBe('COMPLETED_LATE');
    expect(r.delayDays).toBe(1);
  });
});

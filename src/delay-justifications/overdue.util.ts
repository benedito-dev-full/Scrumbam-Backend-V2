import { TimezoneService } from '../common/services/timezone.service';
import { TaskDados, TaskStatus } from '../tasks/schemas/task-dados.schema';

/**
 * Natureza do atraso de uma tarefa.
 *
 * - `OPEN` — tarefa AINDA em aberto (estado não-terminal) cujo `dueDate` já
 *   passou. O atraso cresce a cada dia.
 * - `COMPLETED_LATE` — tarefa concluída (DONE/VALIDATING/VALIDATED) DEPOIS do
 *   `dueDate`. O atraso é fixo (dia de conclusão − dia do prazo).
 */
export type DelayKind = 'OPEN' | 'COMPLETED_LATE';

/**
 * Estados "concluídos" para fins de atraso. Cobrem toda a cauda terminal do
 * ciclo V3 em que a tarefa já teve seu trabalho encerrado:
 * - `DONE` — concluída (grava `telemetry.doneAt` server-side).
 * - `VALIDATING` — concluída, aguardando validação (`doneAt` PERSISTE).
 * - `VALIDATED` — concluída e validada (`doneAt` PERSISTE).
 *
 * Incluir `VALIDATING`/`VALIDATED` (além de `DONE`) é fiel à nota do plano §4:
 * `telemetry.doneAt` é purpose-built para o momento de conclusão e persiste
 * ao longo de DONE→VALIDATING→VALIDATED. Tratar VALIDATING como "aberto"
 * (acumulando dias) superestimaria o atraso de uma tarefa já concluída.
 */
const COMPLETED_STATES: ReadonlySet<TaskStatus> = new Set<TaskStatus>([
  'DONE',
  'VALIDATING',
  'VALIDATED',
]);

/** Milissegundos em um dia de calendário (Brasil não tem DST desde 2019). */
const MS_PER_DAY = 86_400_000;

/**
 * Entrada mínima para avaliar o atraso de uma tarefa. Todos os campos vêm da
 * própria linha de `DTask` já carregada — NUNCA gera query adicional
 * (compatível com o requisito de ZERO N+1 do `pending-count`).
 */
export interface OverdueInput {
  /** `DTask.dueDate` — prazo. `null` significa "sem prazo" → nunca atrasada. */
  dueDate: Date | null;
  /** `DTask.dados` (Json) já parseado — fonte de `v3.state`, `telemetry.doneAt`, `v3.movedAt`. */
  dados: TaskDados | null;
  /** `DTask.atualizadoEm` — último recurso da cascata do dia de conclusão. */
  atualizadoEm: Date;
}

/**
 * Resultado da avaliação de atraso.
 */
export interface OverdueResult {
  /** `true` se a tarefa está atrasada (aberta ou concluída-com-atraso). */
  isOverdue: boolean;
  /** Natureza do atraso, ou `null` se não atrasada. */
  delayKind: DelayKind | null;
  /** Dias de atraso (> 0 quando atrasada; 0 caso contrário). */
  delayDays: number;
}

const NOT_OVERDUE: OverdueResult = Object.freeze({
  isOverdue: false,
  delayKind: null,
  delayDays: 0,
});

/**
 * Dia civil (`yyyy-MM-dd`) de um `dueDate`.
 *
 * `dueDate` NÃO é um instante — é uma **data civil** ("dia 13 de julho"), que o
 * banco persiste como `2026-07-13T00:00:00.000Z` (meia-noite UTC), porque a API
 * recebe `'2026-07-13'` e faz `new Date(...)` (`tasks.service.ts`).
 *
 * Portanto ele NÃO pode passar por `toStartOfDayBrazil`: meia-noite UTC é 21:00
 * do dia ANTERIOR em Brasília, e normalizar isso para o dia brasileiro devolve
 * sempre **um dia a menos** — o que fazia toda tarefa com prazo HOJE ser lida
 * como vencida ONTEM. A leitura correta é ler a parte de data do próprio UTC,
 * que é exatamente o dia que o usuário escolheu.
 */
function civilDayOfDueDate(dueDate: Date): string {
  return dueDate.toISOString().slice(0, 10);
}

/**
 * Dia civil (`yyyy-MM-dd`) em America/Sao_Paulo de um **instante real**
 * (`now`, `doneAt`, `atualizadoEm`).
 *
 * Estes SÃO instantes de verdade — gerados por `new Date()` no servidor — e por
 * isso devem mesmo ser convertidos para o dia brasileiro. É a assimetria que o
 * bug original ignorava: prazo é DIA, conclusão é INSTANTE.
 */
function brazilDayOfInstant(instant: Date, tz: TimezoneService): string {
  return tz.toStartOfDayBrazil(instant).toISOString().slice(0, 10);
}

/**
 * Diferença em DIAS DE CALENDÁRIO entre um instante real e o dia do prazo.
 *
 * @param instant - Instante real (agora, ou momento de conclusão).
 * @param dueDate - Prazo (data civil).
 * @param tz - Serviço de timezone (dia em Brasília, para o lado do instante).
 * @returns `dia(instant) − dia(dueDate)` em dias inteiros. `0` = vence hoje;
 *   positivo = atrasada; negativo = ainda dentro do prazo.
 */
function calendarDayDiffBrazil(instant: Date, dueDate: Date, tz: TimezoneService): number {
  const a = Date.parse(`${brazilDayOfInstant(instant, tz)}T00:00:00Z`);
  const b = Date.parse(`${civilDayOfDueDate(dueDate)}T00:00:00Z`);
  return Math.round((a - b) / MS_PER_DAY);
}

/**
 * Resolve o "dia de conclusão" de uma tarefa concluída seguindo a cascata do
 * CEO (plano §4, decisão 2), da fonte mais confiável à de último recurso:
 *
 * 1. `dados.telemetry.doneAt` — gravado server-side na transição para DONE e
 *    persiste até VALIDATED. Primário.
 * 2. `dados.v3.movedAt` quando o estado é terminal (`DONE`/`VALIDATED`) —
 *    cobre linhas legadas/importadas sem `telemetry.doneAt`. Fallback.
 * 3. `atualizadoEm` — rede de segurança (ruidoso: bumpado por qualquer
 *    escrita). Último recurso.
 *
 * @param dados - `DTask.dados` já parseado.
 * @param state - Estado V3 atual da tarefa.
 * @param atualizadoEm - Coluna `DTask.atualizadoEm`.
 * @returns Data que representa o momento de conclusão.
 */
function resolveCompletionDate(
  dados: TaskDados | null,
  state: TaskStatus,
  atualizadoEm: Date,
): Date {
  const doneAt = dados?.telemetry?.doneAt;
  if (doneAt) {
    const parsed = new Date(doneAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  const movedAt = dados?.v3?.movedAt;
  if (movedAt && (state === 'DONE' || state === 'VALIDATED')) {
    const parsed = new Date(movedAt);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
  }

  return atualizadoEm;
}

/**
 * Avalia se uma tarefa está atrasada, por DIA DE CALENDÁRIO no timezone
 * America/Sao_Paulo — espelhando o critério do frontend (comparação por dia,
 * não por timestamp).
 *
 * Regras (plano §4):
 * - Sem `dueDate` → nunca atrasada.
 * - Estado concluído (`DONE`/`VALIDATING`/`VALIDATED`): compara o DIA de
 *   conclusão (cascata `doneAt`→`movedAt`→`atualizadoEm`) com o DIA do prazo.
 *   Se depois → `COMPLETED_LATE`.
 * - Demais estados (aberto): compara o DIA de referência (`now`) com o DIA do
 *   prazo. Se depois → `OPEN`.
 *
 * Função PURA e determinística: recebe `now` como parâmetro (default
 * `new Date()`) para testes de virada de dia. Não faz I/O.
 *
 * @param input - Campos da tarefa (dueDate, dados, atualizadoEm).
 * @param tz - `TimezoneService` (dia de calendário em Brasília).
 * @param now - Instante de referência para atraso em aberto (default: agora).
 * @returns `{ isOverdue, delayKind, delayDays }`.
 *
 * @example
 * ```typescript
 * const tz = new TimezoneService();
 * const r = computeOverdue(
 *   { dueDate: new Date('2026-07-01T12:00:00Z'), dados: { v3: { state: 'READY' } }, atualizadoEm: new Date() },
 *   tz,
 *   new Date('2026-07-05T12:00:00Z'),
 * );
 * // r.isOverdue === true, r.delayKind === 'OPEN', r.delayDays === 4
 * ```
 */
export function computeOverdue(
  input: OverdueInput,
  tz: TimezoneService,
  now: Date = new Date(),
): OverdueResult {
  if (!input.dueDate) {
    return NOT_OVERDUE;
  }

  const state = input.dados?.v3?.state;

  if (state && COMPLETED_STATES.has(state)) {
    const completionDate = resolveCompletionDate(input.dados, state, input.atualizadoEm);
    const delayDays = calendarDayDiffBrazil(completionDate, input.dueDate, tz);
    if (delayDays > 0) {
      return { isOverdue: true, delayKind: 'COMPLETED_LATE', delayDays };
    }
    return NOT_OVERDUE;
  }

  const delayDays = calendarDayDiffBrazil(now, input.dueDate, tz);
  if (delayDays > 0) {
    return { isOverdue: true, delayKind: 'OPEN', delayDays };
  }
  return NOT_OVERDUE;
}

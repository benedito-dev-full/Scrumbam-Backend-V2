import { TelemetryData, WorkSession } from './schemas/task-dados.schema';

/**
 * TTL de "staleness" (frescor) de uma workSession aberta — 2 horas.
 *
 * **Decisão do Roberio (2026-07-10, item #1):** uma task `EXECUTING` cujo dono
 * caiu sem fechar a workSession (sessão órfã) NÃO pode ficar travada para sempre
 * no MCP. Passado este TTL sem que a sessão tenha sido fechada (medido a partir
 * de `startedAt` — único carimbo temporal disponível no modelo, ADR-V2-057), a
 * sessão é considerada ÓRFÃ: o guard deixa de travar (outro caller assume) e o
 * badge deixa de exibir "em trabalho por Fulano" (evita rótulo enganoso de dias
 * atrás).
 *
 * Fonte ÚNICA compartilhada por badge (read-path) e trava (MCP write-path).
 */
export const WORK_SESSION_STALE_MS = 2 * 60 * 60 * 1000;

/**
 * Sessão de trabalho ATIVA e FRESCA de uma task — projeção enxuta de
 * {@link WorkSession} usada tanto pelo badge quanto pela trava de concorrência.
 *
 * `agentId` pode ser `null` quando a sessão foi aberta sem dono identificável
 * (`movedBy` nulo). Nesse caso a política de trava (guard) decide bloquear de
 * forma conservadora (decisão do Roberio #2), mas o dado cru é exposto como
 * `null` — quem consome decide o que fazer.
 */
export interface ActiveWorkSession {
  /** ISO 8601 — quando a sessão de trabalho foi aberta (entrada em EXECUTING). */
  startedAt: string;
  /** DEntidade.chave (string) de quem abriu a sessão, ou `null` se não identificável. */
  agentId: string | null;
}

/**
 * Extrai a workSession ATIVA (aberta e fresca) de uma task — fonte ÚNICA
 * compartilhada pelo badge "em trabalho por Fulano" e pela trava de
 * concorrência MCP (task #794 / DEV-123).
 *
 * Uma sessão é considerada ATIVA quando TODAS as condições valem:
 * 1. `status === 'EXECUTING'` — fora de EXECUTING não há trava nem badge
 *    (FAILED/CANCELLED deixam a sessão aberta mas o status muda — ADR-V2-057).
 * 2. Existe ao menos uma workSession SEM `endedAt` (sessão aberta). Quando há
 *    mais de uma aberta (caso anômalo), considera a ÚLTIMA do array.
 * 3. A sessão aberta ainda é FRESCA: `now - startedAt <= WORK_SESSION_STALE_MS`
 *    (TTL de 2h — sessão órfã expira sozinha, decisão do Roberio #1).
 *
 * Função PURA (sem I/O): recebe `nowMs` para ser determinística em testes.
 * NÃO decide bloqueio nem hidrata nome — isso é responsabilidade do guard.
 *
 * @param telemetry - `dados.telemetry` da task (pode ser null/undefined)
 * @param status - estado V3 corrente da task (derivado de `dados.v3.state`)
 * @param nowMs - instante de referência em ms (default `Date.now()`) — injetável para testes
 * @returns a sessão ativa `{ startedAt, agentId }` ou `null` se não houver trava/badge
 *
 * @example
 * ```typescript
 * const active = resolveActiveWorkSession(task.dados?.telemetry, task.status);
 * if (active) {
 *   // task está sendo trabalhada por active.agentId desde active.startedAt
 * }
 * ```
 */
export function resolveActiveWorkSession(
  telemetry: TelemetryData | null | undefined,
  status: string | null | undefined,
  nowMs: number = Date.now(),
): ActiveWorkSession | null {
  // Regra 1: fora de EXECUTING não há sessão ativa (badge oculto / sem trava).
  if (status !== 'EXECUTING') {
    return null;
  }

  const sessions = telemetry?.workSessions;
  if (!Array.isArray(sessions) || sessions.length === 0) {
    return null;
  }

  // Regra 2: última sessão SEM endedAt (aberta). Percorre do fim para o início.
  let open: WorkSession | null = null;
  for (let i = sessions.length - 1; i >= 0; i -= 1) {
    const s = sessions[i];
    if (s && !s.endedAt && typeof s.startedAt === 'string' && s.startedAt.length > 0) {
      open = s;
      break;
    }
  }

  if (!open) {
    return null;
  }

  // Regra 3: TTL de staleness (2h). startedAt inválido → trata como não-ativa.
  const startedMs = new Date(open.startedAt).getTime();
  if (!Number.isFinite(startedMs)) {
    return null;
  }
  if (nowMs - startedMs > WORK_SESSION_STALE_MS) {
    return null;
  }

  return {
    startedAt: open.startedAt,
    agentId: open.agentId ?? null,
  };
}

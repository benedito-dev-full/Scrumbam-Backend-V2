/**
 * Estados V3 Intention — 5 estados canônicos do Scrumban.
 *
 * Re-export da fonte única (`constants/task-status.const`), mantido aqui para
 * não quebrar os ~30 imports existentes de `TaskStatus`. NÃO redeclare a união
 * — edite o catálogo em {@link V3_STATUS_CODES}.
 */
import type { TaskStatus } from '../constants/task-status.const';

export type { TaskStatus };

/**
 * Sessão de trabalho automática (workSession) de uma task — **fluxo de IA**.
 *
 * **SEMÂNTICA (ADR-V2-057):** `workSessions[]` é manipulado EXCLUSIVAMENTE pelo
 * fluxo automático de IA em `TasksService.updateStatus` (transições
 * EXECUTING → DONE). É a fonte de `cycleTime`/`leadTime`. **NÃO** representa
 * tempo manual de humano — para isso existe {@link ManualTimerSession}
 * (`telemetry.manualTimers[]`), array totalmente separado.
 *
 * @see ManualTimerSession — sessão manual por humano (timer play/pause/stop)
 */
export interface WorkSession {
  startedAt: string;
  endedAt?: string;
  agentId?: string;
}

/**
 * Sessão de timer **manual** de uma task — **fluxo humano** (ADR-V2-057).
 *
 * Representa um intervalo cronometrado por um humano via botões
 * play/pause/resume/stop no drawer da task. Diferente de {@link WorkSession}
 * (IA), uma `ManualTimerSession`:
 * - Vive em `telemetry.manualTimers[]` (array dedicado, separado de
 *   `workSessions[]`) — JAMAIS contamina `cycleTime`/`leadTime`.
 * - É manipulada APENAS pelos endpoints `/tasks/:id/timer/*`
 *   (`TaskTimerService`), nunca pelo fluxo de status V3.
 * - Carrega `userId` (DEntidade.chave do humano), capturado SEMPRE do JWT
 *   (`req.user.entidadeId`), nunca do body — anti-fraude.
 *
 * **Anti-fraude (aritmética server-side):** `endedAt` e `durationMs` são
 * gravados pelo servidor no momento do pause/stop (`Date` do servidor). O
 * cliente nunca envia duração; o cronômetro do front é puramente visual e usa
 * `startedAt` como offset.
 *
 * Uma sessão "aberta" tem `endedAt`/`durationMs` ausentes. A regra atual é
 * de **1 timer aberto por task** (qualquer usuário) — segunda abertura → 409.
 *
 * @see WorkSession — sessão automática de IA (NÃO usar para tempo humano)
 * @see ADR-V2-057 — timer manual via dados.telemetry.manualTimers
 */
export interface ManualTimerSession {
  /** DEntidade.chave (string) do humano dono da sessão — vem do JWT. */
  userId: string;
  /** ISO 8601 — início, gravado server-side no start/resume. */
  startedAt: string;
  /** ISO 8601 — fim, gravado server-side no pause/stop. Ausente = sessão aberta. */
  endedAt?: string;
  /** Duração em ms = endedAt − startedAt, calculada server-side (anti-fraude). */
  durationMs?: number;
}

/**
 * Dados de captura da task (origem).
 */
export interface CaptureData {
  telegramMessageId?: string;
  source?: 'telegram' | 'web' | 'api' | 'mcp';
  rawText?: string;
}

/**
 * Dados de automação Claude Code (resumo agregado por task).
 *
 * **Nota canônica (ADR-V2-033 — Sub-tarefa 2.5):**
 * `claudeSessionId` foi removido daqui. A fonte canônica é
 * `DPedido.dados.claude.sessionId` (gravado pelo Engine
 * `OperacaoExecucaoClaude.registrarOutcome()`). DTask é estrutural
 * para cards Scrumban; rastreamento de sessão Claude Code é
 * responsabilidade do DPedido de execução (idClasse -300/-301/-302/-303).
 */
export interface AutomationData {
  executions?: number;
  lastExecutedAt?: string;
  riskScore?: number;
  approved?: boolean;
}

/**
 * Telemetria de ciclo de vida da task.
 *
 * **Dois arrays de sessão coexistem com semânticas DISTINTAS (ADR-V2-057):**
 * - `workSessions[]` — sessões automáticas de **IA** (EXECUTING/DONE). Fonte de
 *   `cycleTime`/`leadTime`. Manipulado só por `updateStatus`.
 * - `manualTimers[]` — sessões manuais por **humano** (timer play/pause/stop).
 *   Nunca alimenta `cycleTime`/`leadTime`. Manipulado só por `TaskTimerService`.
 */
export interface TelemetryData {
  readyAt?: string;
  executingAt?: string;
  doneAt?: string;
  cycleTime?: number;
  leadTime?: number;
  /** Sessões automáticas de IA — base de cycleTime/leadTime. NÃO é tempo humano. */
  workSessions?: WorkSession[];
  /** Sessões manuais por humano (timer). Separado de workSessions — ADR-V2-057. */
  manualTimers?: ManualTimerSession[];
}

/**
 * Estado V3 Intention atual.
 */
export interface V3IntentionData {
  state: TaskStatus;
  movedAt?: string;
  movedBy?: string;
}

/**
 * Schema para o campo `dados` (Json) de DTask.
 *
 * Armazena todos os metadados polimórficos da task:
 * - identifier: "DEV-7" (DTask não tem campo `codigo` no schema Prisma)
 * - v3: estado V3 Intention corrente
 * - telemetry: timestamps de transições + workSessions
 * - automation: dados de execução Claude Code
 * - capture: origem da captura (Telegram, web, etc.)
 *
 * @example
 * ```typescript
 * const dados: TaskDados = {
 *   identifier: 'DEV-7',
 *   v3: { state: 'INBOX', movedAt: new Date().toISOString() },
 * };
 * ```
 */
export interface TaskDados {
  identifier?: string;
  v3?: V3IntentionData;
  telemetry?: TelemetryData;
  automation?: AutomationData;
  capture?: CaptureData;
  /**
   * Tipo da task: FEATURE | BUG | IMPROVEMENT | REVIEW | EXPLAIN.
   * Persistido em `dados.taskType` (sem coluna nova — ADR-V2-001).
   * Setado no create após `buildInitialTaskDados()` e mesclado no update.
   */
  taskType?: string;
}

/**
 * Constrói o payload inicial de dados para uma nova task.
 *
 * @param identifier - Identifier no formato "DEV-N"
 * @param creatorId - ID do criador
 * @param capture - Dados de captura (opcional)
 * @returns TaskDados inicial com estado INBOX
 */
export function buildInitialTaskDados(
  identifier: string,
  creatorId: string,
  capture?: Partial<CaptureData>,
): TaskDados {
  const dados: TaskDados = {
    identifier,
    v3: {
      state: 'INBOX',
      movedAt: new Date().toISOString(),
      movedBy: creatorId,
    },
  };
  if (capture && (capture.rawText || capture.source)) {
    dados.capture = {
      rawText: capture.rawText,
      source: capture.source ?? 'web',
    };
  }
  return dados;
}

/**
 * Parse seguro de dados de task a partir de um valor Json bruto.
 *
 * @param raw - Valor bruto do campo Json do Prisma
 * @returns TaskDados com valores padrão
 */
export function parseTaskDados(raw: unknown): TaskDados {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return {};
  }
  return raw as TaskDados;
}

/**
 * Estados V3 Intention — 9 estados canônicos do Scrumban.
 */
export type TaskStatus =
  | 'INBOX'
  | 'READY'
  | 'EXECUTING'
  | 'DONE'
  | 'FAILED'
  | 'CANCELLED'
  | 'DISCARDED'
  | 'VALIDATING'
  | 'VALIDATED';

/**
 * Sessão de trabalho (workSession) de uma task.
 */
export interface WorkSession {
  startedAt: string;
  endedAt?: string;
  agentId?: string;
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
 */
export interface TelemetryData {
  readyAt?: string;
  executingAt?: string;
  doneAt?: string;
  cycleTime?: number;
  leadTime?: number;
  workSessions?: WorkSession[];
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

import { TelemetryData } from '../../tasks/schemas/task-dados.schema';
import { resolveActiveWorkSession } from '../../tasks/work-session.util';
import { MCP_ERROR_CODES } from '../constants';
import { McpToolError } from './tool.interface';

/**
 * Forma mínima de task que o guard de concorrência precisa — subconjunto do
 * `TaskResponseDto` já carregado pelos tools de escrita (`findOne`). Evita
 * acoplar o guard ao DTO completo.
 */
export interface LockableTask {
  /** Estado V3 corrente (derivado de `dados.v3.state`). */
  status: string;
  /** Payload polimórfico `dados` (contém `telemetry.workSessions`). */
  dados: Record<string, unknown> | null;
  /**
   * Sessão ativa já hidratada por `buildResponse` (com `agentName`), quando o
   * caller usou uma leitura que hidrata nomes (`findOne`). Usada APENAS para o
   * nome no erro de bloqueio — a DECISÃO de travar deriva de
   * `resolveActiveWorkSession` (independente da hidratação → robusto).
   */
  activeWorkSession?: {
    agentId: string | null;
    agentName: string | null;
    startedAt: string;
  } | null;
}

/**
 * Trava de concorrência MCP (task #794 / DEV-123).
 *
 * Recusa uma operação de ESCRITA via MCP quando a task está `EXECUTING` com uma
 * workSession aberta e fresca de OUTRO ator. É o mecanismo que impede dois
 * agentes/pessoas de trabalharem a mesma task simultaneamente pela camada MCP
 * (incidente real 2026-07-07).
 *
 * **MCP-only por design (Strategist §2):** vive na camada MCP, NÃO no
 * `TasksService`. Colocá-la no service bloquearia também o HTTP/UI humano — um
 * humano retomando a própria task, ou um MANAGER intervindo pela UI, jamais
 * deve tomar erro. Blast radius mínimo, política isolada.
 *
 * **Regras (decisões do Roberio 2026-07-10):**
 * - Task fora de EXECUTING, sem sessão aberta, ou sessão ÓRFÃ (> TTL 2h) →
 *   LIBERA (a fonte {@link resolveActiveWorkSession} já aplica o TTL de 2h, #1).
 * - Mesmo dono (`agentId === callerId`) → LIBERA (retomada legítima).
 * - `agentId` nulo (sessão sem dono identificável) → BLOQUEIA conservador (#2).
 * - Outro dono → BLOQUEIA com `INVALID_PARAMS reason='task_locked'` carregando
 *   QUEM (`lockedBy.agentId` + `agentName`) e DESDE QUANDO (`since`) (#4).
 *
 * **ISENTA `update_timer`** (#3): o guard cobre `update_task`, `update_status`,
 * `execute_task` e `delete_task`. O timer manual (fluxo humano, ADR-V2-057)
 * permanece livre.
 *
 * **Zero query extra no caminho feliz:** a decisão lê `dados.telemetry` já em
 * memória. O nome do dono no erro reusa `activeWorkSession.agentName` (hidratado
 * pelo `findOne` que o tool já executou) — sem query adicional nem no bloqueio.
 *
 * **TOCTOU aceito:** dois callers quase simultâneos antes de qualquer sessão
 * aberta passam ambos (risco residual de ms; o incidente real foi humano, em
 * escala de minutos). Documentado no ADR.
 *
 * @param task - task já carregada (status + dados + activeWorkSession opcional)
 * @param callerId - DEntidade.chave do caller MCP (`ctx.dEntidadeId`)
 * @throws {McpToolError} INVALID_PARAMS (-32602) com `reason='task_locked'`
 *   quando travada por outro ator (ou dono não identificável)
 */
export function assertTaskNotLockedByOther(task: LockableTask, callerId: bigint): void {
  const telemetry = (task.dados?.telemetry as TelemetryData | null | undefined) ?? null;
  const active = resolveActiveWorkSession(telemetry, task.status);

  // Sem sessão ativa (não-EXECUTING, nenhuma aberta, ou órfã > TTL 2h) → livre.
  if (!active) {
    return;
  }

  // Mesmo dono → retomada legítima, libera. (agentId nulo NÃO casa com caller.)
  if (active.agentId !== null && active.agentId === callerId.toString()) {
    return;
  }

  // Travada por outro ator (ou dono não identificável → bloqueia conservador).
  // Reusa o nome já hidratado pelo findOne (zero query extra), fallback null.
  const agentName = task.activeWorkSession?.agentName ?? null;

  throw new McpToolError(MCP_ERROR_CODES.INVALID_PARAMS, 'Task locked by another worker', {
    reason: 'task_locked',
    lockedBy: {
      agentId: active.agentId,
      agentName,
    },
    since: active.startedAt,
  });
}

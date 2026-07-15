import { BadRequestException } from '@nestjs/common';
import { V3_STATUS_CODES, type TaskStatus } from './constants/task-status.const';

const ALL_STATUSES: TaskStatus[] = [...V3_STATUS_CODES];

/**
 * Mapa de transições válidas do state machine V3 Intentions.
 *
 * Política: movimento livre entre quaisquer dos 5 estados — a única transição
 * recusada é a de um estado para ele mesmo (no-op). O sistema (agent, backend,
 * MCP) move tasks sem restrições artificiais.
 *
 * **Nota (poda 9 → 5):** antes existia um estado terminal sem saída
 * (`VALIDATED`). Ele foi removido junto com VALIDATING/CANCELLED/DISCARDED —
 * hoje NENHUM estado é via de mão única. Uma task `DONE` pode voltar a
 * `EXECUTING` (reabertura), que já era o comportamento esperado do board.
 *
 * @see V3_STATUS_CODES — catálogo canônico (fonte única)
 */
export const validTransitions: Record<TaskStatus, TaskStatus[]> = Object.fromEntries(
  ALL_STATUSES.map((from) => [from, ALL_STATUSES.filter((to) => to !== from)]),
) as Record<TaskStatus, TaskStatus[]>;

/**
 * Valida se a transição de estado é permitida pelo state machine V3.
 *
 * @param from - Estado atual da task
 * @param to - Estado de destino desejado
 *
 * @throws {BadRequestException} Se a transição não é válida
 *
 * @example
 * ```typescript
 * validateTransition('INBOX', 'READY');      // OK
 * validateTransition('DONE', 'EXECUTING');   // OK (reabertura)
 * validateTransition('INBOX', 'INBOX');      // Lança BadRequestException (no-op)
 * ```
 */
export function validateTransition(from: TaskStatus, to: TaskStatus): void {
  const allowed = validTransitions[from];
  if (!allowed) {
    throw new BadRequestException(`Estado inválido: ${from}`);
  }
  if (!allowed.includes(to)) {
    throw new BadRequestException(
      `Transição inválida: ${from} → ${to}. ` +
        `Transições permitidas de ${from}: [${allowed.join(', ') || 'nenhuma — estado terminal'}]`,
    );
  }
}

/**
 * Verifica se um estado é válido no state machine V3.
 *
 * @param state - Estado a verificar
 * @returns true se o estado é válido
 *
 * @example
 * ```typescript
 * isValidState('INBOX');       // true
 * isValidState('VALIDATING');  // false — removido na poda 9 → 5
 * ```
 */
export function isValidState(state: string): state is TaskStatus {
  return state in validTransitions;
}

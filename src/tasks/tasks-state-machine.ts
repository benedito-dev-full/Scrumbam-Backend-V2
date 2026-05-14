import { BadRequestException } from '@nestjs/common';
import { TaskStatus } from './schemas/task-dados.schema';

const ALL_STATUSES: TaskStatus[] = [
  'INBOX', 'READY', 'EXECUTING', 'DONE', 'FAILED',
  'CANCELLED', 'DISCARDED', 'VALIDATING', 'VALIDATED',
];

/**
 * Mapa de transições válidas do state machine V3 Intentions.
 *
 * Política: movimento livre entre qualquer estado, exceto sair de VALIDATED
 * (estado terminal). Isso permite que o sistema (agent, backend) mova tasks
 * livremente sem restrições artificiais.
 */
export const validTransitions: Record<TaskStatus, TaskStatus[]> = {
  INBOX:      ALL_STATUSES.filter((s) => s !== 'INBOX'),
  READY:      ALL_STATUSES.filter((s) => s !== 'READY'),
  EXECUTING:  ALL_STATUSES.filter((s) => s !== 'EXECUTING'),
  DONE:       ALL_STATUSES.filter((s) => s !== 'DONE'),
  FAILED:     ALL_STATUSES.filter((s) => s !== 'FAILED'),
  CANCELLED:  ALL_STATUSES.filter((s) => s !== 'CANCELLED'),
  DISCARDED:  ALL_STATUSES.filter((s) => s !== 'DISCARDED'),
  VALIDATING: ALL_STATUSES.filter((s) => s !== 'VALIDATING'),
  VALIDATED:  [], // terminal — sem saída
};

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
 * validateTransition('INBOX', 'READY');        // OK
 * validateTransition('INBOX', 'DONE');         // Lança BadRequestException
 * validateTransition('VALIDATED', 'INBOX');    // Lança BadRequestException (terminal)
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
 * isValidState('INBOX');    // true
 * isValidState('INVALID');  // false
 * ```
 */
export function isValidState(state: string): state is TaskStatus {
  return state in validTransitions;
}

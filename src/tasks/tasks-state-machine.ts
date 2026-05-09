import { BadRequestException } from '@nestjs/common';
import { TaskStatus } from './schemas/task-dados.schema';

/**
 * Mapa de transições válidas do state machine V3 Intentions.
 *
 * 9 estados canônicos (seed F1):
 * INBOX → READY → EXECUTING → DONE → VALIDATED (fluxo nominal)
 * INBOX → DISCARDED (descarte imediato)
 * Qualquer → FAILED (falha pode acontecer em qualquer estado produtivo)
 * FAILED → READY (retry)
 * EXECUTING → VALIDATING → VALIDATED (fluxo com validação manual)
 *
 * Estado terminal: VALIDATED (sem saída).
 */
export const validTransitions: Record<TaskStatus, TaskStatus[]> = {
  INBOX: ['READY', 'DISCARDED'],
  READY: ['EXECUTING', 'INBOX', 'DISCARDED'],
  EXECUTING: ['DONE', 'FAILED', 'READY', 'VALIDATING'],
  DONE: ['VALIDATED', 'VALIDATING'],
  FAILED: ['READY', 'DISCARDED'],
  CANCELLED: ['INBOX'],
  DISCARDED: ['INBOX'],
  VALIDATING: ['VALIDATED', 'FAILED'],
  VALIDATED: [],
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

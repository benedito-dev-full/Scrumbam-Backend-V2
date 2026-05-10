/**
 * Contrato canônico de Evento V2.
 *
 * Todo evento que trafega pelo `EventProducerService` segue este formato.
 * Reviewer rejeita qualquer estrutura paralela. ADR-V2-008 (DEvento substitui
 * DNotification/DWebhook).
 */
export interface IEventMetadata {
  /**
   * Identificador do componente emissor (ex: 'tasks.service',
   * 'OperacaoExecucaoClaude'). Útil para tracing e debugging.
   */
  source: string;

  /**
   * Timestamp ISO 8601 do momento da emissão (TimezoneService.now ou
   * `new Date().toISOString()`).
   */
  timestamp: string;

  /**
   * Correlation ID herdado do contexto do request (X-Correlation-Id).
   * Usado para rastrear o evento ponta-a-ponta em logs e DEvento.
   */
  correlationId: string;
}

/**
 * Evento canônico V2.
 *
 * @typeParam TPayload - Shape do payload específico do evento (ex: dados de
 *   criação de task, dados de execução).
 *
 * @example
 * ```typescript
 * const event: IEvent<{ taskId: string; projectId: string }> = {
 *   type: 'task.created',
 *   payload: { taskId: '123', projectId: '7' },
 *   correlationId: '550e8400-e29b-41d4-a716-446655440000',
 *   metadata: {
 *     source: 'tasks.service',
 *     timestamp: '2026-05-09T12:34:56.789Z',
 *     correlationId: '550e8400-e29b-41d4-a716-446655440000',
 *   },
 * };
 * ```
 */
export interface IEvent<TPayload extends Record<string, unknown> = Record<string, unknown>> {
  /** Tipo canônico (`{dominio}.{entidade}.{acao}` ou `{dominio}.{acao}`). */
  type: string;

  /** Dados específicos do evento. */
  payload: TPayload;

  /** Correlation ID (idêntico a metadata.correlationId, mantido como atalho). */
  correlationId: string;

  /** Metadados de tracing/contexto. */
  metadata: IEventMetadata;
}

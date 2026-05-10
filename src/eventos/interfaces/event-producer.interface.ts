/**
 * Contrato consumido por chamadores que NÃO podem (ou não devem) importar
 * a implementação concreta de `EventProducerService`.
 *
 * Caso de uso primário: `OperacaoExecucaoClaude` (em `src/engine/`) precisa
 * emitir eventos sem que `src/engine/` dependa de `src/eventos/` —
 * mantém autonomia do diretório `src/engine/` e evita acoplamento circular.
 *
 * Implementado por: `EventProducerService` (em `src/eventos/core/`).
 *
 * Decisão arquitetural: ADR-V2-005 (Engine isolado) + decisão CEO 2026-05-09 #5.
 */
export interface IEventProducer {
  /**
   * Emite evento canônico no sistema.
   *
   * Regras (devari-backend-patterns §7 e §14):
   * - É o ÚNICO ponto de emissão. Adapters NUNCA emitem direto.
   * - DEVE ser chamado APÓS persistência bem-sucedida (nunca antes).
   * - NÃO derruba o fluxo principal: erros são logados e contados pelo
   *   CircuitBreaker, mas não relançados ao caller.
   *
   * @param type             Tipo canônico (`{dominio}.{entidade}.{acao}`).
   *                         Deve estar em `ALL_EVENT_TYPES`, senão throw.
   * @param payload          Dados específicos do evento.
   * @param correlationId    UUID v4 que liga eventos relacionados.
   * @param options.source   Identificador opcional do emissor.
   *
   * @returns Promise que resolve após enriquecimento + roteamento.
   *          Resolve mesmo se consumers falharem (fire-and-forget interno).
   */
  addInternalEvent<TPayload extends Record<string, unknown>>(
    type: string,
    payload: TPayload,
    correlationId: string,
    options?: { source?: string },
  ): Promise<void>;
}

import { ServiceUnavailableException } from '@nestjs/common';

/**
 * Erro HTTP não-200 devolvido pelo agente VPS em `POST /v1/execute` (ADR-V2-082).
 *
 * Preserva o status HTTP (`httpStatus` — `status` é privado em HttpException) e o `errorCode` do body JSON do agente (ex.:
 * `{ accepted:false, errorCode:'PROJECT_BUSY' }` no 409 do mutex por slug),
 * que antes se perdiam numa `ServiceUnavailableException` genérica.
 *
 * É SUBCLASSE de `ServiceUnavailableException`: callers que fazem
 * `instanceof ServiceUnavailableException` (SET_ENV, GENERATE_DEPLOY_KEY,
 * PROVISION_PROJECT…) continuam funcionando sem mudança. Sem mudança de
 * protocolo (ADR-V2-033) — o 409 já existia; só passamos a lê-lo.
 *
 * @example
 * ```typescript
 * try { await client.execute(req); }
 * catch (e) {
 *   if (e instanceof RemoteAgentHttpError && e.isProjectBusy()) { ... requeue ... }
 * }
 * ```
 */
export class RemoteAgentHttpError extends ServiceUnavailableException {
  /**
   * @param httpStatus - Status HTTP devolvido pelo agente (ex.: 409)
   * @param errorCode - `errorCode` do body JSON do agente, quando presente
   * @param message - Mensagem legível (sem segredos)
   */
  constructor(
    public readonly httpStatus: number,
    public readonly errorCode: string | undefined,
    message: string,
  ) {
    super(message);
    this.name = 'RemoteAgentHttpError';
    Object.setPrototypeOf(this, RemoteAgentHttpError.prototype);
  }

  /** true quando é o 409 do mutex por projeto do agente (`PROJECT_BUSY`). */
  isProjectBusy(): boolean {
    return this.httpStatus === 409 && this.errorCode === 'PROJECT_BUSY';
  }
}

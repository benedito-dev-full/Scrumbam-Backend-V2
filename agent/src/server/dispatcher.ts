/**
 * Dispatcher de comandos inbound em `POST /v1/execute`.
 *
 * Lê `type` do body parseado e direciona para o handler interno
 * apropriado. Tipos suportados no MVP (Sub-tarefa 2):
 *
 *  - `PING`: handler interno simples — devolve `{accepted:true,
 *    executionId:null, message:'pong'}`. Sanity check end-to-end de
 *    HMAC + dispatcher.
 *  - `RUN_CLAUDE_CODE`: **stub 501 nesta Sub-tarefa.** O handler real
 *    é implementado na Sub-tarefa 4 (claude-runner + identity-resolver
 *    + allowlist + session-parser). Aqui retornamos 501 NotImplemented
 *    com errorCode `NOT_IMPLEMENTED` — explícito por semântica HTTP.
 *
 * Tipos desconhecidos → 400 `UNKNOWN_COMMAND_TYPE` com lista dos
 * tipos suportados. Body sem `type` → 400 `MISSING_TYPE`.
 *
 * **Por que `/v1/execute` com discriminator:** o plan-task1 §4 e
 * §5 Sub-tarefa 2 deixa "porta aberta" para `LIST_CLAUDE_SESSIONS`,
 * `READ_CLAUDE_SESSION`, `STREAM_CLAUDE_SESSION` no futuro. Esses
 * comandos plugam aqui adicionando handlers — zero refactor de
 * contrato HTTP, zero novo middleware HMAC.
 *
 * @see ADR-V2-032 (porta aberta para chat-with-VPS)
 * @see ADR-V2-033 (contrato HTTP+HMAC)
 */
import type { Request, Response } from 'express';
import type { Logger } from 'pino';

const SUPPORTED_TYPES = ['PING', 'RUN_CLAUDE_CODE'] as const;
type SupportedType = (typeof SUPPORTED_TYPES)[number];

/**
 * Constrói o handler de `POST /v1/execute`. Recebe o logger para
 * estruturar logs com `executionId` quando disponível.
 *
 * @example
 *   app.post('/v1/execute', hmacMw, limiter, createDispatcher(logger));
 */
export function createDispatcher(logger: Logger) {
  return (req: Request, res: Response): void => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const type = body.type;

    if (typeof type !== 'string' || type.length === 0) {
      logger.warn({ stage: 'dispatch' }, 'request sem campo "type"');
      res.status(400).json({
        accepted: false,
        errorCode: 'MISSING_TYPE',
        message: 'Campo "type" obrigatorio no body',
        supportedTypes: SUPPORTED_TYPES,
      });
      return;
    }

    if (!SUPPORTED_TYPES.includes(type as SupportedType)) {
      logger.warn({ stage: 'dispatch', type }, 'type desconhecido');
      res.status(400).json({
        accepted: false,
        errorCode: 'UNKNOWN_COMMAND_TYPE',
        message: `Tipo "${type}" nao suportado`,
        supportedTypes: SUPPORTED_TYPES,
      });
      return;
    }

    if (type === 'PING') {
      const executionId =
        typeof body.executionId === 'string' && body.executionId.length > 0
          ? body.executionId
          : null;
      logger.info({ stage: 'dispatch', type, executionId }, 'PING aceito');
      res.status(200).json({
        accepted: true,
        executionId,
        message: 'pong',
      });
      return;
    }

    // type === 'RUN_CLAUDE_CODE' — stub temporário (Sub-tarefa 4 implementa).
    const executionId =
      typeof body.executionId === 'string' && body.executionId.length > 0 ? body.executionId : null;
    logger.warn(
      { stage: 'dispatch', type, executionId },
      'RUN_CLAUDE_CODE recebido — stub 501 (handler real vem na Sub-tarefa 4)',
    );
    res.status(501).json({
      accepted: false,
      errorCode: 'NOT_IMPLEMENTED',
      message: 'RUN_CLAUDE_CODE handler vai ser implementado na Sub-tarefa 4',
      executionId,
    });
  };
}

export const SUPPORTED_TYPES_LIST: readonly string[] = SUPPORTED_TYPES;

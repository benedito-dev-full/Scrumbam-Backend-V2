/**
 * Dispatcher de comandos inbound em `POST /v1/execute`.
 *
 * Lê `type` do body parseado e direciona para o handler interno
 * apropriado:
 *
 *  - `PING`: handler interno simples — devolve `{accepted:true,
 *    executionId:null, message:'pong'}`. Sanity check end-to-end de
 *    HMAC + dispatcher.
 *  - `RUN_CLAUDE_CODE` (Sub-tarefa 4): delega para
 *    `createRunClaudeCodeHandler` que orquestra identity-resolver +
 *    allowlist + runner + session-parser e responde com ACK 200 ou
 *    erro mapeado (403/409/422/500). Resultado completo chega via
 *    outbound `POST /agents/:id/execution-result`.
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
import type { AgentConfig } from '../config/schema';
import { createRunClaudeCodeHandler, type ProjectMutex } from '../handlers/run-claude-code.handler';
import type { BackendClient } from '../outbound/backend-client';

const SUPPORTED_TYPES = ['PING', 'RUN_CLAUDE_CODE'] as const;
type SupportedType = (typeof SUPPORTED_TYPES)[number];

/** Dependências do dispatcher injetadas pelo `createServer`. */
export interface DispatcherDeps {
  config: AgentConfig;
  logger: Logger;
  backendClient: BackendClient;
  mutex: ProjectMutex;
  /**
   * Override do handler de RUN_CLAUDE_CODE (testes). Default cria via
   * `createRunClaudeCodeHandler`.
   */
  runClaudeCodeHandler?: (req: Request, res: Response) => void;
}

/**
 * Constrói o handler de `POST /v1/execute`.
 *
 * @example
 *   app.post('/v1/execute', hmacMw, limiter, createDispatcher({config, logger, backendClient, mutex}));
 */
export function createDispatcher(deps: DispatcherDeps) {
  const { logger } = deps;
  const runClaudeCodeHandler =
    deps.runClaudeCodeHandler ??
    createRunClaudeCodeHandler({
      config: deps.config,
      logger,
      backendClient: deps.backendClient,
      mutex: deps.mutex,
    });

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

    // type === 'RUN_CLAUDE_CODE' — delega para o handler especializado.
    runClaudeCodeHandler(req, res);
  };
}

export const SUPPORTED_TYPES_LIST: readonly string[] = SUPPORTED_TYPES;

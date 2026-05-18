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
import { createGenerateDeployKeyHandler } from '../handlers/generate-deploy-key.handler';
import { createProvisionProjectHandler } from '../handlers/provision-project.handler';
import { createRunClaudeCodeHandler, type ProjectMutex } from '../handlers/run-claude-code.handler';
import { createSetEnvHandler } from '../handlers/set-env.handler';
import { createUnprovisionProjectHandler } from '../handlers/unprovision-project.handler';
import type { BackendClient } from '../outbound/backend-client';

const SUPPORTED_TYPES = [
  'PING',
  'RUN_CLAUDE_CODE',
  'SET_ENV',
  'GENERATE_DEPLOY_KEY',
  'PROVISION_PROJECT',
  'UNPROVISION_PROJECT',
] as const;
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
  /**
   * Override do handler de SET_ENV (testes). Default cria via
   * `createSetEnvHandler`. Plan-2026-05-13 §4.
   */
  setEnvHandler?: (req: Request, res: Response) => void;
  /**
   * Override do handler de GENERATE_DEPLOY_KEY (testes). Default cria
   * via `createGenerateDeployKeyHandler`. Plan-2026-05-13 §4.
   */
  generateDeployKeyHandler?: (req: Request, res: Response) => void;
  /**
   * Override do handler de PROVISION_PROJECT (testes). Default cria via
   * `createProvisionProjectHandler`.
   */
  provisionProjectHandler?: (req: Request, res: Response) => void;
  /**
   * Override do handler de UNPROVISION_PROJECT (testes). Default cria via
   * `createUnprovisionProjectHandler`.
   */
  unprovisionProjectHandler?: (req: Request, res: Response) => void;
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
  const setEnvHandler = deps.setEnvHandler ?? createSetEnvHandler({ logger });
  const generateDeployKeyHandler =
    deps.generateDeployKeyHandler ?? createGenerateDeployKeyHandler({ logger });
  const provisionProjectHandler =
    deps.provisionProjectHandler ??
    createProvisionProjectHandler({
      logger,
      allowedBaseDirs: deps.config.allowedProjectRoots,
      claudeMdPath: deps.config.claudeMdPath,
    });
  const unprovisionProjectHandler =
    deps.unprovisionProjectHandler ??
    createUnprovisionProjectHandler({
      logger,
      claudeMdPath: deps.config.claudeMdPath,
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

    if (type === 'SET_ENV') {
      setEnvHandler(req, res);
      return;
    }

    if (type === 'GENERATE_DEPLOY_KEY') {
      generateDeployKeyHandler(req, res);
      return;
    }

    if (type === 'PROVISION_PROJECT') {
      provisionProjectHandler(req, res);
      return;
    }

    if (type === 'UNPROVISION_PROJECT') {
      unprovisionProjectHandler(req, res);
      return;
    }

    // type === 'RUN_CLAUDE_CODE' — delega para o handler especializado.
    runClaudeCodeHandler(req, res);
  };
}

export const SUPPORTED_TYPES_LIST: readonly string[] = SUPPORTED_TYPES;

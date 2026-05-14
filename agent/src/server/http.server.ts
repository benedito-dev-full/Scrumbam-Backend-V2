/**
 * Servidor HTTP local (Sub-tarefa 2 do Task #1 — F13 cliente).
 *
 * **Bind 127.0.0.1 — NUNCA 0.0.0.0.** O agente recebe requests via reverse
 * tunnel SSH (autossh inicializado na Sub-tarefa 5). Se bindarmos em
 * `0.0.0.0`, qualquer host na rede da VPS poderia tentar bater no agente
 * direto (HMAC ainda barraria, mas amplia a superfície). Bind explícito
 * ao loopback é a defesa de primeira linha.
 *
 * Pipeline de cada request inbound:
 *   1. `express.json({ limit:'1mb', verify })` — preserva `rawBody` para HMAC.
 *   2. `hmac.middleware` — valida agentId, timestamp skew, nonce, signature.
 *   3. `rate-limit.middleware` — 60 req/min por agentId (defensivo).
 *   4. handler da rota:
 *       - `GET /ping`     → sanity (com HMAC, retorna metadata)
 *       - `POST /v1/execute` → dispatcher (PING ack / RUN_CLAUDE_CODE stub 501)
 *
 * Graceful shutdown:
 *   - `stop()` fecha o socket TCP (não aceita novas conexões) e aguarda
 *     conexões in-flight terminarem por até 30s. Após o timeout força
 *     `server.closeAllConnections()` para evitar processo zumbi.
 *
 * @see ADR-V2-033
 */
import express, { Express, NextFunction, Request, Response } from 'express';
import type { Server as HttpServer } from 'http';
import type { Logger } from 'pino';
import { createProjectMutex, type ProjectMutex } from '../handlers/run-claude-code.handler';
import type { BackendClient } from '../outbound/backend-client';
import type { AgentConfig } from '../config/schema';
import { createDispatcher, SUPPORTED_TYPES_LIST } from './dispatcher';
import { createHmacMiddleware, type RawBodyRequest } from './hmac.middleware';
import { createNonceStore, type NonceStore } from './nonce.store';
import { createRateLimitMiddleware } from './rate-limit.middleware';

const BODY_LIMIT = '1mb';
const SHUTDOWN_TIMEOUT_MS = 30_000;
const AGENT_VERSION = '0.1.0';

/**
 * Handle retornado por `createServer`. Permite ao bootstrap iniciar e
 * encerrar o servidor de forma controlada.
 */
export interface AgentHttpServer {
  /** Sobe o socket em `127.0.0.1:<config.tunnelPort>`. */
  start(): Promise<void>;
  /**
   * Encerra graciosamente. Não aceita novas conexões e drena in-flight
   * por até 30s. Idempotente — chamadas adicionais resolvem imediatamente.
   */
  stop(): Promise<void>;
  /** Útil para testes integration (supertest) e introspecção. */
  getApp(): Express;
  /** Útil para limpar nonces entre testes. */
  getNonceStore(): NonceStore;
}

/**
 * Constrói e retorna o handle do servidor. Não inicia o socket — chame
 * `start()` quando estiver pronto. Útil em testes para montar o `app`
 * e atacar com supertest sem abrir porta real.
 *
 * @param config Config carregada (vide `loadConfig`).
 * @param logger Pino logger (já com redaction).
 * @param options Override de dependências para testes (nonce store, rate limit).
 *
 * @example
 *   const server = createServer(config, logger);
 *   await server.start();
 *   process.on('SIGTERM', () => server.stop());
 */
export function createServer(
  config: AgentConfig,
  logger: Logger,
  options?: {
    nonceStore?: NonceStore;
    rateLimitOverrides?: { windowMs?: number; max?: number };
    /** Tempo de boot — usado em /ping para calcular uptime (default Date.now). */
    bootedAtMs?: number;
    /**
     * BackendClient injetado pelo bootstrap. Necessário para o handler
     * `RUN_CLAUDE_CODE` reportar `execution-result` outbound. Em testes
     * que só exercitam `PING` ou stubs HMAC, pode ser omitido — usamos
     * um noop client que loga warn.
     */
    backendClient?: BackendClient;
    /**
     * Mutex local por `projectSlug` (Sub-tarefa 4). Default: novo Set.
     * Injetável para testes que querem inspecionar/popular o estado.
     */
    mutex?: ProjectMutex;
  },
): AgentHttpServer {
  const nonceStore = options?.nonceStore ?? createNonceStore();
  const bootedAtMs = options?.bootedAtMs ?? Date.now();
  const mutex = options?.mutex ?? createProjectMutex();
  const backendClient: BackendClient = options?.backendClient ?? noopBackendClient(logger);
  const app = express();

  // 1. Body parser com preservação de rawBody para HMAC.
  app.use(
    express.json({
      limit: BODY_LIMIT,
      verify: (req: RawBodyRequest, _res, buf) => {
        req.rawBody = buf;
      },
    }),
  );

  // Express 4 não captura erro de payload muito grande sem um handler
  // dedicado — emitimos resposta padronizada.
  app.use(
    (
      err: Error & { type?: string; status?: number },
      _req: Request,
      res: Response,
      next: NextFunction,
    ): void => {
      if (err && (err.type === 'entity.too.large' || err.status === 413)) {
        res.status(413).json({
          accepted: false,
          errorCode: 'PAYLOAD_TOO_LARGE',
          message: `Body excede limite ${BODY_LIMIT}`,
        });
        return;
      }
      if (err && err.type === 'entity.parse.failed') {
        res.status(400).json({
          accepted: false,
          errorCode: 'INVALID_JSON',
          message: 'Body nao e JSON valido',
        });
        return;
      }
      next(err);
    },
  );

  const hmacMiddleware = createHmacMiddleware(config, nonceStore, logger);
  const rateLimitMiddleware = createRateLimitMiddleware(options?.rateLimitOverrides);

  // GET /ping — sanity check autenticado.
  app.get('/ping', hmacMiddleware, rateLimitMiddleware, (_req: Request, res: Response): void => {
    res.status(200).json({
      ok: true,
      agentId: config.agentId,
      version: AGENT_VERSION,
      uptimeSec: Math.max(0, Math.floor((Date.now() - bootedAtMs) / 1000)),
    });
  });

  // POST /v1/execute — dispatcher autenticado.
  app.post(
    '/v1/execute',
    hmacMiddleware,
    rateLimitMiddleware,
    createDispatcher({ config, logger, backendClient, mutex }),
  );

  // 404 padronizado para qualquer outro path.
  app.use((req: Request, res: Response): void => {
    res.status(404).json({
      accepted: false,
      errorCode: 'NOT_FOUND',
      message: `Rota ${req.method} ${req.path} nao existe`,
      supportedTypes: SUPPORTED_TYPES_LIST,
    });
  });

  let httpServer: HttpServer | null = null;
  let stopped = false;

  return {
    async start(): Promise<void> {
      if (httpServer) {
        throw new Error('http server ja foi iniciado');
      }
      await new Promise<void>((resolve, reject) => {
        const srv = app.listen(config.tunnelPort, config.bindHost, () => {
          logger.info(
            {
              stage: 'http.server',
              host: config.bindHost,
              port: config.tunnelPort,
              version: AGENT_VERSION,
            },
            `scrumban-agent http server escutando em ${config.bindHost}`,
          );
          resolve();
        });
        srv.once('error', (err) => reject(err));
        httpServer = srv;
      });
    },

    async stop(): Promise<void> {
      if (stopped || !httpServer) {
        return;
      }
      stopped = true;
      const srv = httpServer;
      httpServer = null;

      logger.info({ stage: 'http.server' }, 'iniciando graceful shutdown');

      await new Promise<void>((resolve) => {
        const timeout = setTimeout(() => {
          logger.warn(
            { stage: 'http.server', timeoutMs: SHUTDOWN_TIMEOUT_MS },
            'timeout no graceful shutdown — forcando close de conexoes',
          );
          // Node 18+ expõe closeAllConnections; chamada protegida para
          // versões antigas (defensivo).
          const force = (srv as HttpServer & { closeAllConnections?: () => void })
            .closeAllConnections;
          if (typeof force === 'function') force.call(srv);
          resolve();
        }, SHUTDOWN_TIMEOUT_MS);

        srv.close((err) => {
          clearTimeout(timeout);
          if (err) {
            logger.warn({ stage: 'http.server', err: err.message }, 'erro ao fechar server');
          } else {
            logger.info({ stage: 'http.server' }, 'http server encerrado');
          }
          resolve();
        });
      });
    },

    getApp(): Express {
      return app;
    },

    getNonceStore(): NonceStore {
      return nonceStore;
    },
  };
}

/**
 * BackendClient no-op para testes/setup mínimo. Loga warn quando alguém
 * tentar reportar `execution-result` sem ter passado um client real. Em
 * produção o bootstrap SEMPRE injeta o client real.
 */
function noopBackendClient(logger: Logger): BackendClient {
  return {
    async sendHeartbeat(): Promise<void> {
      logger.warn({ stage: 'http.server.noop' }, 'sendHeartbeat chamado em noop backend client');
    },
    async sendExecutionResult(): Promise<void> {
      logger.warn(
        { stage: 'http.server.noop' },
        'sendExecutionResult chamado em noop backend client',
      );
    },
  };
}

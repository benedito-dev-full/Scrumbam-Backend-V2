/**
 * Entry point do scrumban-agent.
 *
 * Sub-tarefas concluídas:
 *  - Sub-tarefa 1: config loader + logger pino com redaction.
 *  - Sub-tarefa 2: HTTP server (127.0.0.1) + HMAC middleware + nonce store
 *    LRU + rate limit (60 req/min) + dispatcher `/v1/execute` com `PING`
 *    e stub 501 para `RUN_CLAUDE_CODE`.
 *
 * Sub-tarefas pendentes:
 *  - Sub-tarefa 3: outbound client + heartbeat loop (setInterval 30s).
 *  - Sub-tarefa 4: handler real de RUN_CLAUDE_CODE (runner + allowlist +
 *    identity-resolver + session-parser).
 *  - Sub-tarefa 5: autossh wrapper + lifecycle completo.
 *
 * Uso (produção):
 *   /opt/scrumban-agent/bin/scrumban-agent
 *
 * Uso (dev/teste):
 *   SCRUMBAN_AGENT_CONFIG_PATH=/tmp/cfg.json node dist/index.js
 */
import { loadConfig } from './config/loader';
import { createLogger } from './logger';
import { createServer } from './server/http.server';

const AGENT_VERSION = '0.1.0';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const server = createServer(config, logger);

  await server.start();

  logger.info(
    {
      agentId: config.agentId,
      version: AGENT_VERSION,
      backendBaseUrl: config.backendBaseUrl,
      tunnelPort: config.tunnelPort,
      allowedProjectRoots: config.allowedProjectRoots,
      stage: 'sub-tarefa-2-http-server',
    },
    'scrumban-agent pronto (Sub-tarefa 2: HTTP server + HMAC ativo — outbound/heartbeat virao na Sub-tarefa 3)',
  );

  // Graceful shutdown — drena conexões in-flight por até 30s.
  const shutdown = (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'sinal recebido — iniciando shutdown');
    server
      .stop()
      .then(() => process.exit(0))
      .catch((err: Error) => {
        logger.error({ err: err.message }, 'falha no shutdown');
        process.exit(1);
      });
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

bootstrap().catch((err: Error) => {
  // Logger pode ainda não ter sido inicializado se loadConfig falhou.
  // Fallback para console.error (permitido pelo eslint).
  console.error('scrumban-agent: falha no bootstrap:', err.message);
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});

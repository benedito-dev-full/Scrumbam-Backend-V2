/**
 * Entry point do scrumban-agent.
 *
 * Sub-tarefas concluídas:
 *  - Sub-tarefa 1: config loader + logger pino com redaction.
 *  - Sub-tarefa 2: HTTP server (127.0.0.1) + HMAC middleware + nonce store
 *    LRU + rate limit (60 req/min) + dispatcher `/v1/execute` com `PING`
 *    e stub 501 para `RUN_CLAUDE_CODE`.
 *  - Sub-tarefa 3: outbound HMAC signer + BackendClient (backoff exponencial
 *    + retry só em 5xx/rede) + heartbeat loop (setInterval 30s, circuit
 *    metric após 5 falhas, cache 5min na detecção do Claude Code).
 *
 * Sub-tarefas pendentes:
 *  - Sub-tarefa 4: handler real de RUN_CLAUDE_CODE (runner + allowlist +
 *    identity-resolver + session-parser).
 *  - Sub-tarefa 5: autossh wrapper + lifecycle completo (vai preencher
 *    `tunnelHealthy` real no heartbeat).
 *  - Sub-tarefa 6: install.sh + systemd unit.
 *
 * Uso (produção):
 *   /opt/scrumban-agent/bin/scrumban-agent
 *
 * Uso (dev/teste):
 *   SCRUMBAN_AGENT_CONFIG_PATH=/tmp/cfg.json node dist/index.js
 */
import { loadConfig } from './config/loader';
import { startHeartbeatLoop, type HeartbeatHandle } from './lifecycle/heartbeat-loop';
import { createLogger } from './logger';
import { createBackendClient } from './outbound/backend-client';
import { createServer } from './server/http.server';

const AGENT_VERSION = '0.1.0';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);
  const server = createServer(config, logger);

  await server.start();

  const backendClient = createBackendClient(config, logger);
  const heartbeat: HeartbeatHandle = startHeartbeatLoop(backendClient, logger, {
    agentVersion: AGENT_VERSION,
  });

  logger.info(
    {
      agentId: config.agentId,
      version: AGENT_VERSION,
      backendBaseUrl: config.backendBaseUrl,
      tunnelPort: config.tunnelPort,
      allowedProjectRoots: config.allowedProjectRoots,
      stage: 'sub-tarefa-3-outbound-heartbeat',
    },
    'scrumban-agent pronto (Sub-tarefa 3: heartbeat 30s + HTTP server + HMAC ativo)',
  );

  // Graceful shutdown — para heartbeat ANTES do server (heartbeat usa fetch
  // que não depende do server, mas paramos pra evitar log "circuit_open"
  // enganoso enquanto o backend já está fechando a conexão).
  const shutdown = (signal: NodeJS.Signals) => {
    logger.info({ signal }, 'sinal recebido — iniciando shutdown');
    try {
      heartbeat.stop();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.warn({ err: message }, 'falha ao parar heartbeat (continuando shutdown)');
    }
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

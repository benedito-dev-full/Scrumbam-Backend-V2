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
 *  - Sub-tarefa 4: handler RUN_CLAUDE_CODE (identity-resolver via CLAUDE.md,
 *    allowlist com realpath, runner `claude -p --output-format json`,
 *    session-parser com fallback FS, mutex local por projectSlug, ACK 200
 *    síncrono + execution-result outbound async).
 *  - Sub-tarefa 5: autossh wrapper (backoff exponencial + circuit breaker
 *    5 crashes/60s → 5min) + lifecycle/shutdown coordenado (heartbeat →
 *    server → autossh → exit). `tunnelHealthy` no heartbeat agora reflete
 *    estado real via `autossh.isHealthy()`.
 *
 * Sub-tarefas pendentes:
 *  - Sub-tarefa 6: install.sh + systemd unit.
 *
 * Ordem de boot:
 *   1. loadConfig + createLogger
 *   2. createAutosshWrapper().start()   — estabelece tunnel ANTES do server
 *   3. createBackendClient + createServer().start() — abre HTTP local
 *   4. startHeartbeatLoop(tunnelHealthCheck=autossh.isHealthy)
 *   5. installSignalHandlers(SIGTERM/SIGINT) — graceful shutdown
 *
 * Uso (produção):
 *   /opt/scrumban-agent/bin/scrumban-agent
 *
 * Uso (dev/teste):
 *   SCRUMBAN_AGENT_CONFIG_PATH=/tmp/cfg.json node dist/index.js
 */
import { loadConfig } from './config/loader';
import { createProjectMutex } from './handlers/run-claude-code.handler';
import { startHeartbeatLoop, type HeartbeatHandle } from './lifecycle/heartbeat-loop';
import { installSignalHandlers } from './lifecycle/shutdown';
import { createLogger } from './logger';
import { createBackendClient } from './outbound/backend-client';
import { createServer } from './server/http.server';
import { createAutosshWrapper } from './tunnel/autossh.wrapper';

const AGENT_VERSION = '0.1.0';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  // 1. Autossh wrapper — estabelece reverse tunnel ANTES do server abrir.
  // `start()` resolve assim que o spawn é chamado (não espera a conexão SSH
  // efetivamente subir — autossh gerencia reconexão internamente, e o
  // wrapper externamente lida com crashes do próprio autossh).
  const autossh = createAutosshWrapper(config, logger);
  await autossh.start();

  // 2. BackendClient e mutex são criados ANTES do server porque o dispatcher
  // (criado dentro de `createServer`) precisa deles para registrar o
  // handler RUN_CLAUDE_CODE (Sub-tarefa 4).
  const backendClient = createBackendClient(config, logger);
  const mutex = createProjectMutex();
  const server = createServer(config, logger, { backendClient, mutex });

  await server.start();

  // 3. Heartbeat lê estado real do tunnel via `autossh.isHealthy()`.
  const heartbeat: HeartbeatHandle = startHeartbeatLoop(backendClient, logger, {
    agentVersion: AGENT_VERSION,
    tunnelHealthCheck: () => autossh.isHealthy(),
  });

  logger.info(
    {
      agentId: config.agentId,
      version: AGENT_VERSION,
      backendBaseUrl: config.backendBaseUrl,
      backendTunnelHost: config.backendTunnelHost,
      tunnelPort: config.tunnelPort,
      allowedProjectRoots: config.allowedProjectRoots,
      stage: 'sub-tarefa-5-autossh',
    },
    'scrumban-agent pronto (Sub-tarefa 5: tunnel + lifecycle ativos)',
  );

  // 4. Graceful shutdown — ordem: heartbeat → server → autossh → exit.
  // Ver `src/lifecycle/shutdown.ts` para o flow completo e o porquê da ordem.
  installSignalHandlers({
    heartbeat,
    server,
    tunnel: autossh,
    logger,
  });
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

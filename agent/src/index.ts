/**
 * Entry point do scrumban-agent (Sub-tarefa 1 do Task #1 — F13 cliente).
 *
 * Por enquanto: carrega config, inicializa logger, loga banner de boot e fica
 * idle. Servidor HTTP, autossh, handlers de comando, heartbeat loop e
 * lifecycle são adicionados nas sub-tarefas seguintes (2 a 5).
 *
 * Uso (produção):
 *   /opt/scrumban-agent/bin/scrumban-agent
 *
 * Uso (dev/teste):
 *   SCRUMBAN_AGENT_CONFIG_PATH=/tmp/cfg.json node dist/index.js
 */
import { loadConfig } from './config/loader';
import { createLogger } from './logger';

const AGENT_VERSION = '0.1.0';

async function bootstrap(): Promise<void> {
  const config = loadConfig();
  const logger = createLogger(config.logLevel);

  logger.info(
    {
      agentId: config.agentId,
      version: AGENT_VERSION,
      backendBaseUrl: config.backendBaseUrl,
      tunnelPort: config.tunnelPort,
      allowedProjectRoots: config.allowedProjectRoots,
      stage: 'sub-tarefa-1-scaffolding',
    },
    'scrumban-agent iniciado (Sub-tarefa 1: config loader pronto — servidor HTTP, heartbeat, handlers virao nas Sub-tarefas 2-5)',
  );

  // Sub-tarefas pendentes (placeholder):
  // - Sub-tarefa 2: subir HTTP server (express) em 127.0.0.1:tunnelPort + middleware HMAC + /v1/execute dispatcher.
  // - Sub-tarefa 3: backend-client + heartbeat loop (setInterval 30s).
  // - Sub-tarefa 4: handler RUN_CLAUDE_CODE + identity-resolver + allowlist + session-parser.
  // - Sub-tarefa 5: autossh wrapper + lifecycle (SIGTERM gracioso).
  //
  // Nesta sub-tarefa o processo sai limpo apos logar o boot — nao mantem
  // event loop ativo. As sub-tarefas seguintes farao o processo persistir.
}

bootstrap().catch((err: Error) => {
  // Logger pode ainda nao ter sido inicializado se loadConfig falhou.
  // Fallback para console.error (permitido pelo eslint).
  console.error('scrumban-agent: falha no bootstrap:', err.message);
  if (err.stack) {
    console.error(err.stack);
  }
  process.exit(1);
});

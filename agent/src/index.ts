/**
 * Entry point do scrumban-agent.
 *
 * Cliente V2 da F13 (Automation Claude Code) que roda na VPS. Recebe comandos
 * do backend Scrumban-Backend-V2 via HTTP+HMAC sobre reverse tunnel SSH e
 * invoca `claude -p` localmente. Executor passivo — zero persistência local
 * de domínio (toda gravação atravessa endpoints do backend; Pilar 1 ATIVADO
 * via OperacaoExecucaoClaude em DPedido idClasse=-300..-303).
 *
 * Componentes (todos cobertos por specs em `__tests__/`):
 *
 *  - config/loader        — `/etc/scrumban-agent/config.json` 0600 (zod schema)
 *  - logger               — pino JSON com redaction de segredos
 *  - server/http.server   — express 127.0.0.1 + graceful shutdown 30s
 *  - server/hmac.middleware  — HMAC-SHA256 timingSafeEqual + timestamp ±5min
 *  - server/nonce.store   — LRU 10min/10k entries (anti-replay)
 *  - server/rate-limit    — 60 req/min por agentId
 *  - server/dispatcher    — POST /v1/execute com `type` discriminator
 *                           (PING + RUN_CLAUDE_CODE no MVP; porta aberta para
 *                           LIST/READ/STREAM_CLAUDE_SESSIONS — ADR-V2-037)
 *  - handlers/run-claude-code  — identity-resolver via CLAUDE.md global,
 *                                allowlist com realpath, runner, session-parser,
 *                                mutex por projectSlug, ACK síncrono +
 *                                execution-result async
 *  - claude-code/runner   — execFile (sem shell) `claude -p --output-format json
 *                           [--resume <id>]`
 *  - claude-code/session-parser  — extrai `session_id` do output JSON
 *                                  (primary) ou via filesystem (fallback FS)
 *  - claude-code/identity-resolver — parser de `~/.claude/CLAUDE.md`
 *                                    (ADR-V2-035, sem `cwd` no payload)
 *  - claude-code/allowlist  — realpath anti-symlink + match contra
 *                             `config.allowedProjectRoots`
 *  - tunnel/autossh.wrapper  — reverse tunnel `-R` + reconnect backoff +
 *                              circuit breaker 5 crashes/60s → pausa 5min
 *  - outbound/backend-client + hmac-sign  — POST heartbeat / execution-result
 *  - lifecycle/heartbeat-loop  — setInterval 30s; `tunnelHealthy` reflete
 *                                `autossh.isHealthy()`
 *  - lifecycle/shutdown   — SIGTERM/SIGINT graceful (heartbeat → server →
 *                           autossh → exit)
 *
 * Ordem de boot:
 *   1. loadConfig + createLogger
 *   2. createAutosshWrapper().start()   — estabelece tunnel ANTES do server
 *   3. createBackendClient + createServer().start() — abre HTTP local
 *   4. startHeartbeatLoop(tunnelHealthCheck=autossh.isHealthy)
 *   5. installSignalHandlers(SIGTERM/SIGINT) — graceful shutdown
 *
 * Uso (produção):
 *   /opt/scrumban-agent/bin/scrumban-agent     (via systemd, ver
 *                                                `systemd/scrumban-agent.service`)
 *
 * Uso (dev/teste):
 *   SCRUMBAN_AGENT_CONFIG_PATH=/tmp/cfg.json node dist/index.js
 *
 * Documentação operacional:
 *   - agent/README.md
 *   - docs/automation-agent-install-runbook.md
 *
 * ADRs vinculados:
 *   - ADR-V2-001 (zero tabela nova)
 *   - ADR-V2-005 (Engine OperacaoExecucaoClaude no backend)
 *   - ADR-V2-006 (risk via idClasse)
 *   - ADR-V2-033 (contrato /v1/execute + execution-result)
 *   - ADR-V2-035 (identidade via projectSlug + CLAUDE.md global)
 *   - ADR-V2-036 (monorepo `agent/`)
 *   - ADR-V2-037 (ponteiro de sessão Claude Code — chat-with-VPS futuro)
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
      stage: 'task1-complete',
    },
    'scrumban-agent pronto (Task #1 completo: tunnel + lifecycle + RUN_CLAUDE_CODE + heartbeat)',
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

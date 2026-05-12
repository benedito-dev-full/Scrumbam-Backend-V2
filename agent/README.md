# scrumban-agent

Binário cliente Node.js+TypeScript que roda na VPS do CEO. **Executor passivo** do lado cliente da F13 (Automation Claude Code): recebe comandos do backend Scrumban-Backend-V2 via HTTP+HMAC sobre reverse tunnel SSH (autossh) e invoca `claude -p` no host.

**Princípio:** zero persistência local de domínio. Toda gravação acontece no backend via Engine `OperacaoExecucaoClaude` (DPedido idClasse=-300..-303). O agente só guarda config em `/etc/scrumban-agent/config.json` (modo 0600).

---

## Estado atual

| Sub-tarefa | Status | Conteúdo |
|---|---|---|
| **1. Scaffolding + config loader** | completa | `package.json`, `tsconfig.json`, `eslint.config.js`, jest, logger (pino com redaction), config schema (zod), config loader (modo 0600), `index.ts` bootstrap mínimo, 11 specs |
| **2. HTTP server + HMAC + `/v1/execute`** | em review | express bind 127.0.0.1, middleware HMAC (algoritmo idêntico ao backend, `timingSafeEqual`), nonce LRU 10min/10k entries, rate limit 60/min por agentId, dispatcher PING + RUN_CLAUDE_CODE stub 501, GET /ping autenticado, graceful shutdown 30s, 15 specs |
| 3. Outbound + heartbeat | pendente | `backend-client`, `heartbeat-loop` (30s) |
| 4. RUN_CLAUDE_CODE + session-parser | pendente | runner, allowlist, identity-resolver, fallback `~/.claude/projects/` |
| 5. autossh + lifecycle | pendente | wrapper, SIGTERM gracioso |
| 6. install.sh + systemd | pendente | handshake, systemd unit |
| 7. Docs + ADRs | pendente | ADR-V2-030/031/032 |

ADR-V2-031 (em redação): este código mora em monorepo dentro de `Scrumban-Backend-V2/agent/` para versionamento atômico com o backend.

---

## Build & dev

```bash
cd agent
npm install
npm run build       # tsc -> dist/
npm test            # jest
npm run lint        # eslint
npm run typecheck   # tsc --noEmit
```

Requisitos: Node ≥20.

---

## Config

Lida em runtime de `/etc/scrumban-agent/config.json` (override via env `SCRUMBAN_AGENT_CONFIG_PATH` para testes).

Schema validado por `zod` (ver `src/config/schema.ts`). Campos chave:

- `agentId` (string): chave de DEntidade idClasse=-156 emitida no handshake.
- `agentApiKey` (string): credencial outbound.
- `agentCommandSecret` (string): HMAC-SHA256 shared secret. Já decifrado pelo `install.sh` antes de gravar — o agente NÃO decifra envelopes em runtime.
- `backendBaseUrl` (URL): ex. `https://api.scrumban.com.br`.
- `backendTunnelHost` / `backendTunnelPort`: alvo SSH do autossh.
- `tunnelPort`: porta local (127.0.0.1) onde o HTTP server escuta.
- `allowedProjectRoots` (string[]): raízes válidas para `claude -p` (anti path-injection).
- `claudeMdPath`: default `/root/.claude/CLAUDE.md` (`install.sh` resolve `~/.claude/CLAUDE.md` do CEO).
- `logLevel`: `error|warn|info|debug` (default `info`).

**Segurança:** o loader rejeita config com modo ≠ `0600`. Permissão errada = crash de boot.

---

## Logger

`pino` JSON line-delimited, compatível com `journalctl`/Loki. Redaction obrigatória para `agentCommandSecret`, `agentApiKey`, `installToken`, `signature`, `password` e variações nested.

---

## Layout

```
agent/
├── src/
│   ├── index.ts                   # bootstrap (atualmente: carrega config + loga banner)
│   ├── logger.ts                  # pino com redaction
│   ├── config/
│   │   ├── schema.ts              # AgentConfigSchema (zod)
│   │   └── loader.ts              # loadConfig() — valida modo 0600 + zod
│   ├── server/
│   │   ├── http.server.ts         # express bind 127.0.0.1 + graceful shutdown
│   │   ├── hmac.middleware.ts     # HMAC-SHA256 (idêntico ao backend) + timingSafeEqual
│   │   ├── nonce.store.ts         # LRU 10min/10k anti-replay
│   │   ├── rate-limit.middleware.ts  # 60 req/min por agentId
│   │   └── dispatcher.ts          # POST /v1/execute (PING + RUN_CLAUDE_CODE stub 501)
│   ├── handlers/                  # vazio — Sub-tarefa 4 (handler real de RUN_CLAUDE_CODE)
│   ├── claude-code/               # vazio — Sub-tarefa 4
│   ├── tunnel/                    # vazio — Sub-tarefa 5
│   ├── outbound/                  # vazio — Sub-tarefa 3
│   └── lifecycle/                 # vazio — Sub-tarefas 3 e 5
├── __tests__/
│   ├── config.loader.spec.ts      # 11 specs
│   └── http.server.spec.ts        # 15 specs (HMAC, dispatcher, rate limit, lifecycle)
├── package.json
├── tsconfig.json
├── eslint.config.js               # flat config (ESLint 9)
├── .gitignore
└── README.md
```

`install.sh`, `systemd/scrumban-agent.service` e o template `CLAUDE-md-template.md` virão na Sub-tarefa 6.

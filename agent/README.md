# scrumban-agent

Binário cliente Node.js+TypeScript que roda na **VPS do CEO**. **Executor passivo** do lado cliente da F13 (Automation Claude Code): recebe comandos do backend Scrumban-Backend-V2 via HTTP+HMAC sobre reverse tunnel SSH (autossh) e invoca `claude -p` no host.

**Princípio:** zero persistência local de domínio. Toda gravação acontece no backend via Engine `OperacaoExecucaoClaude` (DPedido idClasse=-300..-303). O agente só guarda config em `/etc/scrumban-agent/config.json` (modo 0600).

---

## Arquitetura (1 parágrafo)

Backend V2 envia `POST /v1/execute` (HMAC-SHA256, ±5min timestamp, nonce LRU 10min) ao agente, que escuta em `127.0.0.1:<tunnelPort>` (exposto ao backend via reverse tunnel SSH `-R` mantido por `autossh`). O dispatcher discrimina por `type` (`PING`, `RUN_CLAUDE_CODE` no MVP — ADR-V2-037 reserva espaço para `LIST/READ/STREAM_CLAUDE_SESSIONS`). Para `RUN_CLAUDE_CODE` o agente resolve o `cwd` lendo o `projectSlug` em `~/.claude/CLAUDE.md` global (ADR-V2-035 — sem path absoluto no payload), valida o path contra `allowedProjectRoots` (realpath anti-symlink), invoca `claude -p "<prompt>" --output-format json [--resume <id>]` via `execFile` (sem shell), extrai o `session_id` do output JSON (primary) ou do filesystem (fallback FS), e responde de volta ao backend via `POST /agents/:id/execution-result` com `claudeSessionId` para que o Engine `OperacaoExecucaoClaude` grave em `DPedido.dados.claude.sessionId`. Em paralelo, um heartbeat loop envia status a cada 30s incluindo saúde real do tunnel (`autossh.isHealthy()`).

Diagrama ASCII completo: ver `workspace/plans/plan-automation-agent-v2-client-task1.md` §4.

---

## Status — Task #1 (Sub-tarefas 1–7)

| Sub-tarefa | Status | Conteúdo |
|---|---|---|
| **1. Scaffolding + config loader** | ✅ completa | `package.json`, `tsconfig.json`, `eslint.config.js`, jest, logger (pino com redaction), config schema (zod), config loader (modo 0600), `index.ts` bootstrap mínimo |
| **2. HTTP server + HMAC + `/v1/execute`** | ✅ completa | express bind 127.0.0.1, middleware HMAC (algoritmo idêntico ao backend, `timingSafeEqual`), nonce LRU 10min/10k entries, rate limit 60/min por agentId, dispatcher PING + RUN_CLAUDE_CODE (stub), GET /ping autenticado, graceful shutdown 30s |
| **3. Outbound + heartbeat** | ✅ completa | `backend-client`, `heartbeat-loop` (30s), backoff exponencial, retry em 5xx/rede, circuit metric após 5 falhas |
| **4. RUN_CLAUDE_CODE + session-parser** | ✅ completa | runner (execFile, sem shell), allowlist (realpath anti-symlink), identity-resolver, session parser snake_case + fallback FS, mutex por slug, ACK 200 síncrono + execution-result async |
| **5. autossh + lifecycle** | ✅ completa | wrapper modular, reconnect com backoff exponencial, circuit breaker 5/60s → pausa 5min, SIGTERM gracioso ordenado (heartbeat → server → autossh → exit) |
| **6. install.sh + systemd + CLAUDE.md** | ✅ completa | `install.sh` bash (14 fases, idempotente, dry-run, shellcheck-clean), systemd unit (User=scrumban-agent, hardening completo, EnvironmentFile p/ ANTHROPIC_API_KEY), `CLAUDE-md-template.md`, `uninstall.sh` |
| **7. Docs + ADRs** | ✅ completa | ADR-V2-035/036/037 redigidos, runbook atualizado, README final |

**Testes:** 84/84 PASS. Build: PASS. Lint: PASS (zero warnings).

**ADRs vinculados:** ADR-V2-001, ADR-V2-005, ADR-V2-006, ADR-V2-008, ADR-V2-013, ADR-V2-033, ADR-V2-035 (identidade slug), ADR-V2-036 (monorepo), ADR-V2-037 (ponteiro de sessão).

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
│   ├── index.ts                       # bootstrap: config, logger, autossh, server, heartbeat, signal handlers
│   ├── logger.ts                      # pino com redaction
│   ├── config/
│   │   ├── schema.ts                  # AgentConfigSchema (zod)
│   │   └── loader.ts                  # loadConfig() — valida modo 0600 + zod
│   ├── server/
│   │   ├── http.server.ts             # express bind 127.0.0.1 + graceful shutdown 30s
│   │   ├── hmac.middleware.ts         # HMAC-SHA256 (idêntico ao backend) + timingSafeEqual
│   │   ├── nonce.store.ts             # LRU 10min/10k anti-replay
│   │   ├── rate-limit.middleware.ts   # 60 req/min por agentId
│   │   └── dispatcher.ts              # POST /v1/execute (PING + RUN_CLAUDE_CODE)
│   ├── handlers/
│   │   └── run-claude-code.handler.ts # ACK 200 síncrono + execution-result async + mutex por slug
│   ├── claude-code/
│   │   ├── runner.ts                  # execFile claude -p --output-format json [--resume]
│   │   ├── session-parser.ts          # session_id snake_case (primary) + fallback FS (mtime)
│   │   ├── allowlist.ts               # realpath anti-symlink + match em allowedProjectRoots
│   │   └── identity-resolver.ts       # parser de ~/.claude/CLAUDE.md (slug → cwd)
│   ├── tunnel/
│   │   └── autossh.wrapper.ts         # reverse tunnel `-R` + backoff + circuit breaker
│   ├── outbound/
│   │   ├── backend-client.ts          # POST /agents/:id/heartbeat + /execution-result
│   │   └── hmac-sign.ts               # assina requests outbound (mesma chave)
│   └── lifecycle/
│       ├── heartbeat-loop.ts          # setInterval 30s; tunnelHealthy via autossh.isHealthy()
│       └── shutdown.ts                # SIGTERM/SIGINT graceful: heartbeat → server → tunnel → exit
├── __tests__/
│   ├── config.loader.spec.ts          # config 0600 + zod (11 specs)
│   ├── http.server.spec.ts            # HMAC, dispatcher, rate limit, lifecycle (15 specs)
│   ├── outbound.spec.ts               # backend-client, heartbeat-loop, backoff (12 specs)
│   ├── run-claude-code.spec.ts        # handler + runner + session-parser (29 specs)
│   ├── identity-resolver.spec.ts      # parser CLAUDE.md (12 specs)
│   ├── autossh.spec.ts                # wrapper, backoff, circuit breaker (11 specs)
│   └── shutdown.spec.ts               # ordem de shutdown, dedup signals (6 specs)
├── systemd/
│   └── scrumban-agent.service         # User=scrumban-agent + hardening completo
├── install.sh                          # 14 fases, idempotente, dry-run, shellcheck-clean
├── uninstall.sh                        # interativo (--yes para CI), verifica resíduos
├── CLAUDE-md-template.md               # template `## <slug>` + `Caminho:`
├── package.json
├── tsconfig.json
├── eslint.config.js                    # flat config (ESLint 9)
├── jest.config.js
├── .gitignore                          # node_modules/, dist/, coverage/, .claude/
└── README.md                           # este arquivo
```

Total: 84 specs PASS (~3.4s).

---

## Instalação na VPS (produção)

### Pré-requisitos
- Ubuntu 22.04+ / Debian 12+
- Acesso root via sudo
- Conexão de saída HTTPS para o backend
- Conexão SSH para o `backendTunnelHost` (porta 22 ou alternativa)
- Install token one-shot emitido pelo backend V2 (endpoint `/agents/install-token`)

### Bundle

O `install.sh` segue a **OPÇÃO C** (bundle-relative): assume que foi extraído junto
com o `dist/` já buildado pelo dev. No dev:

```bash
cd agent
npm install
npm run build                       # gera dist/
tar czf scrumban-agent-bundle.tar.gz dist/ systemd/ install.sh uninstall.sh CLAUDE-md-template.md package.json
```

Copie o `.tar.gz` para a VPS:

```bash
scp scrumban-agent-bundle.tar.gz user@vps:/tmp/
ssh user@vps
sudo tar xzf /tmp/scrumban-agent-bundle.tar.gz -C /tmp/scrumban-agent-bundle
cd /tmp/scrumban-agent-bundle
sudo bash install.sh \
  --backend=https://api.scrumban.com.br \
  --token=<install-token-one-shot> \
  --backend-tunnel-host=104.238.205.111 \
  --backend-tunnel-port=2025 \
  --tunnel-port=20000 \
  --allowed-roots=/home/dev/projetos
```

No futuro a distribuição pode migrar para release GitHub via `--bundle-url` (não
implementado neste MVP).

### O que o install.sh faz (14 fases)

1. Parse args + validações (root, distro Ubuntu/Debian).
2. Pre-flight: `timedatectl set-ntp true` (clock skew quebra HMAC ±5min) + deps
   (Node 20+, autossh, jq, curl, Claude Code CLI ≥ 2.1.139).
3. Cria user `scrumban-agent` (system, sem shell, idempotente).
4. Cria `/opt/scrumban-agent`, `/etc/scrumban-agent` (0700), `/var/lib/scrumban-agent` (0700),
   `/var/log/scrumban-agent` (0750).
5. Copia `dist/` para `/opt/scrumban-agent/dist/`.
6. Gera par Ed25519 em `/etc/scrumban-agent/ssh_key` (0600) — só se ausente.
7. Faz handshake `POST /agents/install-token` com a pub key + hostname. Recebe
   `agentId`, `agentApiKey`, `agentCommandSecret`, `tunnelPort`.
8. `ssh-keyscan` do `backendTunnelHost` → `known_hosts` (evita TOFU prompt).
   O fingerprint impresso pelo `ssh-keyscan` é mostrado ao operador (stderr
   via `tee` + log em `/var/log/scrumban-agent/install.log`) para verificação
   manual de identidade.
9. Grava `/etc/scrumban-agent/config.json` (0600, owner do agente).
10. Cria `/etc/scrumban-agent/environment` (0600) — placeholder VAZIO para
    `ANTHROPIC_API_KEY` ou `ANTHROPIC_AUTH_TOKEN`. O systemd unit carrega esse
    arquivo via `EnvironmentFile=-...`. **Operador precisa preencher após o
    install** (ver §Troubleshooting → `RUN_CLAUDE_CODE` falha). Preservado se
    já existir (idempotente).
11. Instala systemd unit, `daemon-reload`, `enable`, `restart`.
12. Se `/root/.claude/CLAUDE.md` ausente, copia `CLAUDE-md-template.md`
    (preserva se já existe — não popula automaticamente, evita prompt injection).
13. Aguarda até 60s pelo heartbeat do agente nos logs (`journalctl`).
14. Imprime resumo final com avisos de pendências (env file, CLAUDE.md).

### Idempotência

- Se `config.json` já existe, o install **falha** com instrução para rodar
  `uninstall.sh` antes. Não há flag `--reinstall` (intencional — evitar
  sobrescrita acidental de credenciais).
- User, chaves SSH e diretórios são criados só se ausentes.
- Systemd unit é sempre re-copiado + daemon-reload.

### Dry-run

```bash
bash install.sh --dry-run \
  --backend=https://api.scrumban.com.br \
  --token=fake-token \
  --tunnel-port=20000
```

O modo `--dry-run` imprime cada comando sem executar — útil para revisar o flow
antes de aplicar numa VPS de verdade. Não precisa de root nem de Ubuntu (avisa
e segue).

### Desinstalação

```bash
sudo bash uninstall.sh         # com confirmação
sudo bash uninstall.sh --yes   # sem prompt
```

Remove service, binário, config, state, user. **Não remove `/root/.claude/CLAUDE.md`**
(preservado intencionalmente — reinstalações futuras reaproveitam o mapeamento de
projetos).

---

## systemd unit (hardening)

`systemd/scrumban-agent.service` aplica:

- `User=scrumban-agent` (não root)
- `NoNewPrivileges=true`
- `ProtectSystem=strict` + `ReadWritePaths=/etc/scrumban-agent /var/lib/scrumban-agent /var/log/scrumban-agent`
- `ProtectHome=read-only` (precisa ler `/root/.claude/CLAUDE.md` — ver nota abaixo)
- `ProtectKernelTunables`, `ProtectKernelModules`, `ProtectControlGroups`
- `RestrictSUIDSGID`, `LockPersonality`, `RestrictRealtime`, `RestrictNamespaces`
- `PrivateTmp=true`
- `MemoryMax=512M`, `TasksMax=100`
- `Restart=always`, `RestartSec=5`

---

## Onde mora o CLAUDE.md global

Default: `/root/.claude/CLAUDE.md` (owner = root, modo 0644 para o agente
poder ler como user `scrumban-agent`).

**Trade-off:**

- **`/root/.claude/CLAUDE.md` (default):** o CEO opera o backend via sudo,
  Claude Code manual usa `~/.claude/CLAUDE.md` de root, alinhamento natural.
  Risco: o agente roda como `scrumban-agent` e precisa de read access ao arquivo
  de root — resolvido com `chmod 0644` no arquivo (apenas leitura, sem escrita).
  `ProtectHome=read-only` no systemd permite leitura.
- **Alternativa: `/home/<user>/.claude/CLAUDE.md`:** se o CEO usa o backend como
  user não-root, ajustar `claudeMdPath` no config.json para o home do user. O
  systemd já permite read-only em `/home`. Não é o default porque introduz
  ambiguidade de "qual user" — adoptamos uma única convenção (root) e
  documentamos.
- **NÃO usar `/home/scrumban-agent/.claude/`:** o agente é um user de sistema
  sem identidade humana. O `CLAUDE.md` é do CEO, não do agente.

`install.sh` copia o template SOMENTE se o arquivo está ausente. **NUNCA popula
automaticamente** — risco de prompt injection (atacante manipula install.sh
para inserir entradas falsas apontando para repos maliciosos). Ver risco #1
do plano F13.

---

## Troubleshooting

### Heartbeat não chega no backend

Causas comuns:

1. **Clock skew na VPS** — HMAC rejeita timestamps fora de ±5min.
   ```bash
   timedatectl status
   timedatectl set-ntp true
   ```
2. **Túnel SSH down** — autossh em loop de crash.
   ```bash
   journalctl -u scrumban-agent.service -f
   # Procure por 'autossh' + 'circuit_open: true'
   ```
   Causa típica: chave SSH não autorizada no `backendTunnelHost`. Verifique
   que a pub key (`/etc/scrumban-agent/ssh_key.pub`) está autorizada no usuário
   SSH do backend.
3. **Backend rejeitando** — `agentApiKey` errada ou expirada.
   ```bash
   journalctl -u scrumban-agent.service | grep -E '4[0-9][0-9]|5[0-9][0-9]'
   ```

### `RUN_CLAUDE_CODE` falha

1. **`ANTHROPIC_API_KEY` ausente (causa mais comum na primeira instalação):**
   O `claude -p` retorna `authentication_error`. O `install.sh` cria
   `/etc/scrumban-agent/environment` VAZIO — o operador precisa preencher.
   ```bash
   sudo $EDITOR /etc/scrumban-agent/environment
   # Descomente e preencha uma das linhas:
   # ANTHROPIC_API_KEY=sk-ant-...
   # ANTHROPIC_AUTH_TOKEN=...
   sudo systemctl restart scrumban-agent
   ```
   Para verificar que a variável chegou no processo:
   ```bash
   sudo systemctl show scrumban-agent --property=Environment | grep -i anthropic
   # OU (depende da versão do systemd):
   sudo cat /proc/$(pgrep -u scrumban-agent -f 'node.*scrumban-agent')/environ \
     | tr '\0' '\n' | grep -i anthropic
   ```
2. **Claude Code CLI ausente ou versão antiga:**
   ```bash
   sudo -u scrumban-agent bash -c 'command -v claude && claude --version'
   ```
   Mínimo: `2.1.139`. Atualize:
   ```bash
   sudo /usr/bin/npm install -g @anthropic-ai/claude-code
   ```
3. **Slug desconhecido (`UNKNOWN_PROJECT_SLUG`):** o `CLAUDE.md` não tem
   uma seção `## <slug>` para o projeto. Edite `/root/.claude/CLAUDE.md`.
4. **Caminho fora da allowlist (`WORKSPACE_OUTSIDE_ALLOWED_ROOT`):** o path
   do `CLAUDE.md` não está sob `allowedProjectRoots`. Ou ajuste o `CLAUDE.md`
   ou edite `/etc/scrumban-agent/config.json` (`allowedProjectRoots`) +
   `systemctl restart scrumban-agent`.

### Service não inicia

```bash
systemctl status scrumban-agent.service
journalctl -u scrumban-agent.service --no-pager | tail -50
```

Erros comuns:

- `config.json modo inválido` — o loader rejeita modo ≠ 0600. Corrija:
  ```bash
  sudo chmod 0600 /etc/scrumban-agent/config.json
  ```
- `zod validation failed` — campo faltando/inválido. O log mostra qual campo.
  Em último caso, rode `uninstall.sh` + `install.sh` novamente.

### Logs verbosos

Aumente o `logLevel` no `config.json` para `debug`:

```bash
sudo jq '.logLevel = "debug"' /etc/scrumban-agent/config.json > /tmp/cfg.json && \
  sudo mv /tmp/cfg.json /etc/scrumban-agent/config.json && \
  sudo chown scrumban-agent:scrumban-agent /etc/scrumban-agent/config.json && \
  sudo chmod 0600 /etc/scrumban-agent/config.json && \
  sudo systemctl restart scrumban-agent.service
```

---

## Dev local (sem instalar)

Para rodar o agente localmente apontando para um backend de staging/dev:

```bash
# 1. Gerar config fake em /tmp/agent-cfg.json (modo 0600)
cat > /tmp/agent-cfg.json <<'EOF'
{
  "agentId": "dev-agent-1",
  "agentApiKey": "dev-api-key",
  "agentCommandSecret": "dev-hmac-secret-32-bytes-min!!",
  "backendBaseUrl": "http://localhost:3000",
  "backendTunnelHost": "localhost",
  "backendTunnelPort": 22,
  "tunnelPort": 20000,
  "allowedProjectRoots": ["/tmp/dev-projects"],
  "claudeMdPath": "/tmp/CLAUDE.md",
  "agentSshKeyPath": "/tmp/dev-ssh-key",
  "logLevel": "debug"
}
EOF
chmod 0600 /tmp/agent-cfg.json

# 2. Build + run
npm run build
SCRUMBAN_AGENT_CONFIG_PATH=/tmp/agent-cfg.json node dist/index.js
```

Atenção: rodar sem `autossh` + `claude` instalados localmente fará os componentes
correspondentes falharem (autossh wrapper entra em circuit breaker, RUN_CLAUDE_CODE
retorna 500). Para testes unitários, use `npm test` (mocks).

---

## Limitações conhecidas (will not have no MVP)

Débitos explícitos do Task #1 — documentados, intencionais:

- **Política de retenção de `~/.claude/projects/<encoded-cwd>/*.jsonl`.** O CLI grava sessões indefinidamente; o agente apenas as lê. Crescimento ilimitado de disk é débito reconhecido. ADR futuro quando dor surgir (ex: cron de archive para S3 frio).
- **Endpoints `LIST_CLAUDE_SESSIONS` / `READ_CLAUDE_SESSION` / `STREAM_CLAUDE_SESSION`.** Reservados em ADR-V2-037 (porta aberta para chat-with-VPS) mas NÃO implementados. Discriminator `type` no `/v1/execute` permite adicionar sem quebrar contrato.
- **Backend impondo `--session-id <uuid>` ao CLI.** Rejeitado no MVP (ver ADR-V2-037 §Alternativa A). Agente extrai o ID do CLI; não o impõe.
- **Rotação automática de chaves** (`agentApiKey`, `agentCommandSecret`, SSH key). Processo manual via `uninstall.sh` + `install.sh` documentado no runbook.
- **Distribuição via GitHub release** com checksum verificado (`--bundle-url`). MVP usa OPÇÃO C bundle-relative (`tar czf` no dev + `scp`).
- **Múltiplos agentes na mesma VPS.** Suportado teoricamente (cada um com `agentId` e `tunnelPort` próprios), não testado.
- **Frontend chat-with-VPS.** Depende dos 3 endpoints acima + UI; fora do MVP.

---

## Referências

### ADRs

- **ADR-V2-001** — zero tabela nova (agente não toca banco diretamente).
- **ADR-V2-005** — Engine `OperacaoExecucaoClaude` extends `OperacaoPedido` (gravação fica no backend).
- **ADR-V2-006** — Risk via idClasse (-301 LOW / -302 MED / -303 HIGH).
- **ADR-V2-008** — DEvento substitui DNotification (audit lifecycle).
- **ADR-V2-013** — Agent como `DEntidade idClasse=-156`.
- **ADR-V2-033** — Contrato `/v1/execute` outbound + `execution-result` inbound + DEvento sessão lifecycle.
- **ADR-V2-035** — Identidade via `projectSlug` + `CLAUDE.md` global (sem path no payload).
- **ADR-V2-036** — Monorepo `Scrumban-Backend-V2/agent/` (versionamento atômico).
- **ADR-V2-037** — Ponteiro de sessão Claude Code (`claudeSessionId`) — chat-with-VPS futuro.

### Planos e docs

- `workspace/plans/plan-automation-agent-v2-client-task1.md` — plano do agente cliente (este Task).
- `workspace/plans/plan-automation-backend-side-task2.md` — plano backend complementar (`/v1/execute` outbound + `execution-result` inbound + Engine).
- `docs/automation-agent-install-runbook.md` — runbook de instalação na VPS (fluxo completo).
- `docs/automation-security-runbook.md` — peppers/keys do backend.
- `docs/automation-guide.md` — guia funcional do operador.

### Memória dos agentes (private)

- `.claude/agent-memory/implementer/agent_install_gotchas.md` — gotchas do install.sh.
- `.claude/agent-memory/implementer/claude_session_extraction.md` — spike CLI session_id.

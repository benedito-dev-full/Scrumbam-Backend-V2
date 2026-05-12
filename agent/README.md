# scrumban-agent

Binário cliente Node.js+TypeScript que roda na VPS do CEO. **Executor passivo** do lado cliente da F13 (Automation Claude Code): recebe comandos do backend Scrumban-Backend-V2 via HTTP+HMAC sobre reverse tunnel SSH (autossh) e invoca `claude -p` no host.

**Princípio:** zero persistência local de domínio. Toda gravação acontece no backend via Engine `OperacaoExecucaoClaude` (DPedido idClasse=-300..-303). O agente só guarda config em `/etc/scrumban-agent/config.json` (modo 0600).

---

## Estado atual

| Sub-tarefa | Status | Conteúdo |
|---|---|---|
| **1. Scaffolding + config loader** | completa | `package.json`, `tsconfig.json`, `eslint.config.js`, jest, logger (pino com redaction), config schema (zod), config loader (modo 0600), `index.ts` bootstrap mínimo, 11 specs |
| **2. HTTP server + HMAC + `/v1/execute`** | completa | express bind 127.0.0.1, middleware HMAC (algoritmo idêntico ao backend, `timingSafeEqual`), nonce LRU 10min/10k entries, rate limit 60/min por agentId, dispatcher PING + RUN_CLAUDE_CODE, GET /ping autenticado, graceful shutdown 30s, 15 specs |
| **3. Outbound + heartbeat** | completa | `backend-client`, `heartbeat-loop` (30s), backoff exponencial, 12 specs |
| **4. RUN_CLAUDE_CODE + session-parser** | completa | runner (execFile, sem shell), allowlist (realpath anti-symlink), identity-resolver, session parser snake_case + fallback FS, mutex por slug, 29 specs |
| **5. autossh + lifecycle** | completa | wrapper modular, reconnect com backoff, circuit breaker 5/60s, SIGTERM gracioso ordenado, 17 specs |
| **6. install.sh + systemd + CLAUDE.md** | completa | install.sh bash (13 fases, idempotente, dry-run), systemd unit (User=scrumban-agent, hardening completo), CLAUDE-md-template.md, uninstall.sh |
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

# Automation Agent V2 — Install Runbook

**Última atualização:** 2026-05-12
**Aplicável a:** Scrumban-Backend-V2 F13 (Automation Claude Code) — lado cliente
**Código:** `Scrumban-Backend-V2/agent/` (monorepo — ADR-V2-036)

---

## Visão geral

O `scrumban-agent` é o binário cliente Node.js+TS que roda na **VPS do CEO**. Recebe comandos do backend Scrumban-Backend-V2 via HTTP+HMAC sobre reverse tunnel SSH (autossh) e invoca `claude -p` localmente.

**Princípios** (ADR-V2-001, ADR-V2-005, ADR-V2-006, ADR-V2-035, ADR-V2-037):

- Zero persistência local de domínio — só `/etc/scrumban-agent/config.json` (0600).
- Identidade de projeto via `projectSlug` + `~/.claude/CLAUDE.md` global (não recebe `cwd` absoluto).
- Executor passivo — não recalcula risco, não decide o que pode rodar.
- HMAC-SHA256 inbound (server) + outbound (backend client) com timestamp ±5min anti-replay.
- Reverse tunnel `-R` via autossh com backoff + circuit breaker.

---

## Pré-requisitos

### Backend V2

- Endpoint `POST /agents/install-token` ativo (F13).
- Variáveis no backend: `AGENT_KEY_PEPPER`, `AGENT_COMMAND_SECRET_ENCRYPTION_KEY` (ver `docs/automation-security-runbook.md`).
- Acesso SSH ao `backendTunnelHost` para a chave Ed25519 que o agente vai gerar (autorizar a pub key no `authorized_keys` do user SSH dedicado no backend).

### VPS

- **Ubuntu 22.04+ / Debian 12+** (`install.sh` valida).
- **Acesso root** via sudo.
- **Conectividade:**
  - HTTPS de saída para o backend V2 (`backendBaseUrl`).
  - SSH de saída para `backendTunnelHost` na porta `backendTunnelPort` (default 22 ou alternativa).
- **Clock sincronizado.** HMAC tolera apenas ±5 min. `install.sh` força `timedatectl set-ntp true` no preflight.
- **Anthropic API key:** o CEO precisa ter `ANTHROPIC_API_KEY` ou `ANTHROPIC_AUTH_TOKEN` válido. Pode ser preenchido **após** o install (passo 5 abaixo).

### Dependências instaladas pelo install.sh

O `install.sh` faz preflight e exige que estejam disponíveis (via `apt` ou já no PATH):

- `node` ≥ 20
- `autossh`
- `jq`
- `curl`
- `claude` (Claude Code CLI) ≥ **2.1.139** — versão mínima validada pelo spike CLI da Sub-tarefa 4. Para instalar/atualizar:
  ```bash
  sudo /usr/bin/npm install -g @anthropic-ai/claude-code
  claude --version   # deve retornar >= 2.1.139
  ```

---

## Distribuição do binário

O `install.sh` segue **OPÇÃO C (bundle-relative):** o operador faz o build no dev, empacota junto com `install.sh`, copia para a VPS, extrai e executa. Sem download em runtime, sem servir o binário pelo próprio backend (legado fazia isso — vetor de supply chain rejeitado).

### Dev — preparar bundle

```bash
cd Scrumban-Backend-V2/agent
npm install
npm run build                        # gera dist/
tar czf /tmp/scrumban-agent-bundle.tar.gz \
  dist/ \
  systemd/ \
  install.sh \
  uninstall.sh \
  CLAUDE-md-template.md \
  package.json \
  package-lock.json
```

### VPS — extrair e instalar

```bash
# 1. Copiar bundle para a VPS
scp /tmp/scrumban-agent-bundle.tar.gz user@vps:/tmp/

# 2. SSH para a VPS
ssh user@vps

# 3. Extrair
sudo mkdir -p /tmp/scrumban-agent-bundle
sudo tar xzf /tmp/scrumban-agent-bundle.tar.gz -C /tmp/scrumban-agent-bundle
cd /tmp/scrumban-agent-bundle
```

### Migração futura

`--bundle-url` apontando para release GitHub é uma evolução prevista mas não implementada no MVP. Quando for hora, o `install.sh` ganha o flag e o operador troca `tar` local por `curl` da release tag verificada via checksum.

---

## Passo 1 — Gerar install-token no backend

```bash
# No host com acesso à API do backend, autenticado como admin:
curl -X POST https://api.scrumban.com.br/agents/install-token \
  -H "Authorization: Bearer <admin-jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "idProjeto": 42,
    "label": "VPS produção CEO"
  }'
```

Resposta:

```json
{
  "tokenPlain": "ait_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx",
  "expiresAt": "2026-05-13T00:00:00Z"
}
```

**Trate o `tokenPlain` como segredo de uso único.** Ele só aparece nesta resposta. Se perder, gere outro — o backend invalida o anterior automaticamente.

---

## Passo 2 — Executar install.sh

```bash
sudo bash install.sh \
  --backend=https://api.scrumban.com.br \
  --token=ait_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx \
  --backend-tunnel-host=104.238.205.111 \
  --backend-tunnel-port=2025 \
  --tunnel-port=20000 \
  --allowed-roots=/home/dev/projetos
```

### Flags

| Flag | Obrigatória | Descrição |
|---|---|---|
| `--backend` | sim | URL base HTTPS do Scrumban-Backend-V2. Sem `/` final. |
| `--token` | sim | Install token one-shot gerado no Passo 1. |
| `--backend-tunnel-host` | sim | Host SSH alvo do reverse tunnel (IP ou DNS). |
| `--backend-tunnel-port` | sim | Porta SSH do backend (default `22`). |
| `--tunnel-port` | sim | Porta local 127.0.0.1 onde o agente escuta HTTP (ex: `20000`). O backend abre conexão SSH e o agente recebe via `-R`. |
| `--allowed-roots` | sim | Lista CSV de prefixos válidos onde `claude -p` pode ser executado. Anti path-injection (defesa em profundidade ADR-V2-035). Ex: `/home/dev/projetos` ou `/home/dev/projetos,/opt/projetos`. |
| `--claude-md-path` | não | Override do CLAUDE.md global. Default: `/root/.claude/CLAUDE.md`. |
| `--log-level` | não | `error|warn|info|debug`. Default `info`. |
| `--dry-run` | não | Imprime cada comando sem executar. Útil para revisar o flow. Bypassa root check. |
| `--yes` | não | Bypassa prompts interativos (uso em CI/automação). |

### O que o install.sh faz (14 fases)

1. **Parse args + validações:** root check, distro check (Ubuntu/Debian), idempotência (falha se `/etc/scrumban-agent/config.json` já existe — exige `uninstall.sh` antes).
2. **Pre-flight:** `timedatectl set-ntp true` (clock skew), Node 20+, autossh, jq, curl, Claude Code CLI ≥ 2.1.139 (via `semver_ge`).
3. **User `scrumban-agent`** (system, sem shell, idempotente).
4. **Diretórios:**
   - `/opt/scrumban-agent/` (binário, 0755)
   - `/etc/scrumban-agent/` (config + ssh key + environment, 0700, owner scrumban-agent)
   - `/var/lib/scrumban-agent/` (state, 0700, owner scrumban-agent)
   - `/var/log/scrumban-agent/` (logs install, 0750)
5. **Copia `dist/`** → `/opt/scrumban-agent/dist/`.
6. **Gera par Ed25519** em `/etc/scrumban-agent/ssh_key` (priv 0600) — só se ausente. A pub key vai para handshake.
7. **Handshake:** `POST /agents/install-token` com `{token, hostname, sshPubKey, agentVersion}`. Recebe `{agentId, agentApiKey, agentCommandSecret, tunnelPort}`.
8. **ssh-keyscan** do `backendTunnelHost` → `/etc/scrumban-agent/known_hosts`. Stderr (TOFU fingerprint) é tee-ed para `/var/log/scrumban-agent/install.log` + terminal **para o operador verificar manualmente a identidade do host** antes de continuar.
9. **`config.json`** em `/etc/scrumban-agent/config.json` (0600, owner scrumban-agent). Gerado via `jq`.
10. **`environment` placeholder** em `/etc/scrumban-agent/environment` (0600, owner scrumban-agent). Conteúdo inicial:
    ```bash
    # ANTHROPIC_API_KEY=sk-ant-...
    # ANTHROPIC_AUTH_TOKEN=...
    ```
    Operador precisa **descomentar e preencher uma das linhas** após o install (passo 5 abaixo). Idempotente — se já existe, preserva.
11. **systemd unit:** `systemctl daemon-reload && enable && restart scrumban-agent.service`.
12. **CLAUDE.md template:** copia `CLAUDE-md-template.md` → `/root/.claude/CLAUDE.md` **apenas se ausente** (não sobrescreve — evita prompt injection via re-instalação).
13. **Heartbeat poll 60s:** `journalctl -u scrumban-agent --since "60s ago"` esperando linha `"heartbeat"`. Detecta clock skew, túnel down, backend rejeitando.
14. **Resumo final colorido** com avisos de pendências (env file vazio, CLAUDE.md ainda com template, etc.).

### Idempotência

- Se `/etc/scrumban-agent/config.json` já existir, **o install falha** com instrução para rodar `uninstall.sh` antes. Não há `--reinstall` (decisão consciente — evita sobrescrita acidental de credenciais).
- User, chaves SSH e diretórios são criados só se ausentes.
- Systemd unit é sempre re-copiado + `daemon-reload`.

### Dry-run (smoke test local)

```bash
bash install.sh --dry-run \
  --backend=https://api.scrumban.com.br \
  --token=fake-token \
  --backend-tunnel-host=104.238.205.111 \
  --backend-tunnel-port=2025 \
  --tunnel-port=20000 \
  --allowed-roots=/home/dev/projetos
```

Imprime as 14 fases sem efeito colateral. Bypassa root e distro check. Rodável em macOS dev (validado).

---

## Passo 3 — Verificar que o serviço subiu

```bash
sudo systemctl status scrumban-agent.service
sudo journalctl -u scrumban-agent.service -n 50 --no-pager
```

Esperado nos logs:

```text
... "scrumban-agent pronto (Sub-tarefa 5: tunnel + lifecycle ativos)"
... "heartbeat enviado" agentId=... durationMs=...
```

Se não houver `heartbeat enviado` em 60s, ver §Troubleshooting → "Heartbeat não chega no backend".

---

## Passo 4 — Popular `/root/.claude/CLAUDE.md`

`install.sh` copia o template apenas se o arquivo está ausente. **NUNCA popula automaticamente** os slugs (risco de prompt injection — atacante manipula `install.sh` para inserir entradas falsas).

Editar manualmente:

```bash
sudo $EDITOR /root/.claude/CLAUDE.md
```

Formato canônico:

```markdown
# CLAUDE.md global — mapeamento de slugs

## scrumban-backend-v2
Caminho: /home/dev/projetos/scrumban-backend-v2

## scrumban-frontend
Caminho: /home/dev/projetos/scrumban-frontend
```

- `Caminho:` ou `Path:` aceitos (sinônimos).
- Slug case-sensitive — case **exatamente igual** ao `DProject.dados.slug` no backend.
- Path absoluto, sob algum dos prefixos em `allowedProjectRoots` (caso contrário o agente rejeita com `WORKSPACE_OUTSIDE_ALLOWED_ROOT`).
- Não é necessário reiniciar o serviço — o agente lê o arquivo a cada `RUN_CLAUDE_CODE`.

---

## Passo 5 — Preencher Anthropic API key

`install.sh` cria `/etc/scrumban-agent/environment` VAZIO. **Sem ANTHROPIC_API_KEY, `claude -p` retorna `authentication_error` e todo `RUN_CLAUDE_CODE` falha** (causa mais comum de falha pós-install — ver §Troubleshooting).

```bash
sudo $EDITOR /etc/scrumban-agent/environment
```

Descomente e preencha **uma** das linhas:

```bash
ANTHROPIC_API_KEY=sk-ant-XXXX
# OU
ANTHROPIC_AUTH_TOKEN=YYYY
```

Reinicie:

```bash
sudo systemctl restart scrumban-agent.service
```

Verifique que a variável chegou no processo:

```bash
sudo systemctl show scrumban-agent --property=Environment | grep -i anthropic
# OU (mais robusto em algumas versões do systemd):
sudo cat /proc/$(pgrep -u scrumban-agent -f 'node.*scrumban-agent')/environ \
  | tr '\0' '\n' | grep -i anthropic
```

---

## Passo 6 — Smoke test end-to-end

No backend, dispare execução de teste para um projeto cujo slug está no `CLAUDE.md`:

```bash
curl -X POST https://api.scrumban.com.br/projects/42/executions \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{
    "prompt": "ping",
    "riskLevel": "LOW"
  }'
```

Acompanhe:

```bash
sudo journalctl -u scrumban-agent.service -f
```

Esperado:

```text
... "/v1/execute received" type=RUN_CLAUDE_CODE projectSlug=scrumban-backend-v2
... "claude exit" exitCode=0 durationMs=...
... "execution-result enviado" executionId=... claudeSessionId=550e8400-...
```

No backend, o `DPedido` correspondente deve estar com `dados.claude.sessionId` preenchido (ver `OperacaoExecucaoClaude`).

---

## Revogação / Desinstalação

### Revogar agente do projeto (backend)

```bash
curl -X DELETE https://api.scrumban.com.br/projects/42/agent/<agentId> \
  -H "Authorization: Bearer <admin-jwt>"
```

O backend rejeita se houver execução ativa (`QUEUED`, `APPROVED`, `AWAITING_APPROVAL`, `RUNNING`). Aguarde drenar ou cancele manualmente.

### Desinstalar agente da VPS

```bash
sudo bash uninstall.sh         # confirmação interativa
sudo bash uninstall.sh --yes   # sem prompt
```

Remove:
- Service systemd + unit + drop-ins
- Binário `/opt/scrumban-agent/`
- Config `/etc/scrumban-agent/`
- State `/var/lib/scrumban-agent/`
- Logs `/var/log/scrumban-agent/`
- User `scrumban-agent`

**Preserva intencionalmente:** `/root/.claude/CLAUDE.md` (reinstalações futuras reaproveitam mapeamento de slugs).

---

## Rotação de chave (ad-hoc)

Rotação automática fica fora da F13 MVP. Processo manual:

1. Revogar agente antigo (passo Revogação acima).
2. Gerar novo install-token (Passo 1).
3. `uninstall.sh` na VPS.
4. `install.sh` novamente com o novo token.
5. Validar heartbeat (passo 3) e smoke test (passo 6).

A pub key SSH é regerada em cada `install.sh` (a menos que `/etc/scrumban-agent/ssh_key` já exista). Se houver `authorized_keys` no backend ainda apontando para a chave antiga, **remover manualmente** após confirmar que a nova subiu.

---

## Troubleshooting

### Heartbeat não chega no backend

Causas em ordem de probabilidade:

1. **Clock skew na VPS** — HMAC rejeita timestamps fora de ±5min.
   ```bash
   timedatectl status
   sudo timedatectl set-ntp true
   sudo systemctl restart systemd-timesyncd
   sudo systemctl restart scrumban-agent
   ```

2. **Túnel SSH em loop de crash** (autossh circuit breaker).
   ```bash
   journalctl -u scrumban-agent.service -f | grep -E 'autossh|circuit'
   ```
   Se vir `"circuit_open": true`, a chave SSH provavelmente não está autorizada no `backendTunnelHost`. Verifique:
   ```bash
   sudo cat /etc/scrumban-agent/ssh_key.pub
   # Compare com authorized_keys do user dedicado no backend
   ```

3. **Backend rejeitando 401/403/429** — `agentApiKey` expirada, HMAC inválido, ou rate limit.
   ```bash
   journalctl -u scrumban-agent.service | grep -E '4[0-9][0-9]|5[0-9][0-9]'
   ```

4. **TOFU host key mismatch** — `backendTunnelHost` mudou identidade SSH.
   ```bash
   sudo cat /etc/scrumban-agent/known_hosts
   sudo ssh-keyscan -p <port> <host>   # comparar fingerprint
   ```

### `RUN_CLAUDE_CODE` falha

1. **`ANTHROPIC_API_KEY` ausente** (causa mais comum na primeira instalação).
   ```bash
   sudo $EDITOR /etc/scrumban-agent/environment
   # Descomente: ANTHROPIC_API_KEY=sk-ant-... OU ANTHROPIC_AUTH_TOKEN=...
   sudo systemctl restart scrumban-agent
   sudo systemctl show scrumban-agent --property=Environment | grep -i anthropic
   ```

2. **Claude Code CLI ausente ou < 2.1.139.**
   ```bash
   sudo -u scrumban-agent bash -c 'command -v claude && claude --version'
   sudo /usr/bin/npm install -g @anthropic-ai/claude-code
   ```

3. **`UNKNOWN_PROJECT_SLUG`** — `/root/.claude/CLAUDE.md` não tem entrada `## <slug>` para o projeto. Adicione (Passo 4 acima).

4. **`WORKSPACE_OUTSIDE_ALLOWED_ROOT`** — o `Caminho:` no `CLAUDE.md` aponta para fora de `allowedProjectRoots`. Duas opções:
   - Mover o repo para sob a raiz permitida.
   - Adicionar nova raiz ao `config.json`:
     ```bash
     sudo jq '.allowedProjectRoots += ["/nova/raiz"]' \
       /etc/scrumban-agent/config.json > /tmp/cfg.json && \
       sudo mv /tmp/cfg.json /etc/scrumban-agent/config.json && \
       sudo chown scrumban-agent:scrumban-agent /etc/scrumban-agent/config.json && \
       sudo chmod 0600 /etc/scrumban-agent/config.json && \
       sudo systemctl restart scrumban-agent
     ```

5. **`CLAUDE_MD_UNREADABLE`** — arquivo ausente ou sem permissão de leitura para `scrumban-agent`.
   ```bash
   ls -l /root/.claude/CLAUDE.md
   # Deve ser owner=root, mode=0644 (legível por todos, escrita só root)
   sudo chmod 0644 /root/.claude/CLAUDE.md
   ```

### Service não inicia

```bash
sudo systemctl status scrumban-agent.service
sudo journalctl -u scrumban-agent.service --no-pager | tail -50
```

Erros comuns:

- **`config.json modo inválido`** — o loader rejeita modo ≠ 0600.
  ```bash
  sudo chmod 0600 /etc/scrumban-agent/config.json
  sudo chown scrumban-agent:scrumban-agent /etc/scrumban-agent/config.json
  ```

- **`zod validation failed`** — campo faltando/inválido no `config.json`. Log mostra qual.
  Última opção: `uninstall.sh` + `install.sh` novamente.

### Logs verbosos para debug

```bash
sudo jq '.logLevel = "debug"' /etc/scrumban-agent/config.json > /tmp/cfg.json && \
  sudo mv /tmp/cfg.json /etc/scrumban-agent/config.json && \
  sudo chown scrumban-agent:scrumban-agent /etc/scrumban-agent/config.json && \
  sudo chmod 0600 /etc/scrumban-agent/config.json && \
  sudo systemctl restart scrumban-agent.service
```

Lembre de voltar para `info` após o diagnóstico (`debug` é verboso e inclui payloads completos).

### Códigos HTTP comuns

| Código | Significado | Ação |
|---|---|---|
| `401` | HMAC inválido | Conferir `agentApiKey`, timestamp, clock |
| `403` | Agente revogado ou projeto inativo | Verificar no backend |
| `409` | Nonce repetido (replay) | Bug no cliente — verificar geração de UUID por request |
| `429` | Rate limit (>60 req/min) | Reduzir frequência ou aumentar limite no config |
| `5xx` | Erro no backend | Investigar logs backend |
| `TUNNEL_UNAVAILABLE` | Reverse tunnel down | Verificar autossh status |
| `WORKSPACE_OUTSIDE_ALLOWED_ROOT` | Path injection bloqueado (defesa) | Conferir `CLAUDE.md` e `allowedProjectRoots` |
| `UNKNOWN_PROJECT_SLUG` | Slug ausente no CLAUDE.md | Popular `CLAUDE.md` |

---

## Segurança

### Princípios aplicados (ADR-V2-035, ADR-V2-037, ADR-V2-001)

- **Sem path absoluto no payload outbound** — agente recebe apenas `projectSlug`.
- **Allowlist defensiva** via `realpath` (anti-symlink) — bloqueia `CLAUDE.md` adulterado.
- **HMAC-SHA256 inbound+outbound** com timestamp ±5min anti-replay + nonce LRU 10min.
- **systemd hardening:** `User=scrumban-agent`, `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome=read-only`, `RestrictSUIDSGID`, `LockPersonality`, `RestrictNamespaces`, `MemoryMax=512M`.
- **Config 0600**, owner non-root, loader rejeita modo errado.
- **Zero persistência local de domínio** — todo audit/state mora no backend.

### Lista de itens NÃO no MVP (débito explícito)

- Política de retenção de `~/.claude/projects/<encoded-cwd>/*.jsonl` (cresce ilimitadamente).
- Rotação automática de chaves (`agentApiKey`, `agentCommandSecret`, SSH key).
- Distribuição via GitHub release com checksum verificado (`--bundle-url`).
- Múltiplos agentes na mesma VPS (suportado teoricamente, não testado).
- Endpoints `LIST_CLAUDE_SESSIONS` / `READ_CLAUDE_SESSION` / `STREAM_CLAUDE_SESSION` (porta aberta protocolar — ADR-V2-037).

Ver `agent/README.md` §Limitações para a lista completa.

---

## Referências

- ADR-V2-001 — zero tabela nova.
- ADR-V2-005 — `OperacaoExecucaoClaude` extends `OperacaoPedido`.
- ADR-V2-006 — risk via idClasse (-301/-302/-303).
- ADR-V2-033 — contrato `/v1/execute` outbound + `execution-result` inbound + DEvento sessão lifecycle.
- ADR-V2-035 — identidade de projeto via `projectSlug` + `CLAUDE.md` global.
- ADR-V2-036 — monorepo `Scrumban-Backend-V2/agent/`.
- ADR-V2-037 — ponteiro de sessão Claude Code (`claudeSessionId`) para chat-with-VPS futuro.
- `agent/README.md` — overview operacional do subprojeto.
- `agent/install.sh` — fonte da verdade do flow de instalação.
- `agent/systemd/scrumban-agent.service` — unit file com hardening.
- `agent/CLAUDE-md-template.md` — template do mapeamento de slugs.
- `docs/automation-security-runbook.md` — peppers/keys do backend.
- `docs/automation-guide.md` — guia funcional do operador (executar, aprovar, auditar).

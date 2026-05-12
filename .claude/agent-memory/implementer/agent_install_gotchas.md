---
name: agent-install-gotchas
description: Decisões e armadilhas do install.sh + systemd + CLAUDE.md template do scrumban-agent (F13 Sub-tarefa 6)
metadata:
  type: project
---

# Decisões do install.sh do scrumban-agent (V2 F13 Sub-tarefa 6)

**Why:** Sub-tarefa 6 decidiu três coisas que mudam comportamento esperado por reviewers e por sub-tarefas futuras. Sem registrar isso, alguém vai questionar o "porquê" e refatorar errado.

**How to apply:** quando alguém propor mudanças no install.sh, systemd unit ou CLAUDE.md handling, verificar se a mudança colide com uma destas decisões antes de aceitar.

## Decisão 1: Distribuição OPÇÃO C (bundle-relative)

`install.sh` lê `dist/`, `systemd/scrumban-agent.service` e `CLAUDE-md-template.md` do mesmo diretório onde ele foi extraído (default `$SCRIPT_DIR`, override com `--bundle-dir`).

NÃO baixa de URL nem do próprio backend (legado fazia `curl ${ARGUS_API}/agent-dist/index.js` — vetor de supply chain). Operador faz `tar czf` no dev e `scp` para VPS.

Quando migrar para `--bundle-url` (GitHub release): só adicionar fase 5b condicional. Não reescrever o resto.

## Decisão 2: `claudeMdPath` default = `/root/.claude/CLAUDE.md`

Não é `~scrumban-agent/.claude/CLAUDE.md`. Razões:
- Agente é user de sistema sem identidade humana; CLAUDE.md é do CEO.
- CEO opera o backend como root (sudo) — alinhamento natural.
- Agente lê via `chmod 0644` no arquivo. systemd `ProtectHome=read-only` permite.

NÃO mudar para `=yes` (bloqueia leitura). NÃO mudar `chmod` para 0600 (agente perde acesso).

## Decisão 3: Idempotência forte, SEM `--reinstall`

Se `config.json` já existe, `install.sh` falha com instrução para rodar `uninstall.sh` antes. Não há flag para forçar sobrescrita.

Razão: credenciais (`agentApiKey`, `agentCommandSecret`) ficam em texto plano no `config.json` (decifradas pelo install). Sobrescrever por acidente perde a única cópia.

Se reviewer pedir `--reinstall`, pedir justificativa caso-de-uso explícito antes de adicionar.

## Decisão 4: ANTHROPIC_API_KEY via EnvironmentFile (Opção A — rodada 2)

`systemd/scrumban-agent.service` carrega `/etc/scrumban-agent/environment` (0600 owner scrumban-agent) via `EnvironmentFile=-...` (prefixo `-` = não falha se ausente). `install.sh` fase 9b cria esse arquivo com placeholder comentado:

```
# ANTHROPIC_API_KEY=sk-ant-...
# ANTHROPIC_AUTH_TOKEN=...
```

Operador edita após instalação. Sem isso, `claude -p` falha com `authentication_error` na primeira execução. Mensagem final do install pede explicitamente para preencher.

Alternativas descartadas:
- **Opção B (`claude setup` interativo):** depende de comando interativo do Claude Code que pode não existir; difícil de automatizar via Ansible/Terraform.
- **Hardcode no install.sh:** vazaria secret em logs de CI/CD.
- **Variável da sessão do CEO:** systemd herda só env de sistema, não da sessão.

Opção A é explícita, idempotente, configurável por terceiros, e o `systemctl restart` é único requisito para aplicar.

`uninstall.sh` apaga `/etc/scrumban-agent/` inteiro — env file vai junto. Sem mudança específica lá.

## Decisão 5: ssh-keyscan stderr é VISÍVEL (TOFU consciente — rodada 2)

`ssh-keyscan` imprime o fingerprint no stderr. Rodada 1 redirecionava com `2>/dev/null` — perdia o hash que o operador deveria verificar manualmente (Trust On First Use). Rodada 2 corrigiu:

```bash
sudo -u scrumban-agent ssh-keyscan -p "${BACKEND_TUNNEL_PORT}" "${BACKEND_TUNNEL_HOST}" \
  >> "${KNOWN_HOSTS_FILE}" \
  2> >(tee -a "${INSTALL_LOG_FILE}" >&2) \
  || true
```

stdout (linhas do known_hosts) → arquivo. stderr (fingerprint) → tee em log + terminal do operador (via process substitution). Warning explícito pede para anotar/comparar.

`|| true` mantido porque ssh-keyscan pode falhar em host down sem bloquear install (operador roda novamente). Log em `/var/log/scrumban-agent/install.log` facilita debug.

## Shellcheck: 3 suppressions justificadas (rodada 2)

1. **SC2294** em `run() { eval "$@" }`: eval é intencional — os comandos contém redirects (`>/dev/null`), pipes (`|`) e expansões. Input vem só de constantes hardcoded no script. Comentário inline justifica.
2. **SC2034** em `for i in $(seq 1 30)`: trocado para `for _ in ...` (variável de loop não usada).
3. **SC2024** em `sudo -u scrumban-agent ssh-keyscan ... >> "${KNOWN_HOSTS_FILE}"`: shellcheck aponta que `>>` é interpretado como root (não como o user de `sudo -u`). Intencional aqui — queremos o stdout do processo (já trocado para scrumban-agent via sudo) anexado ao arquivo, e o arquivo já é owned por scrumban-agent. Comentário inline justifica.

Se aparecer mais shellcheck warning em PRs futuros, NÃO suprimir sem justificativa escrita.

## Pasta `agent/.claude/` é PROIBIDA (rodada 2 — incidente M1)

Toda memória de agents do projeto vive em `<repo-root>/.claude/agent-memory/<role>/`. Em rodada 1, criei por engano `agent/.claude/agent-memory/implementer/` — duplicação órfã que nenhum agent futuro leria.

Corrigido: conteúdo migrado para a localização canônica, `agent/.claude/` deletada, `.claude/` adicionado ao `agent/.gitignore` com comentário. Quem editar `agent/` no futuro: NUNCA criar `.claude/` lá dentro. O gitignore impede o commit acidental, mas vale o lembrete consciente.

## Pre-flight Claude Code CLI versão mínima

Versão mínima `2.1.139` confirmada pelo spike de Sub-tarefa 4. Versões anteriores tem output JSON diferente (campo `session_id` pode estar `sessionId` ou ausente).

`semver_ge` no install usa `sort -V` POSIX. Funciona corretamente para `2.1.139` vs `2.1.140` vs `2.2.0`.

Quando subir o mínimo (ex: CLI v3.0 deprecou flag), alterar a constante `CLAUDE_CODE_MIN_VERSION` no topo do install.sh.

## Heartbeat poll 60s

Última fase do install valida que o serviço subiu E está se comunicando. Detecta clock skew, túnel down, backend rejeitando — todos os problemas comuns em primeira instalação.

Se journalctl não tiver linha contendo `heartbeat` em 60s, mostra warning (NÃO falha hard — pode ser flakiness local). Reviewer pode questionar "por que não falha?" — resposta: o install já fez tudo (config, systemd, autossh keys); falhar agora é destrutivo, melhor avisar e deixar operador investigar.

## Dry-run bypassa root + apt-get check

`require_root()` e o check de `apt-get` retornam warning em vez de erro quando `--dry-run`. Permite smoke test em qualquer dev box sem sudo.

NÃO confiar em dry-run para validar lógica de execução real — apenas validar fluxo de comandos.

# Automation Security Runbook

## Principios

- Fail closed em runtime remoto.
- Sem shell string livre.
- Sem rollback destrutivo na branch principal.
- Segredos nunca devem aparecer em logs, eventos ou responses depois do install.

## Comandos

Executions aceitam somente comando estruturado validado por `CommandValidatorService`.

Proibido:

- `sh -c`
- pipe, redirect, subshell
- path absoluto ou `..` em `cwd`
- env com nomes ou valores aparentando segredo

## Replay e rate limit

Requests do agent exigem:

- `X-Agent-Nonce`
- `X-Agent-Timestamp`
- janela maxima de 5 minutos
- nonce unico por agent por 10 minutos
- 30 req/min por agent

Redis e usado quando `REDIS_URL` esta configurado. Sem Redis, ha fallback in-memory por processo para dev/test.

## Sanitizacao

Campos redigidos automaticamente em eventos/logs:

- `token`
- `apiKey`
- `secret`
- `key`
- `password`
- `authorization`
- `privateKey`
- `ssh`

Verificacao local:

```bash
rg -n "agentApiKey|agentCommandSecret|installToken|authorization|privateKey|password" logs dist src
```

## Rollback

Rollback automatico so roda dentro do `RollbackService` e apenas quando:

- a execution usou worktree isolada;
- a branch tem prefixo `scrumban/exec-*`;
- `rollbackOnFailure=true`.

Rollback manual legado em `/executions/:id/rollback` falha fechado.

## GitHub App

Antes de habilitar PR automatico:

1. Configurar `GITHUB_APP_ID`.
2. Configurar `GITHUB_APP_PRIVATE_KEY`.
3. Configurar `GITHUB_INSTALLATION_ID`.
4. Confirmar que `dados.automation.remoteRepoUrl` aponta para o repo esperado.
5. Confirmar que PR so abre para `head=scrumban/exec-*` e base nao usa esse prefixo.

Falha do GitHub nao apaga logs nem altera branch principal; vira auditoria em `DEvento -496`.

## Incidentes

Se suspeitar de vazamento de agent key:

1. Parar o processo do agent.
2. Remover vinculo project-agent se nao houver execution ativa.
3. Reinstalar agent com token novo.
4. Auditar `DEvento -496` e `/automation/metrics`.

## Risk Gate v2 — deploy e verificação (ADR-V2-081)

O Risk Gate (DVFS chave 3) passou a avaliar `dados.prompt` no modo PROMPT. O seed DVFS **não roda no boot**;
até ele ser reaplicado, a guarda de contrato do Engine eleva toda execução em modo PROMPT para no mínimo MEDIUM
(fail-safe — "Risk Gate desatualizado" na `explanation` e `logger.warn`).

1. Deploy da imagem nova.
2. `npm run seed` (`node dist/prisma/seeds/seed-runner.js` — idempotente, ADR-V2-020). **Não** bumpar `versao` da DVFS.
3. Rodar a query 1 de `workspace/implementations/sql-executions-risk-gate-prompt-mode-task1.sql`:
   esperado `is_v2=true` e `hash` igual ao `md5sum dist/src/engine/dvfs/risk-gate-validator.js`.
4. Restart do backend ou aguardar 5 min (cache DVFS em memória).
5. Smoke: task neutra → LOW/queued; task "apague a tabela X" → `awaiting_approval` HIGH.

Chave de emergência: `RISK_GATE_PROMPT_FLOOR=MEDIUM` (ou `HIGH`) força todo modo PROMPT a exigir aprovação
(`POST /executions/:id/approve`). Default desligado. Exige restart para valer.

## Ciclo de vida terminal de execuções — deploy conjunto (ADR-V2-082, Task 2)

> **Estado:** runbook pronto. Execução é do CEO/ops. **Smoke na VPS pendente.**
> **Obrigatório no mesmo release:** frontend F-1 (tratar 409 `EXECUTION_IN_PROGRESS`). Sem ele, clique duplo em "Executar" mostra erro cru.

### Ordem

```
 1. pg_dump -t '"DPedido"'                                   backup (antes de tudo)
 2. backfill --dry-run                                       revisar contagens
 3. backfill --apply --close-stale-running [--release-tasks] silencioso, ANTES do backend novo
 4. seed DVFS (Task 1) + conferir md5                        ADR-V2-081
 5. RISK_GATE_PROMPT_FLOOR=MEDIUM                            até medir falso positivo (Task 1)
 6. deploy backend                                           sweeper começa a rodar 1/min
 7. deploy frontend (F-1 obrigatório)
 8. bundle do agente 0.1.1 (SIGKILL) na VPS                  encaixa no fluxo da Task 3
 9. smoke na VPS real
```

### Passo a passo

**1. Backup**

```bash
pg_dump "$DATABASE_URL" -t '"DPedido"' -Fc -f dpedido-pre-adr082.dump
```

**2. Backfill em dry-run (não grava nada)**

```bash
npx ts-node prisma/scripts/backfill-execution-baixado.ts --dry-run
```

Conferir: contagem de terminais com `baixado=false`, RUNNING vencidas (critério do sweeper) e tasks EXECUTING afetadas.

**3. Backfill em apply (grava snapshot antes)**

```bash
npx ts-node prisma/scripts/backfill-execution-baixado.ts --apply --close-stale-running
# com --release-tasks só depois de revisar a lista de tasks EXECUTING no dry-run
```

- Grava `backfill-execution-baixado.<timestamp>.json` (contém `dados` completos, incluindo stdout/prompt): guardar com permissão 600 e fora do repositório. Não é versionado (`.gitignore`).
- Sem eventos (`execution.failed`, notificação, webhook). Tasks liberadas emitem só os eventos normais de status.
- Rollback: `npx ts-node prisma/scripts/backfill-execution-baixado.ts --revert <snapshot.json>` (só reverte linhas que ainda estão no estado gravado pelo backfill).

**4. Seed DVFS e 5. piso do Risk Gate**

Seguir o runbook do ADR-V2-081 (seção "Risk Gate v2" acima). Conferir md5 do seed DVFS antes de subir o backend.

**6. Deploy do backend**

Confirmar nos logs que o sweeper iniciou (1 ciclo por minuto) e que não houve rajada de `execution.failed` no primeiro ciclo.

**7. Deploy do frontend (F-1)**

Repo `scrumban/frontend`. Validar: 409 `EXECUTION_IN_PROGRESS` vira "Já existe uma execução em andamento" com retomada do polling da execução existente.

**8. Agente 0.1.1 na VPS**

Bundle com SIGKILL (grace de 15 s). Sem ele, o backend continua funcionando (cobre o agente antigo), mas um `claude` que ignora SIGTERM segura o mutex do projeto até o restart.

**9. Smoke na VPS real (pendente)**

- Execução normal: `started` → `finished`, `baixado=true` no terminal
- Clique duplo em "Executar": segunda chamada recebe 409 `EXECUTION_IN_PROGRESS`
- REJECTED / EXPIRED: `baixado=true`, lock liberado
- RUNNING forçada sem callback: fechada como `TIMEOUT_NO_CALLBACK` após `timeoutSec + 300 s`

### Rollback geral

1. Reverter backend e frontend para o release anterior.
2. Backfill: `--revert <snapshot>`.
3. Restaurar `DPedido` do dump só se o revert não bastar (último recurso).

### Pendências conhecidas

- L11: validar SQL (advisory lock e ramo `QUEUE_STALE`) em Postgres de staging antes do deploy.
- Follow-ups de ADR-V2-082: L6 (SIGKILL no process group), L8 (pool sob rajada), L9 (`movedBy` forjável), L10 (ordem `started`/`finished`), `markRunning` fora do Engine.
- Task 3 (fluxo de agentes na VPS): implementada — ver a seção "Esteira headless na VPS" abaixo, que SUBSTITUI os passos 6–9 desta sequência no deploy conjunto. L6 (kill do process group) foi resolvido na Task 3.

## Esteira headless na VPS — deploy conjunto T1+T2+T3 (ADR-V2-083, Task 3)

> **Estado:** runbook pronto; execução é do CEO/ops. **Fase 0 (spike na VPS como `scrumban-agent`) e smoke PENDENTES.**
> **Regra de ouro:** o **backend sobe ANTES do agente**. O `ValidationPipe` global usa `forbidNonWhitelisted`: agente 0.2.0 mandando o bloco `pipeline` para backend antigo ⇒ 400 ⇒ o resultado de horas de esteira se perde (4xx não tem retry).

### Ordem (encaixa na sequência da Task 2)

```
 1-5. (Task 2) pg_dump, backfill, seed DVFS, RISK_GATE_PROMPT_FLOOR
 3b.  npx ts-node prisma/scripts/detect-project-slug-divergence.ts   dry-run (só leitura)
      └─ colisões (exit 2) ⇒ re-provisionar os pares ANTES do deploy (unlink + link + provision)
 6.   deploy BACKEND (T1+T2+T3)        ← antes do agente
 7.   deploy FRONTEND (link do PR + 5 motivos novos + duração até 6h)
 8.   agente 0.2.0 na VPS (L6 + contrato) + CLAUDE.md global SEM regras git (agent/CLAUDE-md-template.md)
 8b.  comando .claude/commands/scrumban-executar.md em CADA repo de cliente (PR em cada repo, mergeado na base)
 8c.  GITHUB_TOKEN no env do agente (SET_ENV ou /etc/scrumban-agent/environment), escopo repo
 9.   smoke Task 2 + smoke Task 3 (abaixo)
```

- Agente 0.1.x com backend novo **funciona** (campos novos opcionais; sem bloco `pipeline` no callback ⇒ regra legada). Mas o 0.1.x ignora o preflight: repo sem o comando não falha com `PIPELINE_NOT_INSTALLED` até o 0.2.0 subir.
- Repo sem o comando + agente 0.2.0 ⇒ toda execução de task daquele repo falha em < 5 s com `PIPELINE_NOT_INSTALLED` (decisão CEO P1, todos os tipos). Por isso o passo 8b vem junto com o 8.
- Execuções `COMMAND`/`HÍBRIDO` (sem task) seguem no modo simples.

### Variáveis novas (opcionais)

| Onde | Variável | Default | Efeito |
|---|---|---|---|
| backend | `EXECUTION_PIPELINE_DEFAULT_TIMEOUT_SEC` | 14400 | timeout do modo esteira (teto fixo 21600) |
| backend | `EXECUTION_BUSY_MAX_WAIT_SEC` | 21900 | janela de espera do 409 PROJECT_BUSY (P4) |
| backend | `EXECUTION_DEFAULT_TIMEOUT_SEC` | 1800 | agora também respeitado na criação (modo simples) |
| agente (`config.json`) | `pipelineTimeoutMaxSec` | 21600 | teto local do timeout |
| agente | `maxBudgetUsd` | ausente (desligado — P2) | `--max-budget-usd` por execução |
| agente | `prFallback` | `true` | rede de segurança: commits sem PR ⇒ PR rascunho |

### Fase 0 — spike na VPS (bloqueante para confiar no agente 0.2.0)

Rodar **como `scrumban-agent`** (não root), num repo provisionado e com o comando instalado:

```bash
sudo -u scrumban-agent -H bash -lc '
  cd <repo-provisionado> &&
  claude --version &&
  gh auth status &&
  claude -p "/scrumban-executar CONTROLE-SCRUMBAN v1
\`\`\`json
{\"contractVersion\":1,\"executionId\":\"spike\",\"branch\":\"scrumban/exec-spike\",\"baseBranch\":\"<base>\",\"taskType\":\"research\",\"prRequired\":false}
\`\`\`

Tarefa de teste: liste os agentes do repo e não altere arquivos." \
    --append-system-prompt "$(node -e "console.log(require(\"/opt/scrumban-agent/dist/claude-code/pipeline-contract.js\").PIPELINE_APPEND_SYSTEM_PROMPT)")" \
    --json-schema "$(node -e "console.log(require(\"/opt/scrumban-agent/dist/claude-code/pipeline-contract.js\").PIPELINE_RESULT_SCHEMA_JSON)")" \
    --exclude-dynamic-system-prompt-sections \
    --output-format json --dangerously-skip-permissions < /dev/null > /tmp/spike.json; echo exit=$?'
jq "{subtype, is_error, structured_output, subagent_stats}" /tmp/spike.json
```

Conferir e anotar no ADR-V2-083 (seção "Fatos verificados"):

1. `structured_output` presente e válido; `subagent_stats.by_type` lista os papéis que rodaram; `started_in_background == 0`.
2. CLAUDE.md do repo e `.claude/agents` carregados como `scrumban-agent` (pergunte ao modelo quais regras/agentes vê).
3. Hooks `SubagentStop`/`PreToolUse` rodam sob `--dangerously-skip-permissions`; `PreToolUse` com exit 2 BLOQUEIA? (criar hook de teste que sai 2 para `Bash(echo bloqueado)`).
4. `permissionMode` dos subagentes sob pai em bypass (subagente consegue Edit?).
5. `gh auth status` OK com `GITHUB_TOKEN` do EnvironmentFile; `gh pr list` no repo funciona.
6. `env` de `.claude/settings.local.json` é ignorado em workspace não confiado? (os hooks que dependem dele precisam de alternativa).
7. Ferramentas usadas pelos hooks presentes: `bc`, `jq`, `npm`, `node`.
8. `--max-turns=1` + `--json-schema` no warm: `subtype=error_max_turns` com `cache_creation_input_tokens > 0` (o warmer conta como sucesso).

### Smoke Task 3

- Task `code` num repo com o comando ⇒ PR aberto **pela esteira**; `GET /executions/:id` com `pullRequest.url`, `pullRequest.openedBy='pipeline'`, `git.branch=scrumban/exec-<id>`, `pipeline.decision='APPROVED'`, `pipeline.subagents` com os 4 papéis; task DONE.
- Esteira reprovada (forçar) ⇒ PR em **rascunho**, execução FAILED `PIPELINE_NOT_APPROVED`, task FAILED.
- Repo sem o comando ⇒ FAILED `PIPELINE_NOT_INSTALLED` em < 5 s; mutex livre (2ª execução não recebe 409).
- Timeout curto forçado (ex.: `EXECUTION_PIPELINE_DEFAULT_TIMEOUT_SEC=120`) com a esteira rodando `npm run dev` ⇒ grupo inteiro morto (`pgrep -u scrumban-agent` vazio), mutex liberado, callback chega.
- 2ª execução no mesmo projeto durante a esteira ⇒ fica QUEUED com retries de 300 s (log `PROJECT_BUSY retry N … aguardando ha Xs de ate 21900s`), não falha em 41 min.
- Medir `cache_read_input_tokens` da 2ª execução do mesmo projeto (re-baseline do warmer, ADR-V2-046).

### Rollback

1. Agente: reinstalar o bundle 0.1.1 (o backend novo aceita callback sem `pipeline`).
2. Backend: reverter o release. Execuções criadas no modo esteira ficam com `dados.pipeline`/`dados.git` (inofensivo para o código antigo); timeouts de 4h seguem valendo no sweeper antigo (lê `dados.timeoutSec`).
3. Comando nos repos: pode ficar (só é usado pelo agente 0.2.0).

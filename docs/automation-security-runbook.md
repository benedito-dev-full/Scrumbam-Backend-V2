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
- Task 3 (fluxo de agentes na VPS) ainda não planejada: se mudar `/v1/execute` ou o handler do agente, reavaliar esta sequência (R11 do plano).

# ADR-V2-033 — Contrato `/v1/execute` outbound + `execution-result` inbound + DEvento sessão lifecycle

**Status:** Proposto (esqueleto — Sub-tarefa 2.1 do plan-automation-backend-side-task2)
**Data:** 2026-05-12
**Autor:** Strategist V2 (planejado) / Implementer V2 (esqueleto inicial)

---

## Contexto

Sub-tarefa 2.1 do plano `workspace/plans/plan-automation-backend-side-task2.md`. Sub-tarefa lateral que destrava o Task #1 (agente V2 cliente, plano em `plan-automation-agent-v2-client-task1.md` Sub-tarefa 4).

Backend V2 hoje tem 2 lacunas que impedem o agente V2 client-side de funcionar de ponta a ponta:

1. **`RemoteExecutionClient`** (`src/automation/runtime/remote-execution-client.ts`) ainda envia payload shell-genérico (`{executable, args, cwd, env, timeoutMs, maxOutputBytes}`) e consome NDJSON em streaming. Não conhece `projectSlug`, `idClasseRisk`, `prompt`, `resumeSessionId` — incompatível com ADR-V2-030 e ADR-V2-032.
2. **`POST /agents/:id/execution-result`** não existe em `agents.controller.ts`. Sem endpoint inbound, agente não tem como reportar `claudeSessionId`/`exitCode`/outcome.

**Bônus descoberto:** `src/tasks/schemas/task-dados.schema.ts:37` declara `claudeSessionId?: string` em `AutomationData` (DTask.dados). Canônico (ADR-V2-032) é `DPedido.dados.claudeSessionId` via Engine `OperacaoExecucaoClaude`. Resíduo — decisão (c) trata.

Este ADR formaliza 5 decisões técnicas (a/b/c/d/e) que destravam a Sub-tarefa 4 do Task #1.

---

## Decisões

### (a) Streaming NDJSON vs request/response síncrono

**TODO** — referenciar Sub-tarefa 2.2 do `plan-automation-backend-side-task2.md`. Recomendação preliminar do plano: **A2 (request/response síncrono)** — outbound `/v1/execute` retorna apenas ACK `{accepted:true, executionId}`; resultado completo chega via callback `POST /agents/:id/execution-result`. Justificativas, trade-offs e impacto no `ExecutionRuntimeLogService` a consolidar quando a Sub-tarefa 2.2 estiver implementada.

### (b) Origem do `projectSlug`

**TODO** — referenciar Sub-tarefa 2.3. Recomendação preliminar: **B1 (derivação automática em `ProjectsService.create()`)** a partir do `nome` (slugify + sufixo numérico se colisão), persistido em `DProject.dados.slug`, unique via índice expression Postgres parcial (`WHERE excluido = false`). Sem campo novo no schema (preserva ADR-V2-001). Backfill idempotente para DProjects existentes. Decisão final + migration name + plano de backfill a consolidar na Sub-tarefa 2.3.

### (c) Remoção de `claudeSessionId` de DTask

**TODO** — referenciar Sub-tarefa 2.5. Decisão preliminar: **remover** `claudeSessionId?` de `AutomationData` em `task-dados.schema.ts`. Manter campos agregados (`executions`, `lastExecutedAt`, `riskScore`, `approved`) para queries de listagem sem join com DPedido. Consumidores migrados para ler de `DPedido.dados.claudeSessionId` quando precisarem do canônico. Grep + lista de callers afetados a consolidar na Sub-tarefa 2.5.

### (d) Validação de versão do Claude Code CLI

**TODO** — spike operacional separado (D3 do plano). CEO/orchestrator executa em VPS staging em paralelo: rodar `claude -p "echo test" --output-format json`, capturar shape exato do JSON (`session_id` vs `sessionId`), versão exata do CLI a pinar. Resultado vira nota no `plan-automation-agent-v2-client-task1.md` Sub-tarefa 4 antes do desenvolvimento iniciar. Não bloqueia esta task backend.

### (e) DClasses de DEvento para sessão (-505 / -506)

**Decisão:** Reservadas as chaves negativas **-505 `AGENT_SESSION_CREATED`** ("Sessao Claude Code criada") e **-506 `AGENT_SESSION_RESUMED`** ("Sessao Claude Code retomada") em `prisma/seeds/classes.seed.ts` na seção `DEvento — auditoria`.

**`idPai = -3` (EVENTOS):** seguindo a convenção consistente dos demais DEventos de agent já existentes:

- `-489 AUDIT_GENERIC` → `idPai = -3`
- `-492 AGENT_HEARTBEAT` → `idPai = -3`
- `-496 EXECUTION_LOG` → `idPai = -3`
- `-497..-502` (TASK_*, *_LIFECYCLE, USER_LOGIN, INVITE_LIFECYCLE) → todos `idPai = -3`

Não há (e não foi criado) agrupador intermediário para eventos de agent — todos descendem diretamente de `-3 EVENTOS`, mantendo o padrão polimórfico DEvento + idClasse. Criar um agrupador novo seria divergência do padrão consolidado.

**Validação:** chaves -505 e -506 não estavam em uso antes desta task (verificado por grep em `classes.seed.ts` e `templates/classes-base-template.ts`). Validador `validateHierarchy()` aprovou em time de import (`SEED_DRY_RUN=true npx ts-node prisma/seeds/seed-runner.ts --dry-run`). Total do seed após adição: 45 fixas + 95 específicas = 140 classes.

**Materialização (a implementar na Sub-tarefa 2.4):**

- `agent.session.created` (idClasse=-505) → quando `execution-result` chega com `claudeSessionId` presente e `resumedFrom == null`.
- `agent.session.resumed` (idClasse=-506) → quando `execution-result` chega com `claudeSessionId` presente e `resumedFrom != null`.
- Emissão via `EventProducerService` no handler do callback, **após** o Engine persistir o outcome em `DPedido.dados`.

---

## Consequências

**TODO** — preencher na Sub-tarefa 2.5 após decisões a/b/c/d consolidadas. Itens previstos:

- Quebra de contrato do `RemoteExecutionClient` (callers atuais quebram em `make build` — sem flag de compat; agente legado já desinstalado).
- `ExecutionRuntimeLogService` refatorado para consumir do callback `execution-result` (logs em batch, não linha a linha).
- DProjects existentes recebem `dados.slug` via backfill idempotente no boot.
- `DTask.dados.automation.claudeSessionId` removido — UI passa a fazer join com DPedido último.
- DEventos -505/-506 disponíveis para queries de auditoria de sessões Claude (histórico de quem retomou qual sessão e quando).
- Pilar 1 preservado: outcome em DPedido vai via `OperacaoExecucaoClaude.atualizaOutcome()` ou equivalente, sem `prisma.dPedido.update()` direto.

---

## Hooks de Validação

**TODO** — referenciar checks da Seção 8 do `plan-automation-backend-side-task2.md` após cada sub-tarefa fechar. Lista preliminar:

- [ ] `make build` passa (esqueleto: passa com 21 erros pré-existentes de PDFKit em F9 Reports — não relacionados a esta task).
- [ ] `prisma db seed` aplica -505 e -506 sem conflito (validado por dry-run; `prisma db seed` real depende de Postgres up).
- [ ] Smoke tests específicos por sub-tarefa (2.2 unit tests `RemoteExecutionClient`; 2.3 integration test slug derivation + backfill; 2.4 integration test `execution-result` + isolation + idempotência; 2.5 grep confirma `claudeSessionId` removido de `AutomationData`).
- [ ] Grep adversarial: zero `prisma.dPedido.update` no handler de `execution-result` (Pilar 1); zero vazamento de `claudeSessionPath` em response DTOs frontend.

---

## Referências

- `workspace/plans/plan-automation-backend-side-task2.md` (este plano)
- `workspace/plans/plan-automation-agent-v2-client-task1.md` (Task #1 — agente V2 client-side)
- ADR-V2-001 (zero tabela nova)
- ADR-V2-005 (Pilar 1 ativado em DPedido idClasse=-300)
- ADR-V2-006 (Risk via idClasse -301/-302/-303)
- ADR-V2-008 (DEvento substitui DNotification/DWebhook)
- ADR-V2-013 (Agent como DEntidade -156)
- ADR-V2-030 (projectSlug + CLAUDE.md global)
- ADR-V2-032 (claudeSessionId em DPedido.dados, descontinuado em DTask)

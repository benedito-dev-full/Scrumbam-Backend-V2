# ADR-V2-033 — Contrato `/v1/execute` outbound + `execution-result` inbound + DEvento sessão lifecycle

**Status:** Aceito
**Data:** 2026-05-12 (esqueleto) / 2026-05-12 (consolidado na Sub-tarefa 2.5)
**Autor:** Strategist V2 (planejado) / Implementer V2 (esqueleto + consolidação)

---

## Contexto

Sub-tarefas 2.1 → 2.5 do plano `workspace/plans/plan-automation-backend-side-task2.md`. Cadeia que destrava o Task #1 (agente V2 cliente, plano em `plan-automation-agent-v2-client-task1.md` Sub-tarefa 4).

Backend V2, no início da F13 Bloco D, tinha 2 lacunas que impediam o agente V2 client-side de funcionar de ponta a ponta:

1. **`RemoteExecutionClient`** (`src/automation/runtime/remote-execution-client.ts`) enviava payload shell-genérico (`{executable, args, cwd, env, timeoutMs, maxOutputBytes}`) e consumia NDJSON em streaming. Não conhecia `projectSlug`, `idClasseRisk`, `prompt`, `resumeSessionId` — incompatível com ADR-V2-030 e ADR-V2-032.
2. **`POST /agents/:id/execution-result`** não existia em `agents.controller.ts`. Sem endpoint inbound, agente não tinha como reportar `claudeSessionId`/`exitCode`/outcome.

**Bônus descoberto na 2.1:** `src/tasks/schemas/task-dados.schema.ts:37` declarava `claudeSessionId?: string` em `AutomationData` (DTask.dados). Canônico (ADR-V2-032) é `DPedido.dados.claude.sessionId` via Engine `OperacaoExecucaoClaude`. Resíduo — decisão (c) trata.

Este ADR formaliza 5 decisões técnicas (a/b/c/d/e), todas materializadas em código pela cadeia de sub-tarefas 2.1 → 2.5.

---

## Decisões

### (a) Streaming NDJSON vs request/response síncrono

**Decisão final:** Síncrono (request/response) — opção **A2** do plano.

**O que mudou (Sub-tarefa 2.2, commit `21323ab`):**

- `RemoteExecutionClient.execute()` agora retorna `{accepted: true, executionId: string}` após ACK HTTP do agente; **não consome stream**.
- Removidos: `consumeStream()`, `parseAgentEvent()`, `appendOutput()`, todo o pipeline NDJSON. Sem `Readable`, sem `for await (const chunk of res.body)`.
- Payload outbound V2 alinhado ao ADR-V2-030/032: `{projectSlug, idClasseRisk, prompt, resumeSessionId?, executionId, timeoutMs}`.
- Resultado real (exitCode, stdout/stderr truncados, claudeSessionId, claudeSessionPath) chega via callback **`POST /agents/:id/execution-result`** (decisão (e) + Sub-tarefa 2.4).
- `ExecutionRuntimeLogService` continua existindo para logs estruturados, mas agora consome do callback em batch — não linha a linha de stream.

**Justificativa:**

- Elimina complexidade de estado parcial (parser NDJSON quebrando no meio com timeout, conexões longas, retry stateful).
- Idempotência fica natural: callback com `executionId` repetido é detectado e rejeitado com `409 Conflict` (validado na Sub-tarefa 2.4, cenário #5).
- Permite ao agente cliente executar `claude` localmente sem manter socket aberto com backend por minutos/horas.
- Tailing real-time fica como porta aberta futura (event tipo `STREAM_CLAUDE_SESSION` em DEvento, registrada no `plan-automation-agent-v2-client-task1.md` §4).

**Hooks que validaram:** Sub-tarefa 2.2 reviewer score 8.5/10; smoke tests unitários `RemoteExecutionClient`; grep adversarial confirma zero referência a `consumeStream` no módulo `automation/runtime`.

### (b) Origem do `projectSlug`

**Decisão final:** Derivação automática em `ProjectsService.create()` — opção **B1** do plano.

**O que mudou (Sub-tarefa 2.3, commit `769f617`):**

- `ProjectsService.create()` gera `slug = slugify(nome)`; em colisão (dentro do mesmo `idEstab` não-excluído), sufixa numericamente (`-2`, `-3`, …) até unicidade.
- Slug persistido em `DProject.dados.slug` (string). **Nenhuma coluna nova no schema Prisma** — preserva ADR-V2-001.
- Unique enforcement: índice **expression parcial** em Postgres — `CREATE UNIQUE INDEX ... ON "DProject" ((dados->>'slug')) WHERE excluido = false`. Soft-delete não bloqueia reuso do slug.
- Migration: `prisma/migrations/<timestamp>_project_slug_unique_partial_index/migration.sql`, idempotente (`CREATE INDEX IF NOT EXISTS`).
- Backfill: `ProjectsService.onModuleInit()` roda uma vez por boot — varre DProjects ativos sem `dados.slug`, gera slugs, grava em batch (idempotente, log de quantos foram migrados).

**Justificativa:**

- Slug é a identidade pública/canônica que trafega entre **backend → agente → Claude Code via `~/.claude/CLAUDE.md`** (workspace switch — ADR-V2-030).
- Não trafega `DProject.chave` (vaza internals do banco); não trafega `cwd` absoluto (path injection).
- Decisão de derivação automática (não input manual em CreateProjectDto) evita: input inválido do usuário, slugs duplicados em race condition (resolvido pela transação + retry no service), curva de aprendizagem do frontend.
- Backfill no boot mantém deploys zero-touch — DBA não precisa rodar script ad-hoc.

**Hooks que validaram:** Sub-tarefa 2.3 reviewer score 8.8/10; integration tests para criação + colisão + backfill idempotente; migration aplicada em dev sem perda de dados.

### (c) Remoção de `claudeSessionId` de DTask

**Decisão final:** Removido. Canônico é `DPedido.dados.claude.sessionId`.

**O que mudou (Sub-tarefa 2.5, este commit):**

- `src/tasks/schemas/task-dados.schema.ts`: campo `claudeSessionId?: string` removido da interface `AutomationData`. JSDoc da interface atualizado com nota canônica explícita apontando para `DPedido.dados.claude.sessionId` e `OperacaoExecucaoClaude.registrarOutcome()`.
- **Consumidores migrados:** nenhum. Grep adversarial (`grep -rn "claudeSessionId" src/`) e (`grep -rn "automation.claudeSessionId\|automation\?.claudeSessionId" src/`) confirmam zero consumidores externos ao próprio schema. O campo era declarado mas nunca lido nem escrito — resíduo morto desde F13 Bloco A.
- Outros campos da `AutomationData` (`executions`, `lastExecutedAt`, `riskScore`, `approved`) permanecem para queries de listagem agregada sem necessidade de join com DPedido.

**Justificativa:**

- DTask é **estrutural** para cards Scrumban (V3 Intentions: INBOX → READY → EXECUTING → DONE). Rastrear sessão Claude Code em DTask vazaria responsabilidade do Engine de execução.
- DPedido idClasse=-300/-301/-302/-303 é a fonte transacional canônica de toda execução Claude Code (ADR-V2-005 — Pilar 1 ATIVADO). Sessão é metadado de execução, não de card.
- Manter o campo em duplicidade abriria espaço para divergência (qual fonte é a verdadeira após resume com sessionId diferente?). Eliminar resíduo é prevenção contra esse cenário.

**Hooks que validaram:** Grep confirma remoção; `make build` PASS sem erros novos; nenhum test/spec quebrado (campo nunca era exercitado).

### (d) Validação de versão do Claude Code CLI

**Decisão final:** Spike operacional separado — **não é trabalho de código backend V2**.

**Responsabilidade:** CEO/orchestrator executa em VPS staging em paralelo (opção **D3** do plano):

1. Rodar `claude -p "echo test" --output-format json` em VPS staging.
2. Capturar shape exato do JSON de saída (`session_id` vs `sessionId`, formato UUID, presença/ausência de `model`, `usage`, `cost`).
3. Pinar versão exata do Claude Code CLI no `install.sh` do agente V2 (Task #1 Sub-tarefa 1) após confirmação.

**Justificativa:**

- Implementação do parser de saída do `claude` é responsabilidade da Sub-tarefa 4 do `plan-automation-agent-v2-client-task1.md` (agente client-side), não do backend.
- Backend V2 só recebe o resultado já parseado via DTO `ExecutionResultDto` (Sub-tarefa 2.4): `claudeSessionId: string|null`, `exitCode: number`, `stdout`/`stderr` truncados.
- Pinar versão e validar shape é trabalho operacional/empírico, não decisão de design — sai do escopo de ADR de código e vira nota no plano do Task #1.

**Hooks que validaram:** N/A — decisão é meta (não bloqueia esta task backend). Registrada como dependência operacional do Task #1 Sub-tarefa 4 no plano correspondente.

### (e) DClasses de DEvento para sessão (-505 / -506)

**Decisão final:** Reservadas chaves negativas **-505 `AGENT_SESSION_CREATED`** ("Sessao Claude Code criada") e **-506 `AGENT_SESSION_RESUMED`** ("Sessao Claude Code retomada") em `prisma/seeds/classes.seed.ts` na seção `DEvento — auditoria`. `idPai = -3` (EVENTOS).

**Refinamento pragmático na Sub-tarefa 2.4 (commit `6692d09`):**

O plano original previa também DClasses dedicadas para `agent.execution.finished` e `agent.execution.failed`. Na implementação, optou-se por **reutilizar a DClasse existente `-496 EXECUTION_LOG`** para os eventos de conclusão (finished/failed), discriminando pelo `tipo` no `metaDados` do DEvento. Justificativa:

- Reduz sprawl de DClasses para diferenças semânticas pequenas (todos são eventos de log de execução).
- `-505` e `-506` ficam reservados exclusivamente para **lifecycle de sessão Claude** (created/resumed) — semântica distinta de log de execução.
- Manter alinhamento com o padrão atual de DEvento (consumidores filtram por `metaDados.tipo` já em outras seções do código).

**Materialização efetiva:**

- `agent.session.created` (idClasse=-505) → emitido pelo handler `execution-result` quando DTO chega com `claudeSessionId` presente e `resumedFrom == null`. Validado por cenário #6 do `execution-result.service.spec.ts`.
- `agent.session.resumed` (idClasse=-506) → emitido quando DTO chega com `claudeSessionId` presente e `resumedFrom != null`. Validado por cenário #7 do spec.
- `agent.session.created/resumed` **não é emitido** quando `claudeSessionId == null` (extração do shape JSON do CLI falhou no agente). Validado por cenário #9 do spec.
- `agent.execution.finished/failed` (idClasse=-496, reuso) → emitido sempre, com `metaDados.tipo` discriminando.

**Ordem de emissão (Pilar 1):**

1. Engine `OperacaoExecucaoClaude.registrarOutcome()` persiste `DPedido.dados.claude.sessionId/exitCode/stdoutTruncated/stderrTruncated/exitedAt` (Pilar 1 ATIVADO — sem `prisma.dPedido.update` direto).
2. Após o Engine retornar com sucesso, `EventProducerService` emite os DEventos (-505/-506 lifecycle + -496 execution log).
3. Falha do Engine → callback retorna 500, sem emitir DEvento (consistência transacional).

**Validação:** chaves -505 e -506 não estavam em uso antes desta task (verificado por grep em `classes.seed.ts` e `templates/classes-base-template.ts`). Total do seed após adição: 45 fixas + 95 específicas = 140 classes (validação via `SEED_DRY_RUN=true npx ts-node prisma/seeds/seed-runner.ts --dry-run`).

---

## Consequências

**Quebra de contrato (intencional):**

- `RemoteExecutionClient.execute()` mudou assinatura e shape de retorno. Agente legado (V1, baseado em shell-out NDJSON) **não é mais compatível** — desinstalado antes desta task; sem flag de compat.
- DTOs do `automation` module agora exigem `projectSlug`/`idClasseRisk`/`prompt` no outbound — quem chamava o método antigo quebra no `make build`.

**Destrava downstream:**

- **Task #1 Sub-tarefa 4 (agente V2 RUN_CLAUDE_CODE handler) destravado** — backend V2 está pronto para receber sessões Claude Code via callback. Próxima ação é o agente V2 enviar `execution-result` real (não mock).
- `ExecutionRuntimeLogService` simplificado: consome callback em batch, não mais stream NDJSON linha a linha.

**Estrutura de dados:**

- DProjects existentes recebem `dados.slug` via backfill idempotente no boot (Sub-tarefa 2.3) — DBA não roda script manual.
- `DTask.dados.automation.claudeSessionId` **removido** (Sub-tarefa 2.5). UI que precisar de sessão Claude da última execução de uma task faz join com DPedido (idClasse -300..-303, filtro por `dados.taskId == task.chave`, order by `criadoEm DESC LIMIT 1`).
- DEventos `-505`/`-506` disponíveis para queries de auditoria de sessões Claude (histórico de quem retomou qual sessão e quando, com `metaDados.claudeSessionId` + `metaDados.resumedFrom`).

**Segurança e isolamento:**

- `claudeSessionPath` é **INTERNAL** (path em disco do agente). Não é exposto em response DTO frontend — apenas persistido em `DPedido.dados.claude.sessionPath` para auditoria backend. Mitiga Risco #7 do plano (path traversal/info disclosure).
- Isolation por `agentId` em **dupla camada**: (1) guard `AgentApiKeyGuard` valida que `apiKey` resolve para `:id` da URL; (2) handler valida que `DPedido.dados.agentId == agentId` antes de chamar Engine. Mitiga Risco #6 (cross-agent execution-result injection).

**Pilar 1 ATIVADO:**

- Outcome em DPedido vai via `OperacaoExecucaoClaude.registrarOutcome()` — método Engine. Zero `prisma.dPedido.update()` direto no módulo `automation/agents/`. Grep adversarial validou.

---

## Hooks de Validação

- [x] `make build` PASS no escopo das 5 sub-tarefas (erros pré-existentes de PDFKit em F9 Reports não relacionados a esta task).
- [x] `prisma db seed` aplica -505 e -506 sem conflito (validado por dry-run; aplicado em dev).
- [x] **Smoke tests por sub-tarefa:**
  - **2.1:** seed valida -505/-506; ADR esqueleto criado com decisão (e) preenchida.
  - **2.2:** unit tests `RemoteExecutionClient` cobrem payload V2 + ACK síncrono + erro de rede.
  - **2.3:** integration test slug derivation + colisão (sufixo numérico) + backfill idempotente.
  - **2.4:** integration test `execution-result` cobrindo cenários #1-#9 (sucesso, falha, mismatch agentId, claudeSessionId null, idempotência por executionId, session.created, session.resumed, execution.finished/failed reuso de -496, session.created não emitido quando sessionId null).
  - **2.5:** grep confirma `claudeSessionId` removido de `AutomationData` (zero consumidores); `make build` continua PASS; nenhum spec quebrado.
- [x] **Grep adversarial:**
  - Zero `prisma.dPedido.update` no handler de `execution-result` (Pilar 1 ATIVADO).
  - Zero referência a `consumeStream`/`parseAgentEvent` em `src/automation/runtime/` (decisão (a) materializada).
  - Zero vazamento de `claudeSessionPath` em response DTOs frontend (`grep -rn "claudeSessionPath" src/` retorna apenas backend internal).
  - Zero `claudeSessionId` em `DTask.dados.automation` (decisão (c) materializada).
- [x] **Golden tests F13 (Risk Gate) continuam verdes** após mudanças no módulo `automation/`.
- [x] **Idempotência testada** — cenário #5 da Sub-tarefa 2.4 valida `409 Conflict` em callback repetido com mesmo `executionId`.

---

## Referências

- `workspace/plans/plan-automation-backend-side-task2.md` (este plano)
- `workspace/plans/plan-automation-agent-v2-client-task1.md` (Task #1 — agente V2 client-side, destravado)
- **Commits:**
  - `d7fbc63` — Sub-tarefa 2.1: DClasses -505/-506 + ADR-V2-033 esqueleto
  - `21323ab` — Sub-tarefa 2.2: RemoteExecutionClient payload V2 + ACK síncrono
  - `769f617` — Sub-tarefa 2.3: ProjectsService slug derivation + migration + backfill
  - `6692d09` — Sub-tarefa 2.4: endpoint execution-result + Engine.registrarOutcome (Pilar 1)
  - Sub-tarefa 2.5 (esta): `claudeSessionId` removido de DTask + ADR consolidado
- **ADRs vinculados:**
  - ADR-V2-001 (zero tabela nova — preservado via `dados.slug` Json)
  - ADR-V2-005 (Pilar 1 ATIVADO em DPedido idClasse=-300..-303)
  - ADR-V2-006 (Risk via idClasse -301/-302/-303)
  - ADR-V2-008 (DEvento substitui DNotification/DWebhook)
  - ADR-V2-013 (Agent como DEntidade -156)
  - ADR-V2-030 (projectSlug + CLAUDE.md global — workspace switch)
  - ADR-V2-032 (claudeSessionId canônico em DPedido.dados, descontinuado em DTask)

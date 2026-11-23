# Implementation: Task 2 — Execuções presas em RUNNING + falhas evitáveis por concorrência

**Implementer:** Implementer Agent V2
**Data:** 2026-11-23
**Módulo:** executions (toca `engine`, `automation`, `mcp`, `common`, `agent/`)
**Fase V2:** F13 sobre o Engine de F6
**Plano:** `workspace/plans/plan-executions-execucao-presa-task2.md` (rev. 2, decisões CEO P1–P4 na §0)
**ADR:** `docs/decisions/ADR-V2-082-ciclo-de-vida-terminal-execucoes.md` (proposto — Documenter formaliza)

---

## 🧭 Visão geral

```
            ┌──────── deadline = startedAt + dados.timeoutSec + 300s ────────┐
 QUEUED ──► RUNNING ──(callback, CAS)──► SUCCESS/FAILED  source='agent', baixado=true
   ▲  409     │
   └─ retry ──┘──(cron 1/min: deadline OU restart via heartbeat)──► FAILED source='system'
     30s..300s                                     baixado=true, claude.finishedAt, exitCode=-1,
     (10x → PROJECT_BUSY_EXHAUSTED)                task EXECUTING→FAILED, execution.failed{reason}
                                    callback tardio ──► substitui o sintético 1× (supersedes)
```

## O Que Foi Feito

### Arquivos Criados

| Arquivo | Conteúdo |
|---|---|
| `src/executions/constants/execution-lifecycle.const.ts` | Constantes (1800/30/3600/300/10/30s/300s/100), `EXECUTION_FAILURE_REASONS`, `NON_TERMINAL_STATUS_CODES`, `resolveExecutionTimeoutSec`, `computeBusyDelayMs`, `resolveExecutionLifecycleConfig` (overrides env), `toActiveExecutionStatus` |
| `src/executions/execution-running-sweeper.service.ts` | `@Cron(EVERY_MINUTE) sweepStaleRunning()` — Engine `encerrarVencidas` → task EXECUTING→FAILED (leitura batch) → `recordSystem` (-496) → `execution.failed{reason}`; guarda de reentrância |
| `src/automation/runtime/remote-agent-http.error.ts` | `RemoteAgentHttpError extends ServiceUnavailableException` (`httpStatus`, `errorCode`, `isProjectBusy()`) |
| `prisma/scripts/backfill-execution-baixado.ts` | Backfill data-only: dry-run padrão, `--apply`, `--close-stale-running`, `--release-tasks`, `--revert <snapshot>`, `--margin-sec`, `--default-timeout-sec`. **NÃO executado** |
| `docs/decisions/ADR-V2-082-ciclo-de-vida-terminal-execucoes.md` | ADR (rascunho para o Documenter) |
| `src/executions/__tests__/execution-running-sweeper.service.spec.ts` | 8 testes |
| `src/executions/__tests__/execution-outcome-race.spec.ts` | 7 testes (fake DB aplicando as CAS; AgentsService + Engine + Sweeper reais) |
| `src/executions/__tests__/execution-lifecycle.const.spec.ts` | 10 testes |
| `src/executions/__tests__/execution-queue.service.spec.ts` | 3 testes |
| `src/engine/lib/operacao/__tests__/OperacaoExecucaoClaude.desfecho.spec.ts` | 5 testes |
| `agent/__tests__/runner.spec.ts` | 4 testes (SIGTERM ignorado → SIGKILL após grace) |

### Arquivos Modificados

| Arquivo | Mudança |
|---|---|
| `src/engine/lib/operacao/OperacaoExecucaoClaude.ts` | `registrarOutcome` com CAS (`UPDATE … RETURNING`, aceita sem outcome OU `source='system'`, `supersedes` calculado NO SQL, `baixado=true`), retorna `{applied, persistedAt, superseded?}`, DVFS 7 só se `applied`. Novos: `encerrarPorFalhaSistemica`, `devolverParaFila`, `static encerrarVencidas`, `static sqlDadosFalhaSistemica` (fonte única do formato). **Zona Task 1 intocada** (diff começa na linha 561; `calcula`/guardas 136-266 sem alteração; `_atualizarPedidoCompleto` intacto) |
| `src/engine/lib/interfaces/IExecucaoData.ts` | + `timeoutSec`, `dispatch`, `runtime`, `audit.outcome/errorCode/resumedFrom`, `IExecucaoOutcome`. Bloco `risk` (65-91) intocado |
| `src/executions/processors/execution-run.processor.ts` | Nova ordem (task→EXECUTING só após ACK e se ainda -518); 409 PROJECT_BUSY → `devolverParaFila` + `enqueueRetry`; esgotado → `PROJECT_BUSY_EXHAUSTED`; `markRunning` + `outcome IS NULL` + `NOT EXISTS` outra RUNNING da task; CAS perdida p/ duplicata → `DUPLICATE_TASK_EXECUTION`; `failExecution` via Engine + task EXECUTING→FAILED + `execution.failed{reason,errorCode,taskId}`; removidos `finishExecution`/`emitFinished` raw; construtor + `ExecutionQueueService` |
| `src/executions/executions.service.ts` | `timeoutSec` gravado na criação; placeholder PROMPT 1.800.000 ms; `assertNoActiveExecutionForTask` antes de `resolveCommandAndPrompt`; `EXECUTION_IN_PROGRESS_CODE` + `parseExecutionInProgressConflict` exportados. JSDoc ADR-V2-081 de `resolveCommandAndPrompt` preservado |
| `src/executions/queues/execution-queue.service.ts` / `in-memory-queue.service.ts` | `busyAttempt?`, `enqueueRetry` (`jobId=<id>-busy-<n>`, `delay`), `buildBusyRetryJobId`; in-memory no-op |
| `src/automation/runtime/remote-execution-client.ts` | `!response.ok` → lê body e lança `RemoteAgentHttpError` |
| `src/automation/agents/agents.service.ts` | Fast-path só p/ outcome real; decisão por `applied`; supersede → FAILED→DONE só se task ainda FAILED; payload `supersedes`; `persistedAt` do Engine |
| `src/executions/approval-flow.service.ts` / `approval-flow-sweeper.service.ts` | `baixado=true` no mesmo UPDATE de REJECTED / EXPIRED |
| `src/executions/executions.module.ts` | registra `ExecutionRunningSweeperService` |
| `src/executions/executions.controller.ts` | Swagger do 409 `EXECUTION_IN_PROGRESS` |
| `src/mcp/tools/execute-task.tool.ts` | 409 → `INVALID_PARAMS {reason:'execution_in_progress', executionId, status}` |
| `src/common/tool-capabilities/capabilities/executions/execute-task.capability.ts` | + `assertTaskNotLockedByOther` (McpToolError→CapabilityError) + mapeamento do 409 |
| `src/common/filters/http-exception.filter.ts` | repassa `details` (apenas objeto) — **desvio, ver abaixo** |
| `src/tasks/tasks.service.ts`, `src/tasks/dto/task-response.dto.ts` | **só JSDoc** |
| `agent/src/claude-code/runner.ts` | SIGKILL após `KILL_GRACE_MS=15000`; `killGraceMs` injetável; `timedOut` cobre SIGKILL |
| `agent/package.json` + lock | 0.1.0 → 0.1.1 |
| Specs com drift corrigido | `execution-run.processor.spec.ts` (reescrito, 18 testes), `executions.service.unit.spec.ts` (+8), `approval-flow.service.unit.spec.ts` (+asserts de baixa), `execution-result.service.spec.ts` (+4), `agents-heartbeat/install/projects.spec.ts` (8º arg), `execute-task.integration.spec.ts` (2 casts) |
| Specs ampliados | `remote-execution-client.spec.ts` (+2), `execute-task.tool.spec.ts` (+2), `execute-task.capability.spec.ts` (+2), `http-exception.filter.spec.ts` (+2) |

## 3 Pilares

### Pilar 1: Engine/Operação
- Zero INSERT novo. Todo desfecho terminal (outcome + statusCode final + `baixado=true`) passa pelo Engine.
- `failExecution` do processor deixou de usar `prisma.dPedido.update` raw → **redução** do desvio.
- Desvio mantido e sinalizado: `markRunning` (raw no processor) — só recebeu as guardas. Follow-up.
- DVFS 7 só quando a CAS aplica.

### Pilar 2: Endpoints Genéricos
- Nenhum endpoint novo. Contrato aditivo: 409 em `POST /projects/:id/execute`. Contagem de tools MCP inalterada (golden verde).

### Pilar 3: Seed de Classes
- Não se aplica. Zero DClasse, zero tabela, zero migration. Reuso -514..-522 e -496.

## Testes Realizados

### Compilação

| Check | Resultado |
|---|---|
| `make build` | ✅ exit 0 |
| `npx tsc --noEmit` | **78 → 67** erros (todos em specs pré-existentes fora do escopo: `tasks.service.spec` 39, `tenant-isolation.adversarial` 12, telegram 13, update-timer 1, notification.consumer 1, ttl-cache 1). **0 erros em código de produção e 0 nas suítes tocadas** |
| ESLint arquivos tocados (37) | ✅ 0 errors, 25 warnings (todos `no-explicit-any` pré-existentes) |
| `agent`: `npm test` | ✅ 20 suites / **222 testes** |
| `agent`: `npm run build` / `lint` / `typecheck` | ✅ / ✅ / ✅ |
| Backfill (tsc isolado) | ✅ (só os erros `PDFKit` pré-existentes, artefato do tsconfig isolado) |

### Jest backend (`src/executions src/automation src/engine src/mcp/__tests__/execute-task src/common/tool-capabilities/capabilities/executions src/common/filters src/mcp/__tests__/golden`)

```
Test Suites: 2 failed, 42 passed, 44 total
Tests:       3 failed, 612 passed, 615 total
```

As 3 falhas são **pré-existentes e fora do escopo**:
- `execute-task.integration.spec.ts` (2): esperam que `NotFound/Forbidden` propaguem crus do controller MCP; o commit `ad7590b` passou a traduzi-los em erro JSON-RPC. A suíte não compilava (TS2352) e por isso nunca rodou desde então — consertei só a compilação.
- `provision.service.spec.ts` (1): `baseDir`/`depth` default do PROVISION_PROJECT (`/home/dev-benedito/projetos`) — caminho não tocado.

Regressão Task 1 sem diff: `risk-gate-adversarial` ✅, `risk-gate-natural-language` ✅, `OperacaoExecucaoClaude.unit` ✅, `executions.service.prompt-mode` (11) ✅ — arquivo não modificado.

### Testes de mutação (correção desligada → teste falha)

| Mutação | Resultado |
|---|---|
| fast-path do callback ignora `source='system'` | 3 falham (race) |
| remove trava anti-duplicata | 5 falham |
| 409 PROJECT_BUSY tratado como falha | 5 falham |
| `failExecution` não libera task | 1 falha |
| reject sem `baixado=true` | 1 falha |
| agente sem SIGKILL | 2 falham |

Limite: a semântica exata do SQL das CAS só é provada contra Postgres real (testes usam mock / fake DB que reproduz as regras). Smoke da Fase 11 cobre.

### Performance
- Sweeper: 1 `UPDATE … RETURNING` por ciclo (lote ≤100) + 1 `findMany` de tasks + updates por task via service.
- Guard anti-duplicata: 1 `findFirst`. Callback: CAS única (antes: read + update incondicional).
- Processor: +1 leitura (releitura pós-ACK).

## Decisões Tomadas / Desvios do plano

1. **409 com `code` + `details` (não campos top-level).** O `HttpExceptionFilter` global descarta tudo fora de `statusCode/code/message/error` — com o shape do plano o `executionId` nunca chegaria ao frontend. Ajuste mínimo: o filtro repassa `details` quando é objeto (demais extras continuam descartados). Shape final abaixo.
2. **`RemoteAgentHttpError.httpStatus`** (não `status`): `status` é privado em `HttpException`.
3. **Leitura batch de status da task no sweeper via `prisma.dTask.findMany`** (`dados.v3.state`), em vez de método novo no `TasksService` (plano limita `tasks.service.ts` a JSDoc).
4. **Guard anti-duplicata filtra status NO banco** (`OR` por statusCode) além do filtro em memória — evita que um zumbi mais recente esconda uma ativa mais antiga.
5. **`failExecution` usa `expected:'ANY_NON_TERMINAL'`** (aceita statusCode ausente, legado) — falhas ocorrem antes do markRunning (-514/-516) ou depois (-518).
6. **`errorCode` do `execution.failed`:** `DISPATCH_FAILED` carrega o detalhe (ex.: `TUNNEL_UNAVAILABLE`); demais motivos usam o próprio reason.
7. **Timestamps sintéticos em ISO UTC via `to_char(...)`** — mesmo formato do `toISOString()` (o `NOW()::text` do markRunning ficou como está; só o sweeper o lê, via cast `timestamptz`).
8. **`--release-tasks`** sobe `NestFactory.createApplicationContext(AppModule)` sob demanda — isso inicializa os crons por alguns segundos durante o script. Aceitável para script único; registrado.
9. Corrigi também o drift das 3 suítes de `agents` (heartbeat/install/projects) e os casts da integração `execute-task` — triviais, reduziram o tsc.

## Contrato para o frontend (F-1 / F-3 — esteira do frontend)

`POST /api/v1/projects/:id/execute` com `{ taskId }` quando a task já tem execução QUEUED/AWAITING_APPROVAL/APPROVED/RUNNING:

```json
HTTP 409
{
  "statusCode": 409,
  "code": "EXECUTION_IN_PROGRESS",
  "message": "Task 55 já tem uma execução em andamento (777).",
  "error": "Conflict",
  "details": {
    "reason": "execution_in_progress",
    "executionId": "777",
    "status": "running"            // 'running' | 'queued' | 'awaiting_approval'
  },
  "correlationId": "…", "timestamp": "…", "path": "/api/v1/projects/20/execute"
}
```

- Detectar por `code === 'EXECUTION_IN_PROGRESS'` (ou `details.reason === 'execution_in_progress'`).
- Obter a execução existente: `GET /api/v1/executions/{details.executionId}` → `adoptExecution` (retoma polling). Toast informativo.
- Outros 409 do mesmo endpoint (Idempotency-Key) **não** têm esse `code`.
- FAILED sintético sempre traz `dados.claude.finishedAt` + `dados.claude.exitCode=-1` (o `deriveStatus` encerra o polling). Motivo legível (F-2, opcional): `dados.claude.stderr` / `dados.audit.outcome.reason` ∈ `TIMEOUT_NO_CALLBACK | AGENT_RESTARTED | PROJECT_BUSY_EXHAUSTED | DUPLICATE_TASK_EXECUTION | DISPATCH_FAILED | BACKFILL_STALE`.
- F-3: `ActiveExecutionDto.status` é derivado de `approval.status` (`queued` já é usado); terminais somem (`activeExecution=null`).
- MCP: `INVALID_PARAMS` (-32602) `data:{reason:'execution_in_progress', executionId, status}`. Nexus: `CapabilityError INVALID_INPUT` com o mesmo `data`.

## Pendências

- ⬜ Smoke da Fase 11 na VPS (restart do agente, 409 real, duplicata, timeout curto + callback manual).
- ⬜ Rodar o backfill (dry-run → apply) — CEO/ops, com `pg_dump` antes. Implementer não rodou contra banco algum.
- ⬜ Documenter: formalizar ADR-V2-082 e atualizar runbook (`docs/automation-security-runbook.md`) com a sequência do deploy conjunto.
- ⬜ Frontend F-1 (MUST no mesmo release) e F-3.
- ⬜ Pré-existentes: 2 testes desatualizados em `execute-task.integration.spec.ts` (pós-`ad7590b`), 1 em `provision.service.spec.ts`, 67 erros tsc em specs fora do escopo. O hook `validate-implementation.sh` exige `tsc` 0 erros → seguirá acusando os 67 pré-existentes.
- 📋 Follow-up: mover `markRunning` para o Engine; integração com Postgres real para as CAS.

**Pronto para Review!**

---

# Ciclo 2 — correções M1–M3 + LOWs do review (8.6/10, APPROVED com ressalvas)

**Review:** `workspace/reviews/review-executions-execucao-presa-task2.md`

## O que mudou

| Item | Correção | Arquivos |
|---|---|---|
| **M1** write skew no anti-duplicata | `markRunning` agora roda em `$transaction` que primeiro adquire `pg_advisory_xact_lock(hashtext('exec-task:<taskId>'))`; sob READ COMMITTED cada statement tira snapshot novo, então a 2ª transação (após esperar o lock) enxerga o RUNNING já commitado e o `NOT EXISTS` falha → `DUPLICATE_TASK_EXECUTION`. **Mesmo lock** em `ExecutionsService.execute` (`withTaskLock`) envolvendo trava anti-duplicata + criação (Engine) + enqueue: o 2º request simultâneo da mesma task só passa pela trava depois que a execução do 1º foi commitada → 409. Sem taskId: sem lock | `execution-run.processor.ts`, `executions.service.ts`, `execution-lifecycle.const.ts` (`executionTaskLockKey`) |
| **M2** callback tardio × liberação da task | (a) falha sintética move a task com `movedBy = system:execution-<id>` (processor e sweeper); (b) sweeper **relê** `audit.outcome` antes de liberar (só libera se ainda `source='system'`) e **depois** de liberar (se o callback real gravou sucesso no meio, compensa para DONE); (c) `transitionLinkedTask` no supersede+sucesso promove a DONE se a task está **EXECUTING** ou **FAILED com o marcador desta execução** | `execution-running-sweeper.service.ts`, `agents.service.ts`, `execution-run.processor.ts` |
| **M3** QUEUED/APPROVED órfãs → 409 eterno | `encerrarVencidas` ganhou ramo -514/-516: `GREATEST(atualizadoEm, dispatch.nextAttemptAt) + EXECUTION_QUEUE_STALE_SEC (900s, env) < NOW()` → FAILED `QUEUE_STALE`, mesmas garantias (CAS, baixado, finishedAt, exitCode=-1, source='system', eventos só do RETURNING). O UPDATE re-confere o `statusCode` lido no SELECT (`alvo.status_code`) — `markRunning` concorrente que venceu tira a linha do lote; e o `markRunning` exige `outcome IS NULL`, então não ressuscita uma QUEUE_STALE | `OperacaoExecucaoClaude.ts` (`encerrarVencidas`), `execution-lifecycle.const.ts`, sweeper |
| **L1** | `execution.started` só após o ACK (retries de 409 não re-emitem) | processor |
| **L2** | `registrarOutcome` grava `runtime.finishedAt` real (substitui o do sintético) | Engine (zona de `registrarOutcome`, fora da Task 1) |
| **L3** | `errorCode` do `execution.failed`/`audit.errorCode` sempre canônico (= reason); detalhe livre só em `claude.stderr`/log | processor |
| **L4** | `.gitignore`: `backfill-execution-baixado.*.json`; snapshot gravado com `mode 0o600` + aviso de descarte | `.gitignore`, backfill |
| **L5** | `HttpExceptionFilter` repassa `details` só para `code` na whitelist `DETAILS_PASSTHROUGH_CODES` (hoje só `EXECUTION_IN_PROGRESS`) | filtro |
| L6 | Não alterado (SIGKILL só no PID) — follow-up se netos segurarem stdio | — |
| **L7** | Resolvido pelo marcador do M2 (FAILED de outra execução tem outro marcador) | — |

### Critério de promoção FAILED → DONE (M2) — justificativa

O sistema não tem coluna "quem marcou FAILED", mas `DTask.dados.v3.movedBy` é gravado em TODA transição por `TasksService.updateStatus` (fonte única). Gravar `system:execution-<id>` quando o SISTEMA falha a task dá uma **prova de origem**: qualquer movimentação posterior (humano, outra execução, cascata) sobrescreve o marcador. Logo o callback tardio só promove quando (i) a task está EXECUTING (ninguém liberou ainda) ou (ii) o FAILED atual foi gravado por ESTA execução. Nunca sobrescreve FAILED manual nem FAILED de outra execução (L7). Intercalação sweeper×callback converge sempre para DONE (pré + pós-checagem).

### Trade-off do lock no `execute` (registrado)
`withTaskLock` segura 1 conexão do pool enquanto o Engine usa outras (prompt + Risk Gate + INSERT, `timeout` 60s / `maxWait` 10s). Só para requests com `taskId`; muitas requisições simultâneas da MESMA task fazem fila (comportamento desejado). Pool muito pequeno (1 conexão) entraria em espera — não é o caso do pool padrão do Prisma.

## Testes do Ciclo 2

Novos/alterados: processor (+3: lock antes do UPDATE na mesma tx, sem lock sem task, 409 não emite started; asserts de marcador e errorCode canônico), executions.service (+3: lock antes da trava, COMMAND sem lock, **2 requests concorrentes → 1 cria + 1 recebe 409** com lock fake em fila), sweeper (+4: pré-checagem, pós-checagem/compensação, falha real sem compensação, QUEUE_STALE; SQL do M3), race (+3 ponta a ponta: callback entre UPDATE e liberação → DONE; FAILED manual não promovido; FAILED de outra execução não promovido), execution-result (+4: EXECUTING promove; 3 casos não promovem), Engine desfecho (+1 L2; M3 no SQL), filtro (+1 L5). Mocks de `$transaction` em `executions.service.unit` e `prompt-mode` ganharam `tx.$executeRaw` (necessário pelo lock — nenhum teste da Task 1 alterado em asserção).

### Mutação (correção desligada → teste falha)

| Mutação | Resultado |
|---|---|
| M1 `markRunning` sem lock | 1 falha |
| M1 `execute` sem lock (fn fora da tx) | 3 falhas (inclui a concorrência) |
| M2 sweeper sem pré-checagem | 1 falha |
| M2 sweeper sem pós-checagem | 1 falha |
| M2 não promove EXECUTING | 2 falhas |
| L7 promove FAILED sem marcador | 5 falhas |
| L5 sem whitelist | 1 falha |

Limite mantido: a semântica SQL (incluindo o ramo M3 e o advisory lock real) só é provada contra Postgres; os testes validam o SQL gerado + a política em fake DB.

## Resultados reais (Ciclo 2)

| Check | Resultado |
|---|---|
| `make build` | ✅ exit 0 |
| `tsc --noEmit` | **67** (mesmos arquivos do baseline; **0 em arquivos tocados**) |
| ESLint tocados | ✅ 0 errors, 25 warnings (pré-existentes) |
| Jest relevante (paralelo) | 630/634 — 3 pré-existentes (provision 1, execute-task.integration 2) + 1 teste de tempo <50ms da Task 1 (`risk-gate-natural-language`), flaky com workers paralelos |
| `jest src/engine/dvfs --runInBand` | ✅ 242/242 |
| `agent`: test / build / lint | ✅ 222/222 / ✅ / ✅ |
| `git check-ignore` snapshot | ✅ `.gitignore:52` |

## Contrato frontend — delta do Ciclo 2
- `audit.outcome.reason` ganha `QUEUE_STALE` ("a execução não saiu da fila").
- `execution.failed.errorCode` agora é sempre o motivo canônico; o detalhe técnico fica em `dados.claude.stderr`.
- 409 `EXECUTION_IN_PROGRESS` inalterado.
- `DTask.dados.v3.movedBy` pode valer `system:execution-<id>` (falha marcada pelo sistema) — não exibir como nome de usuário.

---

# Ciclo 3 — outcome no DTO

**Motivo:** o Reviewer do frontend apontou que o motivo canônico não chegava ao front: o DTO só expunha `claude.stderr` (texto livre) e o túnel indisponível gravava `probe.error` (`ECONNREFUSED`/`TUNNEL_TIMEOUT`, não canônico).

## Mudanças

| Arquivo | Mudança |
|---|---|
| `src/executions/constants/execution-lifecycle.const.ts` | + `TUNNEL_UNAVAILABLE` em `EXECUTION_FAILURE_REASONS`; `EXECUTION_FAILURE_REASON_CODES` (lista fechada) e `isExecutionFailureReason` |
| `src/executions/dto/execution-response.dto.ts` | `ExecutionOutcomeDto` + campo `outcome` (sempre presente) + `toOutcome()` (whitelist) no `serializeExecution` |
| `src/executions/processors/execution-run.processor.ts` | probe indisponível → `reason=TUNNEL_UNAVAILABLE` (detalhe só no stderr); `failExecution(reason: ExecutionFailureReason)` tipado — impossível passar código fora da lista |
| `src/engine/lib/operacao/OperacaoExecucaoClaude.ts` | motivos do sweeper importados das constantes (sem literais); zona da Task 1 intocada |
| `prisma/scripts/backfill-execution-baixado.ts` | `BACKFILL_STALE` importado das constantes |
| `docs/decisions/ADR-V2-082-…md` | seção "Ciclo 3 — outcome no DTO" com o formato e a lista final |

## Formato exato do campo

```ts
outcome: {
  reason: 'TIMEOUT_NO_CALLBACK' | 'AGENT_RESTARTED' | 'QUEUE_STALE' | 'TUNNEL_UNAVAILABLE'
        | 'DISPATCH_FAILED' | 'PROJECT_BUSY_EXHAUSTED' | 'DUPLICATE_TASK_EXECUTION'
        | 'BACKFILL_STALE' | null;          // só preenchido com source='system'
  source: 'agent' | 'system' | null;        // null = sem desfecho ainda
}
```

Sem desfecho → `{reason:null, source:null}`; falha do sistema → `{reason:<código>, source:'system'}`; desfecho real do agente (inclusive supersede e legado sem source) → `{reason:null, source:'agent'}`. Nada além de `reason`/`source` é exposto (sem `supersedes`, `recordedAt`, `errorCode`, stderr extra).

## Testes

- `src/executions/dto/__tests__/execution-response.outcome.spec.ts` (novo, 20): **teste de contrato** da lista exata de 8 códigos; nulls sem desfecho; cada código → `{code,'system'}`; texto livre/`ECONNREFUSED` → `reason:null`; agent → null; legado → agent; `Object.keys(outcome)` só `reason`/`source`.
- Processor (+9, parametrizado): projeto/agente não encontrado, túnel indisponível, contrato incompleto, slug ausente, ACK timeout, HTTP 500, 409 esgotado, falha ao re-enfileirar, duplicata → cada um grava exatamente 1 código canônico e emite `execution.failed{reason,errorCode}` com ele.
- Race (+1): `serializeExecution(...).outcome` ponta a ponta: `null/null` → `TIMEOUT_NO_CALLBACK/system` (sweeper) → `null/agent` (supersede).
- Mutação: túnel volta a `DISPATCH_FAILED` → 2 falham; DTO sem whitelist de reason → 1 falha; DTO não lê o outcome → 3 falham.

## Resultados reais

| Check | Resultado |
|---|---|
| `make build` | ✅ exit 0 |
| `tsc --noEmit` | 67 (baseline), **0 em arquivos tocados**; backfill (tsc isolado) ✅ |
| ESLint (8 tocados) | ✅ 0 errors, 0 warnings |
| Jest relevante | 655/659 — mesmas 3 pré-existentes (provision 1, execute-task.integration 2) + 1 teste de tempo da Task 1 instável em paralelo |
| `jest src/engine/dvfs --runInBand` | ✅ 242/242 |
| `agent/` | sem mudanças neste ciclo |

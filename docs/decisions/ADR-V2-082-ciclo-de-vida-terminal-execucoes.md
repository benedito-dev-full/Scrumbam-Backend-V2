# ADR-V2-082: Ciclo de vida terminal de execuções — deadline persistido, sentinela de desfecho com `source`, CAS sweeper×callback, baixa canônica e retry de PROJECT_BUSY

**Status:** Aceito (Reviewer APPROVED 9.0/10 em 2026-11-23 — ciclo 1: 8.6; ciclo 2: 8.9 com M1-M3 corrigidos; ciclo 3: 9.0 com outcome no DTO; gate ≥ 8.5).
**Data:** 2026-11-23
**Decisores:** Strategist Agent V2 (plano `workspace/plans/plan-executions-execucao-presa-task2.md`), Implementer Agent V2, CEO (decisões P1–P4)
**Tags:** #V2 #fase-F13 #F6 #automation #engine #concorrencia
**Relacionados:** ADR-V2-005, ADR-V2-006, ADR-V2-008, ADR-V2-033, ADR-V2-036, ADR-V2-073, ADR-V2-079, ADR-V2-081 (vizinho — mesmo Engine, zonas disjuntas)

---

## Contexto e Problema

Execuções Claude Code (DPedido -301/-302/-303) ficavam em `statusCode=-518 RUNNING` para sempre quando o
callback `POST /agents/:id/execution-result` não chegava (agente reiniciou, retries de ~65s esgotados com
túnel caído, `claude` travado). A DTask vinculada ficava EXECUTING (somente leitura na UI). Além disso:

- `baixado` **nunca** era gravado em execuções → toda execução terminada virava lock "zumbi"
  (`activeExecution != null`); REJECTED/EXPIRED apareciam como `awaiting_approval`.
- 409 `PROJECT_BUSY` do agente virava FAILED imediato (status/errorCode perdidos no client).
- Nada impedia duas execuções da mesma task (REST/MCP/Nexus).
- Timeout em três lugares incoerentes (placeholder 600.000 ms × processor 1800 s × agente 30 min).
- Idempotência do callback era read-then-write (DVFS 7 / pr-auto-open podia rodar 2×).
- `markRunning` podia sobrescrever um desfecho com RUNNING num re-enfileiramento.
- O agente só mandava SIGTERM no timeout → `claude` que ignora SIGTERM segurava o mutex do slug para sempre.

## Alternativas Consideradas

| # | Abordagem | Veredito |
|---|-----------|----------|
| **A+** | Cron sweeper (1/min) de RUNNING vencidas + detecção precoce de restart via heartbeat (`lastSeen − uptime`) | **Escolhida** — simples, sem rede, cobre todos os cenários, padrão do `ApprovalFlowSweeperService` |
| B | Sweeper consulta o agente (`GET /v1/executions/:id`) | Rejeitada — agente sem rota de status e com estado em memória (perdido no restart, o caso principal); exige mudança de protocolo |
| C | Watchdog BullMQ (job atrasado por execução) | Rejeitada — depende de Redis, jobs se perdem em flush, não pega execuções já presas |

## Decisão

1. **Timeout fonte única:** `DPedido.dados.timeoutSec` gravado UMA vez na criação
   (`clamp(round(command.timeoutMs/1000), 30, 3600)`; modo PROMPT = 1800 s, placeholder `timeoutMs`=1.800.000).
   Lido pelo processor (→ agente) e pelo sweeper. Legado sem o campo → 1800 s.
2. **Sentinela de desfecho com `source`:** `dados.audit.outcome = {success, recordedAt, source:'agent'|'system', reason?, supersedes?}`.
3. **Desfecho terminal só pelo Engine** (`OperacaoExecucaoClaude`), sempre com **CAS + `baixado=true`** no mesmo UPDATE:
   - `registrarOutcome` (callback): aplica se não há outcome **ou** se o outcome é `source='system'`; devolve `{applied, superseded}`; DVFS 7 só roda se `applied`.
   - `encerrarPorFalhaSistemica` (processor): -520, `claude.exitCode=-1`, `claude.finishedAt`, `runtime.finishedAt`, outcome `source='system'`.
   - `static encerrarVencidas` (sweeper): `UPDATE … FROM (SELECT … LIMIT n FOR UPDATE SKIP LOCKED) … RETURNING` — seguro com N réplicas; só quem recebe a linha emite eventos.
   - `devolverParaFila` (409): CAS RUNNING→QUEUED, remove `runtime.startedAt`, grava `dados.dispatch`.
   - Nenhum desses chama `calcula()` → `dados.risk` e as guardas da ADR-V2-081 ficam intocados.
4. **Política P1 (CEO): a verdade tardia substitui o desfecho sintético, uma única vez.** O callback real
   sobrescreve um FAILED `source='system'` (sweeper, dispatch, ACK timeout, backfill), grava `supersedes` e promove
   a task a DONE **somente se ela estiver EXECUTING ou FAILED com `v3.movedBy = system:execution-<id>`**
   (marcador gravado pelo sistema ao falhar ESTA execução — Ciclo 2/M2+L7; nunca sobrescreve FAILED manual
   nem de outra execução). O sweeper relê o outcome antes e depois de liberar a task (compensa para DONE). Como o novo outcome é `source='agent'`, qualquer
   callback seguinte encontra 0 linhas. Consumidores podem ver `execution.failed` seguido de
   `agent.execution.finished` (payload com `supersedes`) — no máximo uma vez por execução.
5. **Deadline P4 (+ fila órfã, Ciclo 2/M3):** QUEUED/APPROVED com `GREATEST(atualizadoEm, dispatch.nextAttemptAt) + 900s < NOW()` → `QUEUE_STALE` (job perdido / modo sem Redis).
   **Deadline de RUNNING:** `COALESCE(runtime.startedAt, atualizadoEm) + COALESCE(timeoutSec,1800) + 300s < NOW()` →
   `TIMEOUT_NO_CALLBACK`; `lastSeen − uptime > startedAt + 60s` (heartbeat) → `AGENT_RESTARTED`.
6. **409 PROJECT_BUSY (P2):** `RemoteAgentHttpError` (subclasse de `ServiceUnavailableException`) preserva
   `httpStatus` + `errorCode`; o processor devolve para QUEUED e re-enfileira (`jobId=<id>-busy-<n>`) com backoff
   30s·2ⁿ⁻¹ até 300s; após 10 tentativas → FAILED `PROJECT_BUSY_EXHAUSTED`. A task só vai a EXECUTING **depois do ACK**
   e somente se a execução ainda estiver RUNNING.
7. **Anti-duplicata em todas as entradas:** `ExecutionsService.execute` recusa task com execução não-terminal
   (409 `code:EXECUTION_IN_PROGRESS`, `details:{reason:'execution_in_progress', executionId, status}`); MCP/Nexus mapeiam
   para `INVALID_PARAMS`/`INVALID_INPUT` (precedente `task_locked`). Capability Nexus ganha `assertTaskNotLockedByOther`
   (paridade ADR-V2-073/079). Serialização por task com `pg_advisory_xact_lock(hashtext('exec-task:<taskId>'))`
   na trava+criação (`execute`) e no `markRunning` (Ciclo 2/M1 — elimina o write skew do `NOT EXISTS`);
   perdedora no dispatch vira FAILED `DUPLICATE_TASK_EXECUTION`. `HttpExceptionFilter` passa a repassar `details` (objeto) só para códigos da whitelist (`EXECUTION_IN_PROGRESS`).
8. **Baixa em todos os terminais:** REJECTED (reject) e EXPIRED (sweeper de aprovação) gravam `baixado=true`.
9. **Backfill P3 (silencioso):** `prisma/scripts/backfill-execution-baixado.ts` (dry-run padrão, `--apply`,
   `--close-stale-running` com o MESMO critério de deadline, `--release-tasks`, `--revert <snapshot>`), sem eventos.
10. **Agente:** SIGKILL após 15 s de grace quando o SIGTERM do timeout é ignorado (libera o mutex).

Motivos de falha são strings em `audit.outcome.reason`/`audit.errorCode` (`TIMEOUT_NO_CALLBACK`, `AGENT_RESTARTED`,
`PROJECT_BUSY_EXHAUSTED`, `DUPLICATE_TASK_EXECUTION`, `DISPATCH_FAILED`, `BACKFILL_STALE`, `QUEUE_STALE`) — atributo do desfecho,
não tipo de registro → **zero DClasse nova, zero tabela nova, zero migration**.

## Consequências

**Positivas:** nenhuma RUNNING além de `timeoutSec + 300s`; lock `activeExecution` volta a `null` em todo terminal;
DVFS 7 não roda 2×; 409 vira espera em vez de falha; duplicata bloqueada nas 3 superfícies.

**Negativas / riscos aceitos:** sequência `failed → finished` rara (P1); granularidade de 1 min do sweeper;
desvio Pilar 1 do `markRunning` (raw no processor) mantido e sinalizado (follow-up: mover ao Engine);
modo sem Redis continua sem processor (fora de escopo).

**Contribuição ao template Devari-Core:** "baixa garantida de operação assíncrona" (deadline no `dados`, sentinela
com `source`, CAS terminal + `baixado=true`, sweeper `UPDATE … RETURNING`) serve a qualquer DPedido dependente de
callback externo (PIX, adquirente).

## Follow-ups (LOW do Reviewer, não bloqueantes)

| ID | Tema | Ação |
|----|------|------|
| L6 | SIGKILL mata só o PID do `claude`; netos segurando stdio podem atrasar o callback | Usar process group se virar problema |
| L8 | Pool de conexões sob rajada de requests da mesma task (lock por task) | Medir em staging; avaliar limite por task |
| L9 | `dados.v3.movedBy` é forjável via REST (impacto desprezível) | Aceito; revisar se a trilha de auditoria exigir |
| L10 | Ordem `execution.started` / `execution.finished` com callback ultrarrápido | Emitir `started` antes do ACK ou deduplicar no consumidor |
| L11 | Semântica SQL (advisory lock real, ramo QUEUE_STALE) provada só em Postgres | Validar em staging antes/junto do deploy |
| — | `markRunning` raw no processor (desvio Pilar 1) | Mover para o Engine (`OperacaoExecucaoClaude`) |
| L12 | Engine (`OperacaoExecucaoClaude`) importa constantes de `src/executions/constants` (dependência de camada) | Mover a lista para `src/engine/` ou `src/common/` se o acoplamento crescer |
| L13 | `encerrarPorFalhaSistemica(params.reason)` aceita string livre no Engine (canonicidade garantida só pelo processor) | Tipar como `ExecutionFailureReason` para fechar a API pública |
| L14 | `source` legado sem campo vira `agent` (hipotético: outcome antigo sintético) | Improvável; sem ação |

## Deploy (conjunto Task 1 + Task 2 + Task 3)

1. `pg_dump -t '"DPedido"'` → 2. backfill `--dry-run` → 3. backfill `--apply --close-stale-running [--release-tasks]`
(ANTES do backend novo) → 4. seed DVFS (Task 1) → 5. `RISK_GATE_PROMPT_FLOOR=MEDIUM` → 6. deploy backend →
7. deploy frontend com F-1 (tratar 409 `EXECUTION_IN_PROGRESS`) → 8. bundle do agente 0.1.1 (SIGKILL) → 9. smoke.

---

## Ciclo 3 — outcome no DTO (contrato do frontend)

`ExecutionResponseDto` (`GET /executions/:id`, `GET /executions`, `POST /projects/:id/execute`, approve/reject)
ganha o campo **sempre presente**:

```ts
outcome: {
  reason: ExecutionFailureReason | null;   // código canônico — só quando source = "system"
  source: "agent" | "system" | null;       // null = ainda sem desfecho
}
```

| Situação | `outcome` |
|---|---|
| QUEUED / AWAITING_APPROVAL / APPROVED / RUNNING (sem desfecho) | `{ "reason": null, "source": null }` |
| Falha marcada pelo sistema | `{ "reason": "<CÓDIGO>", "source": "system" }` |
| Desfecho real do agente (sucesso ou falha real; ver `claude.exitCode`) | `{ "reason": null, "source": "agent" }` |
| Callback tardio substituiu o FAILED sintético | `{ "reason": null, "source": "agent" }` |
| Outcome legado sem `source` (pré-ADR-V2-082) | `{ "reason": null, "source": "agent" }` |

Projeção por whitelist (`toOutcome`): `reason` só sai se pertencer à lista canônica (texto livre → `null`);
nada de `supersedes`, `recordedAt`, `errorCode` ou stderr adicional. Nenhum outro campo do DTO mudou.

### Lista FINAL de códigos (`EXECUTION_FAILURE_REASON_CODES` em `src/executions/constants/execution-lifecycle.const.ts`)

| Código | Quem grava | Significado |
|---|---|---|
| `TIMEOUT_NO_CALLBACK` | sweeper | RUNNING passou de `timeoutSec + 300s` sem callback |
| `AGENT_RESTARTED` | sweeper | heartbeat mostra que o agente reiniciou depois do início |
| `QUEUE_STALE` | sweeper | QUEUED/APPROVED sem dispatch há mais de 900s (job perdido / sem Redis) |
| `TUNNEL_UNAVAILABLE` | processor | túnel SSH do agente indisponível no probe (detalhe ECONNREFUSED/TUNNEL_TIMEOUT só em `claude.stderr`) |
| `DISPATCH_FAILED` | processor | demais falhas de dispatch: ACK timeout, HTTP != 200 não-busy, projeto/agente não encontrado, contrato runtime incompleto, slug ausente, falha ao re-enfileirar |
| `PROJECT_BUSY_EXHAUSTED` | processor | agente respondeu 409 PROJECT_BUSY em 10 tentativas |
| `DUPLICATE_TASK_EXECUTION` | processor | outra execução da mesma task já estava RUNNING |
| `BACKFILL_STALE` | script de backfill | RUNNING antiga fechada em silêncio antes do deploy |

Fonte única: Engine (`encerrarVencidas`), processor (`failExecution`, parâmetro tipado `ExecutionFailureReason`)
e backfill importam as constantes — não há literal solto. `audit.errorCode` e `execution.failed.errorCode` = mesmo código.


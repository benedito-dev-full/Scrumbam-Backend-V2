# PLANO DETALHADO — Task 2: Execuções presas em RUNNING + falhas evitáveis por concorrência (V2 Fase F13/F6)

**Criado por:** Strategist Agent V2
**Data:** 2026-11-23 (rev. 2 — pós-Task 1, mesmo dia)
**Módulo:** executions (toca também `engine`, `automation`, `mcp`, `agent/`)
**Fase V2:** F13 (automação Claude Code / agente VPS) sobre o Engine de F6
**ADRs vinculados:** ADR-V2-005, ADR-V2-006, ADR-V2-008, ADR-V2-015 (gate 8.5), ADR-V2-033, ADR-V2-036, ADR-V2-066, ADR-V2-073, ADR-V2-079, ADR-V2-081 (Task 1, já em `main` — `277afb0`) — **propõe ADR-V2-082** (080 segue reservado à remoção VALIDATING/VALIDATED)
**Estimativa Total:** ~37h backend+agente (31h + 20% buffer) — frontend à parte (~2,5h, §4 "Impacto no Frontend")
**Complexidade:** Alta (concorrência, CAS, dois processos — backend + agente)

---

## 0. Revisão pós-Task 1 (o que mudou nesta rev. 2)

```
 rev.1 (antes da Task 1)                 rev.2 (agora)
 ───────────────────────                 ─────────────────────────────────────────────
 P1..P4 abertas            ──────────►   ✅ decididas pelo CEO (tabela abaixo)
 conflito com plano Risk Gate ───────►   ✅ resolvido: Task 1 só tocou calcula()/guardas
                                            e JSDoc do resolveCommandAndPrompt — sem sobreposição
 linhas de OperacaoExecucaoClaude ────►  ✅ re-conferidas (+~80 linhas deslocadas)
 1 spec com drift de construtor ──────►  ⚠️ 3 specs (commit 277afb0 registrou como pendência)
 frontend não mapeado ────────────────►  ✅ §4 "Impacto no Frontend" (2 ajustes + 1 requisito backend)
 deploy isolado ──────────────────────►  📋 deploy CONJUNTO Task 1 + Task 2 + Task 3 (§5 Fase 13)
```

| Decisão CEO | Escolha | Onde entra no plano |
|---|---|---|
| P1 — callback tardio após FAILED sintético | **Substitui o FAILED sintético, uma única vez** | §2 corrida; Fase 3/4 |
| P2 — teto do 409 PROJECT_BUSY | **10 tentativas (~41 min)** | `EXECUTION_BUSY_MAX_RETRIES=10`; Fase 5 |
| P3 — RUNNING antigas em produção | **Fechadas em silêncio** (backfill sem eventos) | Fase 7.3 (critério = deadline, não 24h) |
| P4 — margem do deadline | **300s** | `EXECUTION_DEADLINE_MARGIN_SEC=300`; Fase 2 |
| Deploy | **Conjunto com Task 1 e futura Task 3** (fluxo de agentes na VPS) | Fase 13 + R11 |

---

## 1. Análise

### Contexto

Execuções Claude Code (DPedido idClasse -301/-302/-303) ficam em `statusCode=-518 RUNNING` para sempre
quando o resultado não volta pelo callback `POST /agents/:id/execution-result`. A DTask vinculada fica
em EXECUTING e a UI a trata como somente leitura. Além disso, o 409 `PROJECT_BUSY` do agente vira
FAILED imediato, e nada impede duas execuções da mesma task.

### Estado Atual (cada ponto do diagnóstico conferido no código — re-conferido em `main` após `277afb0`)

| # | Ponto | Confirmado? | Evidência |
|---|-------|-------------|-----------|
| 1 | Processor BullMQ concurrency 3, attempts 1 | ✅ | `execution-run.processor.ts:80`, `execution-queue.service.ts:28-33` (`jobId = executionId`, `attempts: 1`) |
| 2 | `markRunning` CAS QUEUED/APPROVED → RUNNING via raw UPDATE | ✅ | `processor.ts:342-368` |
| 3 | Task → EXECUTING antes do dispatch | ✅ | `processor.ts:130` + `:331-340` (`updateStatus` sem `movedBy` → workSession com `agentId=null`) |
| 4 | ACK síncrono 30s | ✅ | `remote-execution-client.ts:139,277-278` |
| 5 | Resultado assíncrono → Engine `registrarOutcome` → -519/-520 + task DONE/FAILED | ✅ | `agents.service.ts:644-795`, `OperacaoExecucaoClaude.ts:587-675` (era 504-592 antes da Task 1) |
| 6 | Comentário "até sweeper ou callback", mas não existe sweeper de RUNNING | ✅ | `processor.ts:185-187`; só existem `approval-flow-sweeper.service.ts` (AWAITING→EXPIRED), `agent-status-sweeper.service.ts`, `session-purge.service.ts` |
| 7 | Callback: 5 tentativas, backoff base 1s, teto 60s | ✅ | `agent/src/outbound/backend-client.ts:120-125`. **Na prática a janela é ~15s de sleep (1+2+4+8) + até 5×10s de request timeout ≈ 65s.** Queda de backend/túnel de 1-2 min no fim da execução = resultado perdido |
| 8 | Timeout: `DEFAULT_TIMEOUT_SEC=1800` no processor; `dados.timeoutSec` nunca preenchido | ✅ | `processor.ts:42,259-263`; nenhum writer de `dados.timeoutSec` em `src/` |
| 9 | `timeoutMs=600000` do modo PROMPT é ignorado | ✅ | `executions.service.ts:30,323` (`DEFAULT_PROMPT_MODE_TIMEOUT_MS`) → vai para `dados.command.timeoutMs` (só exibição/validator), processor não lê |
| 10 | Agente usa 30min default | ✅ | `agent/src/claude-code/runner.ts:27`; honra `payload.timeoutSec` se vier (`run-claude-code.handler.ts:307-308`) |
| 11 | 409 PROJECT_BUSY → FAILED imediato | ✅ | Handler `:138-147`; no backend **qualquer** não-200 vira `ServiceUnavailableException` genérica (`remote-execution-client.ts:288-292`) → `failExecution` (`processor.ts:140-143`). Status HTTP e `errorCode` se perdem |
| 12 | Sem trava contra 2 execuções da mesma task via REST | ✅ | `executions.service.ts:83-262` não checa execução ativa; `assertTaskNotLockedByOther` só em `mcp/tools/execute-task.tool.ts:156`; **a capability Nexus (`common/tool-capabilities/capabilities/executions/execute-task.capability.ts:124-155`) também NÃO chama o guard** |
| 13 | Idempotência do callback via `audit.outcome.recordedAt` | ✅ | `agents.service.ts:690-703` — **read-then-write, não é CAS**; `_atualizarPedidoCompleto` (`OperacaoExecucaoClaude.ts:548-554`) é `update` incondicional (também usado por `_executarClaude`, 489/513 — **não alterar a assinatura**, criar caminho CAS separado) |
| 14 | `markRunning`/`finishExecution` UPDATE fora do Engine | ✅ (desvio Pilar 1, sinalizado §3) | `processor.ts:342-421` |

### Achados novos (não estavam no diagnóstico — mudam o desenho)

1. **🔴 `baixado` NUNCA vira `true` em execuções.** `TasksService.findActiveExecutionsForTasks` (`tasks.service.ts:1976-2026`) define o lock (`activeExecution`) como `baixado=false`, e o DTO/JSDoc afirma que sucesso/falha marcam `baixado=true` (`task-response.dto.ts:15-16`). Mas **nenhum caminho grava isso**: nem `registrarOutcome`, nem `failExecution`, nem o sweeper de aprovação, nem o reject. Resultado: **toda** execução terminada vira "zumbi" com `activeExecution != null` para sempre. O frontend mascara isso só quando a task está DONE/FAILED (`task-row-backend.tsx:186-194`, `task-sheet.tsx:219-222` — "activeExecution zumbi"). Se a task FAILED volta para READY para reexecutar, **ela fica travada na UI pelo zumbi**. Corrigir a "baixa" é parte obrigatória desta task.
2. **🔴 `failExecution` do processor não tira a task de EXECUTING.** Se o dispatch falha depois do `moveLinkedTaskToExecuting` (túnel caiu, 409, ACK timeout), o DPedido vai a FAILED mas a task fica EXECUTING.
3. **🟠 A CAS do `markRunning` tem brecha:** `OR dados->'approval'->>'status' IN ('queued','approved')` (`processor.ts:364`) continua verdadeira mesmo depois de um outcome gravado (o callback não muda `approval.status`). Hoje não causa dano por causa da ordem, mas qualquer reenfileiramento (409 retry) pode **sobrescrever SUCCESS/FAILED com RUNNING**. Precisa de `AND NOT (dados->'audit' ? 'outcome')`.
4. **🟠 ACK timeout é ambíguo:** se o agente aceitou mas o ACK estourou 30s, o backend marca FAILED; o callback real chega depois e, como `failExecution` não grava `audit.outcome`, o `registrarOutcome` **sobrescreve** FAILED com SUCCESS sem regra explícita. Mesma corrida do sweeper — resolver com uma única política (§2).
5. **🟡 Callback não emite `execution.failed`/`execution.completed`** — só `agent.execution.finished|failed`. O `NotificationConsumer` (`notification.consumer.ts:179-181`) escuta `execution.failed`, que hoje só sai do processor. Não expandir escopo, mas o sweeper DEVE emitir `execution.failed` (consumidor existente já trata).
6. **🟡 Agente não escala para SIGKILL:** `execFile({timeout})` manda só SIGTERM (`runner.ts:107-114`). `claude` que ignora SIGTERM segura o mutex do slug para sempre → todo dispatch daquele projeto vira 409 até reiniciar o agente.
7. **🟡 Agente não tem rota de status** (só `GET /ping` e `POST /v1/execute`, `http.server.ts:143-158`) e guarda tudo em memória. Porém o heartbeat **já persiste `uptime` + `lastSeen`** em `DEntidade.dados` do agente (`agents.service.ts:466,474`) → dá para detectar "agente reiniciou depois que a execução começou" **sem chamada de rede**.
8. **🟡 Três specs com drift de construtor** (registrado como pendência no commit `277afb0`): `execution-run.processor.spec.ts` (5 args vs 6 — falta `TasksService`), `executions.service.unit.spec.ts` e `approval-flow.service.unit.spec.ts`. Esta task modifica os três SUTs → **corrigir os três aqui** (Fase 10), senão os testes novos não rodam.
10. **🔴 (novo, visível no frontend) Execução REJEITADA aparece como "aguardando aprovação" para quem não disparou.** `deriveExecutionStatus` (`tasks.service.ts:174-190`) não reconhece `approval.status='rejected'|'expired'` (assume que `baixado=true` os filtra — o que nunca acontece) e cai no fallback `aprovado=false ⇒ 'awaiting_approval'`. O drawer novo do frontend (`task-detail-drawer-ai.tsx:55-84`) então mostra Aprovar/Rejeitar de novo numa execução já rejeitada/expirada. A Fase 7 (baixa em REJECTED/EXPIRED) corrige isso na raiz.
11. **🟠 (novo) O frontend decide "terminou" por `claude.finishedAt`.** `deriveStatus` (`frontend/src/hooks/use-task-execution.ts:124-134`) só sai de `running` quando `dados.claude.finishedAt` existe (exitCode decide done/failed). Logo, **todo FAILED sintético (sweeper, `failExecution`, busy esgotado, duplicata) DEVE gravar `claude.finishedAt` + `claude.exitCode=-1`** — senão o polling de 3s roda para sempre. Hoje o `failExecution` já grava; o novo `encerrarPorFalhaSistemica` precisa manter isso (requisito explícito na Fase 3).
12. **ℹ️ `CommandValidatorService` aceita `timeoutMs` 30000..3600000** (`command-validator.service.ts:131-133`) → o novo placeholder PROMPT de 1.800.000 ms passa; o clamp 30..3600s da Fase 2 é coerente com essa faixa.
13. **ℹ️ Modo sem Redis** (`REDIS_ENABLED=false`): `InMemoryQueueService` só loga e não há processor → execuções LOW ficam QUEUED para sempre. Fora de escopo (sinalizado em WILL NOT).

### Decisões Passadas Relevantes (ADRs V2)

- **ADR-V2-005** — Engine só em DPedido -300..-303. O desfecho terminal (outcome + baixa) é escrita de domínio transacional → mora no Engine.
- **ADR-V2-006** — risco via idClasse; intocado.
- **ADR-V2-008** — DEvento como trilha; `execution.failed` → DEvento -496 via `audit-log.consumer.ts:86`.
- **ADR-V2-033** — contrato `/v1/execute` + `execution-result`. **Sem mudança de protocolo** (o 409 já existe com `errorCode`; só passamos a ler).
- **ADR-V2-036** — monorepo `agent/`; a mudança do SIGKILL vai no mesmo PR.
- **ADR-V2-073** — trava MCP por workSession (TOCTOU aceito). Reaproveitada, não substituída.
- **ADR-V2-081 (Task 1, implementado)** — Risk Gate varre `dados.prompt`; `calcula()` ganhou `_aplicarGuardasModoPrompt()` (guarda de contrato + `RISK_GATE_PROMPT_FLOOR`). **Interação com esta task:** nenhuma no caminho de desfecho — `registrarOutcome` e os métodos novos restauram estado **sem** chamar `calcula()`, então as guardas não re-executam e `dados.risk` não é tocado. Efeito colateral operacional: com `RISK_GATE_PROMPT_FLOOR=MEDIUM` no deploy, mais execuções passam por AWAITING_APPROVAL → mais EXPIRED/REJECTED → a baixa desses terminais (Fase 7) fica mais importante.
- **ADR-V2-015** — gate do Reviewer agora é **APPROVED ≥ 8.5** (`f769407`).
- **ADR-V2-079** — camada única Nexus⇄MCP. A trava anti-duplicata vai no ponto comum (`ExecutionsService.execute`), cobrindo REST + MCP + Nexus de uma vez.
- Precedente de sweeper: `ApprovalFlowSweeperService` (`@Cron EVERY_MINUTE` + `$executeRaw` com CAS no WHERE).

---

## 2. Abordagem Escolhida

### Solução (resumo)

```
            ┌─────────────── deadline = startedAt + dados.timeoutSec + MARGEM ───────────────┐
 QUEUED ──► RUNNING ──(callback)──► SUCCESS/FAILED  (outcome.source='agent', baixado=true)
   ▲           │
   │ 409       └──(cron 1/min: deadline vencido OU agente reiniciou)──► FAILED
   └─ retry com backoff                         (outcome.source='system', reason=TIMEOUT_NO_CALLBACK|AGENT_RESTARTED,
                                                 baixado=true, task EXECUTING→FAILED, execution.failed)
```

**Abordagem A+ : cron sweeper de RUNNING com detecção precoce via heartbeat**, mais:
- **uma única fonte de verdade de timeout** (`DPedido.dados.timeoutSec`, gravada na criação);
- **um único "sentinela de desfecho"** (`dados.audit.outcome`) disputado por CAS entre sweeper e callback;
- **baixa canônica** (`baixado=true`) em todo estado terminal — corrige o lock zumbi;
- **409 PROJECT_BUSY → volta para QUEUED + job atrasado** com backoff e teto;
- **trava anti-duplicata** em `ExecutionsService.execute` (todas as entradas) + reforço na CAS do `markRunning`.

### Corrida sweeper × callback — política e mecânica

**Política DECIDIDA (CEO, P1): "a verdade tardia prevalece sobre o desfecho sintético, uma única vez".**
"Uma única vez" é garantido pela própria CAS: depois do supersede o `outcome.source` vira `'agent'`, e qualquer callback seguinte encontra 0 linhas.

| Quem grava primeiro | Quem chega depois | Resultado |
|---|---|---|
| Callback (source=`agent`) | Sweeper | CAS do sweeper exige `outcome` ausente → 0 linhas → no-op (nem evento) |
| Sweeper (source=`system`) | Callback | CAS do callback aceita `outcome` ausente **ou** `outcome.source='system'` → grava o resultado real, `audit.outcome.supersedes = {reason, recordedAt}`; task FAILED→DONE só se a task ainda estiver FAILED (não pisa em humano) |
| Callback | Callback (retry do agente) | 2ª CAS → 0 linhas → `alreadyPersisted=true` (hoje é read-then-write; DVFS chave 7/pr-auto-open poderia rodar 2x) |
| Sweeper réplica A | Sweeper réplica B | `UPDATE … RETURNING` — só quem atualizou emite evento |

Por que não "primeiro que grava vence"? Porque a execução pode ter **de fato** rodado (commits, PR aberto pelo Claude); jogar fora o resultado real deixa a task FAILED com trabalho feito. A troca é aceitar, raramente, a sequência de eventos `execution.failed` → `agent.execution.finished` para a mesma execução (marcada com `supersedes` no payload). Vale também para o FAILED sintético de ACK timeout (`DISPATCH_FAILED`) e de `failExecution` em geral — todos são `source:'system'`.

Mecânica da CAS (dentro do Engine — ver §3 Pilar 1):

```sql
-- callback (registrarOutcome)
UPDATE "DPedido" SET dados = $novo, baixado = true, "atualizadoEm" = NOW()
 WHERE chave = $id
   AND "idClasse" IN (-301,-302,-303)
   AND ( NOT (dados->'audit' ? 'outcome')
         OR dados->'audit'->'outcome'->>'source' = 'system' )
RETURNING chave;

-- sweeper (encerrarPorFalhaSistemica)
UPDATE "DPedido" SET dados = jsonb_set(...statusCode -520, audit.outcome{source:'system',reason,...}, runtime.finishedAt),
       baixado = true, "atualizadoEm" = NOW()
 WHERE "idClasse" IN (-301,-302,-303) AND excluido = false
   AND dados->>'statusCode' = '-518'
   AND NOT (dados->'audit' ? 'outcome')
   AND <deadline vencido OU agente reiniciou>
RETURNING chave, "idLocEscritu", dados;
```

> Nota: `$novo` no callback é montado a partir de uma leitura; se o sweeper atualizou entre a leitura e a CAS, a CAS do callback ainda passa (source=system) e sobrescreve com o resultado real — exatamente a política. Se outro callback venceu, 0 linhas.

### Justificativa

- Resolve **todos** os cenários do diagnóstico com um mecanismo só (restart do agente, retries esgotados, túnel caído pós-ACK, claude travado) — o sweeper não precisa saber a causa.
- Zero mudança de protocolo, zero tabela, zero DClasse nova; reaproveita o padrão já aprovado do `ApprovalFlowSweeperService`.
- A detecção por heartbeat (`lastSeen − uptime > runtime.startedAt` ⇒ agente reiniciou depois do início) encurta o caso mais comum (restart/deploy do agente) de ~35 min para ~1-2 min, sem rede.
- Funciona com várias réplicas do backend (CAS + RETURNING).

### Alternativas Consideradas (≥2)

| | (A+) Cron sweeper + heartbeat — **ESCOLHIDA** | (B) Sweeper que consulta o agente (GET status) | (C) Watchdog: job BullMQ atrasado por execução |
|---|---|---|---|
| Como | `@Cron` 1/min varre RUNNING vencidos; marca FAILED via CAS | Antes de falhar, `GET /v1/executions/:id` no agente para reconciliar | Ao despachar, `queue.add('watchdog', …, {delay: deadline})`; job marca FAILED se ainda RUNNING |
| Prós | Simples, idempotente, sem rede, cobre todos os cenários, padrão já existe | Poderia recuperar resultado de execução que terminou mas não reportou | Disparo pontual no deadline; sem varredura |
| Contras | Granularidade de 1 min (irrelevante p/ janela de 30 min); 1 query/min | **Agente não tem rota de status e guarda estado em memória** — após restart ele não sabe nada (é exatamente o caso principal). Exige mudança de protocolo + persistência no agente (ADR-V2-033/036). Túnel caído ⇒ consulta também falha. Não reconcilia stdout/sessão perdidos | Depende de Redis (modo in-memory sem cobertura); job perde-se em flush/eviction; jobId dedup do BullMQ (`removeOnComplete` mantém 500) complica re-agendamento; ainda precisa da mesma CAS. Não pega execuções já presas hoje |
| Esforço | ~29h (com o resto do escopo) | +12-16h (agente + protocolo + backend) | ~igual a A, com mais casos de borda |
| Risco | Baixo | Médio/Alto | Médio |

**Evolução futura (B-lite, COULD):** quando o agente ganhar estado persistente, um `RECONCILE_EXECUTION` pode ser somado ao sweeper como passo opcional — o desenho A+ não bloqueia isso.

Alternativas descartadas para o 409:
- **Serializar por projeto no backend** (BullMQ Groups) → recurso Pro/pago; e o mutex real é no agente.
- **Fila de espera no agente** (aceitar e enfileirar localmente) → estado em memória, perdido no restart; mudança de protocolo.

---

## 3. Avaliação dos 3 Pilares

### Pilar 1: Engine/Operação

- **Sem INSERT novo** em DPedido. Toda escrita aqui é **UPDATE de desfecho** em DPedido -301/-302/-303.
- Decisão: o **desfecho terminal** (outcome + statusCode final + `baixado=true`) passa a ser escrito **somente pelo Engine** `OperacaoExecucaoClaude`, porque é a "baixa" da operação (conceito canônico Pendente → Aprovado → **Baixado**):
  - `registrarOutcome()` (existente) ganha CAS + `baixado=true` e retorna `{ applied: boolean; superseded?: {...} }`.
  - **novo** `encerrarPorFalhaSistemica({ reason, errorCode, where: 'RUNNING' | 'ANY_NON_TERMINAL' })` — usado pelo sweeper e pelo `failExecution` do processor. Substitui o `finishExecution` raw do processor **no caminho de falha** (redução do desvio, não expansão).
  - **novo** `devolverParaFila({ busyAttempt, nextAttemptAt })` — CAS RUNNING→QUEUED no 409.
  - Para o sweeper (lote), o Engine expõe um método estático `OperacaoExecucaoClaude.encerrarVencidas(bd, { marginSec, now })` que roda o `UPDATE … RETURNING` em lote (um UPDATE, não N) e devolve as linhas afetadas. Mantém o SQL de domínio dentro do Engine.
- **Desvio Pilar 1 sinalizado e NÃO expandido:** `markRunning` (`processor.ts:342`) continua raw — só recebe a guarda `NOT (dados->'audit' ? 'outcome')` (+ anti-duplicata, §5 Fase 5). Mover `markRunning` para o Engine fica como follow-up (WILL NOT nesta task).
- **Convivência com a Task 1 (ADR-V2-081):** os métodos novos ficam **depois** de `registrarOutcome` (fim da classe). **Não tocar** `calcula()`, `_aplicarGuardasModoPrompt()`, `_lerPisoModoPrompt()`, `_elevarRisco()` nem `IExecucaoData.risk`. Os métodos de desfecho restauram estado como `registrarOutcome` já faz (sem `nova()`/`calcula()`), logo não reclassificam risco nem disparam a guarda de contrato.
- DVFS: nenhum script novo. DVFS chave 7 (pós-gravação) continua rodando **só** no callback e **só quando a CAS aplicou** (hoje pode rodar 2x em retry de callback).

### Pilar 2: Endpoints Genéricos

- **Nenhum endpoint novo.** O sweeper é cron interno. Mudanças de contrato são só em respostas existentes:
  - `POST /projects/:id/execute` passa a devolver **409 Conflict** `{ reason: 'execution_in_progress', executionId, status }` quando a task já tem execução não-terminal.
  - MCP `execute_task` e capability Nexus `execute_task` mapeiam esse 409 para `INVALID_PARAMS reason='execution_in_progress'` / `CapabilityError('CONFLICT'|'INVALID_INPUT', …)` — seguir o precedente `task_locked` (ADR-V2-073). Contagem de tools MCP inalterada (24→24).
- `GET /tasks[/:id]` (`activeExecution`) passa a refletir a verdade sem mudança de código no read-path — porque `baixado=true` finalmente é gravado.

### Pilar 3: Seed de Classes

- **ZERO DClasse nova. ZERO tabela nova. ZERO migration de schema.** Reuso:
  - -514 QUEUED (retorno no 409), -518 RUNNING, -520 FAILED (timeout/restart/busy esgotado), -519 SUCCESS, -521 EXPIRED, -517 REJECTED (para backfill de `baixado`), -522 ROLLED_BACK.
  - -496 EXECUTION_LOG_EVENT (DEvento via `audit-log.consumer.ts` e `ExecutionRuntimeLogService.recordSystem`).
- Motivo da falha vai em **`dados.audit.outcome.reason`** / `dados.audit.errorCode` (string enum de código, não DClasse): `TIMEOUT_NO_CALLBACK`, `AGENT_RESTARTED`, `PROJECT_BUSY_EXHAUSTED`, `DUPLICATE_TASK_EXECUTION`, `DISPATCH_FAILED`. Não justifica DClasse: é atributo do desfecho, não um tipo de registro (mesma decisão de `errorCode` que o agente já manda).
- **Fase 1 (seed) não se aplica.** Nada no `classes.seed.ts`.

### Genericidade (template vs V2-específico)

- **Genérico, candidato ao template Devari-Core:** "baixa garantida de operação assíncrona" — deadline persistido no `dados`, sentinela de desfecho com `source`, CAS terminal + `baixado=true`, sweeper com `UPDATE … RETURNING`. Serve a qualquer DPedido que depende de callback externo (PIX, webhooks de adquirente no Dinpayz). Registrar como contribuição futura no ADR-V2-082.
- **V2-específico:** detecção por heartbeat do agente, 409 PROJECT_BUSY, trava por task.

---

## 4. Estrutura Técnica

### Arquivos a Criar

| Arquivo | Conteúdo |
|---|---|
| `src/executions/constants/execution-lifecycle.const.ts` | `EXECUTION_DEFAULT_TIMEOUT_SEC=1800`, `EXECUTION_TIMEOUT_MIN_SEC=30`, `EXECUTION_TIMEOUT_MAX_SEC=3600`, `EXECUTION_DEADLINE_MARGIN_SEC=300`, `EXECUTION_BUSY_MAX_RETRIES=10`, `EXECUTION_BUSY_BASE_DELAY_MS=30000`, `EXECUTION_BUSY_MAX_DELAY_MS=300000`, `EXECUTION_FAILURE_REASONS` (enum de strings), `NON_TERMINAL_STATUS_CODES` (-514,-515,-516,-518), função pura `resolveExecutionTimeoutSec(command?)` e `computeBusyDelayMs(attempt)`. Todos sobrescrevíveis por env (`ConfigService`). |
| `src/executions/execution-running-sweeper.service.ts` | `@Cron(EVERY_MINUTE)` `sweepStaleRunning()` — chama `OperacaoExecucaoClaude.encerrarVencidas(...)`, depois para cada linha retornada: task EXECUTING→FAILED (condicional), `recordSystem` (DEvento -496), `execution.failed`. Guarda de reentrância (`private running = false`). |
| `src/executions/__tests__/execution-running-sweeper.service.spec.ts` | unit do sweeper |
| `src/executions/__tests__/execution-outcome-race.spec.ts` | corrida sweeper×callback e callback×callback (com mocks de `$queryRaw` retornando 0/1 linhas) |
| `src/automation/runtime/remote-agent-http.error.ts` | `RemoteAgentHttpError extends ServiceUnavailableException` com `status: number`, `errorCode?: string` (lido do body JSON do agente). Subclasse ⇒ callers que fazem `instanceof ServiceUnavailableException` continuam funcionando. |
| `prisma/scripts/backfill-execution-baixado.ts` | backfill de dados (não-DDL) — ver Fase 7 |

### Arquivos a Modificar

| Arquivo | Linhas aprox. | Mudança |
|---|---|---|
| `src/engine/lib/operacao/OperacaoExecucaoClaude.ts` | 548-554 (`_atualizarPedidoCompleto` — **intacto**), 587-675 (`registrarOutcome`), 116 (`setExecucaoData`) + novos métodos no fim da classe | `registrarOutcome` com CAS (raw dentro do Engine, método privado novo `_gravarDesfechoComCas`) + `baixado=true` + `audit.outcome.source='agent'` + `supersedes`; retorna `{applied, superseded}`; DVFS 7 só se `applied`. Novos: `encerrarPorFalhaSistemica`, `devolverParaFila`, `static encerrarVencidas`. `setExecucaoData` aceita `timeoutSec`. **Zona da Task 1 (136-266: `calcula` + guardas de prompt) fica intocada.** |
| `src/engine/lib/interfaces/IExecucaoData.ts` | 22 (`command.timeoutMs`), 140 (`audit`) | + `timeoutSec?: number` (top-level); `audit.outcome?: {success, recordedAt, source:'agent'|'system', reason?, supersedes?}`; `dispatch?: {busyAttempts, nextAttemptAt, lastErrorCode}`. Aditivo — não mexer no bloco `risk` reescrito pela Task 1. |
| `src/automation/agents/agents.service.ts` | 690-764 | Remover read-check como fonte de verdade (manter como fast-path), usar retorno `applied` do Engine → `alreadyPersisted`; se `superseded` e task FAILED → DONE (só se ainda FAILED); payload do evento ganha `supersedes` (aditivo). |
| `src/executions/processors/execution-run.processor.ts` | 42, 95-144, 185-187, 259-263, 342-421 | (a) usar constantes; (b) `markRunning`: + `AND NOT (dados->'audit' ? 'outcome')` + guarda anti-duplicata por task; (c) task→EXECUTING **depois** do ACK, condicionado a execução ainda RUNNING; (d) tratar `RemoteAgentHttpError{status:409, errorCode:'PROJECT_BUSY'}` → `devolverParaFila` + `enqueueRetry`; esgotado → FAILED `PROJECT_BUSY_EXHAUSTED`; (e) `failExecution` passa a usar `encerrarPorFalhaSistemica` e move task EXECUTING→FAILED se estiver EXECUTING; (f) payload `execution.failed` + `reason`; (g) atualizar comentário 185-187 (agora existe sweeper). |
| `src/executions/queues/execution-queue.service.ts` | 6-40 | `ExecutionRunJobData.busyAttempt?: number`; novo `enqueueRetry(input, { attempt, delayMs })` com `jobId = \`${executionId}-busy-${attempt}\`` (sem `:` — BullMQ rejeita `:` em custom id) e `delay`. |
| `src/executions/queues/in-memory-queue.service.ts` | 14-25 | `enqueueRetry` no-op com log (paridade de interface). |
| `src/automation/runtime/remote-execution-client.ts` | 288-292 | Em `!response.ok`, ler body (`.json().catch`) e lançar `RemoteAgentHttpError(status, errorCode)`. |
| `src/executions/executions.service.ts` | 24-30 (const), 83-180 (`execute`, `setExecucaoData` ~175), 320-324 (placeholder) | (a) remover `DEFAULT_PROMPT_MODE_TIMEOUT_MS=600000` e usar `EXECUTION_DEFAULT_TIMEOUT_SEC*1000` no placeholder; (b) gravar `dados.timeoutSec = resolveExecutionTimeoutSec(command)` via `setExecucaoData`; (c) **guard anti-duplicata** quando `dto.taskId`: `assertNoActiveExecutionForTask(taskId)` → `ConflictException`, **antes** de `resolveCommandAndPrompt` (evita montar prompt e rodar Risk Gate à toa). ✅ Sem conflito com a Task 1: ela só acrescentou JSDoc (linhas 274-279 do `resolveCommandAndPrompt`) — preservar esse parágrafo. |
| `src/executions/approval-flow.service.ts` | ~173 (approve), ~270 (reject) | reject: `baixado=true` junto do statusCode -517 (UPDATE simples). approve: nada além de herdar o guard de duplicata do `markRunning`. |
| `src/executions/approval-flow-sweeper.service.ts` | 45-58 | EXPIRED também grava `baixado=true` (UPDATE simples no mesmo SQL). |
| `src/executions/executions.module.ts` | 89-101 | registrar `ExecutionRunningSweeperService`. |
| `src/mcp/tools/execute-task.tool.ts` | 186-206 | mapear `ConflictException(reason='execution_in_progress')` → `McpToolError INVALID_PARAMS {reason:'execution_in_progress', executionId}`. |
| `src/common/tool-capabilities/capabilities/executions/execute-task.capability.ts` | 138-175 | (a) adicionar `assertTaskNotLockedByOther(task, principal.actorEntidadeId)` (paridade com MCP — ADR-V2-073/079); (b) mapear o 409 como acima. |
| `agent/src/claude-code/runner.ts` | 105-150 | Escalonamento: ao estourar `timeoutSec`, SIGTERM; após `KILL_GRACE_MS=15000` sem `exit`, `child.kill('SIGKILL')`. `timedOut=true` em ambos. |
| `src/executions/__tests__/execution-run.processor.spec.ts` | 30-38 + novos casos | corrigir construtor (6 deps) + casos 409/ordem/failExecution. |
| `src/executions/__tests__/executions.service.unit.spec.ts` | construtor + novos casos | corrigir drift de construtor (pendência do `277afb0`) + casos do guard anti-duplicata. Não tocar `executions.service.prompt-mode.spec.ts` além do necessário (11 testes da Task 1 devem seguir verdes). |
| `src/executions/__tests__/approval-flow.service.unit.spec.ts` | construtor + reject | corrigir drift + assert de `baixado=true` no reject. |
| `src/tasks/tasks.service.ts` | 156-190 (JSDoc de `deriveExecutionStatus`) | **Só JSDoc**: afirmar que `baixado=true` agora é gravado em todos os terminais (o comentário "rejected/expired não chegam aqui" passa a ser verdade). Sem mudança de lógica. |
| `src/tasks/dto/task-response.dto.ts` | 15-16 | JSDoc de `activeExecution` coerente com a baixa real. |

### Endpoints REST (com query params)

Nenhum novo. Mudança de contrato:

```
POST /api/v1/projects/:id/execute   body { taskId }
  200/201 → como hoje
  409     → { statusCode:409, reason:"execution_in_progress", executionId:"123", status:"running|queued|awaiting_approval" }
```

### Queries Prisma (exemplos chave)

```typescript
// Guard anti-duplicata (ExecutionsService) — 1 query, sem N+1
const active = await this.prisma.dPedido.findFirst({
  where: {
    idClasse: { in: [EXEC_LOW, EXEC_MEDIUM, EXEC_HIGH] },
    excluido: false,
    baixado: false,
    dados: { path: ['task', 'id'], equals: taskId },
  },
  select: { chave: true, dados: true },
  orderBy: { chave: 'desc' },
});
// + filtro em memória statusCode ∈ NON_TERMINAL_STATUS_CODES (robusto contra zumbis legados)
```

```sql
-- markRunning reforçado (processor) — guarda de outcome + anti-duplicata atômica
UPDATE "DPedido" SET ... statusCode -518 ...
 WHERE chave = $id AND "idClasse" IN (-301,-302,-303)
   AND NOT (dados->'audit' ? 'outcome')
   AND ( dados->>'statusCode' IN ('-514','-516') OR dados->'approval'->>'status' IN ('queued','approved') )
   AND NOT EXISTS (
     SELECT 1 FROM "DPedido" o
      WHERE o."idClasse" IN (-301,-302,-303) AND o.excluido = false AND o.chave <> $id
        AND o.dados->'task'->>'id' = "DPedido".dados->'task'->>'id'
        AND o.dados->>'statusCode' = '-518')
```
Se a CAS falhar e existir outra RUNNING para a mesma task → `encerrarPorFalhaSistemica(DUPLICATE_TASK_EXECUTION)` (não deixar a perdedora QUEUED para sempre).

```sql
-- Engine.encerrarVencidas (sweeper) — condição de vencimento
AND (
  COALESCE((dados->'runtime'->>'startedAt')::timestamptz, "atualizadoEm")
    + make_interval(secs => COALESCE((dados->>'timeoutSec')::int, 1800) + $marginSec) < NOW()
  OR EXISTS (  -- agente reiniciou depois do início (heartbeat já persiste uptime/lastSeen)
    SELECT 1 FROM "DEntidade" a
     WHERE a.chave = (dados->'audit'->>'agentId')::bigint AND a."idClasse" = -156
       AND (a.dados->>'lastSeen')::timestamptz - make_interval(secs => (a.dados->>'uptime')::numeric)
           > COALESCE((dados->'runtime'->>'startedAt')::timestamptz, "atualizadoEm") + interval '60 seconds'
  )
)
LIMIT via CTE (ORDER BY chave LIMIT 100) para evitar lote gigante
RETURNING chave, "idLocEscritu", dados
```
Reason = `AGENT_RESTARTED` se o ramo do heartbeat bateu, senão `TIMEOUT_NO_CALLBACK` (computar via `CASE` no `jsonb_build_object`). Folga de 60s absorve skew de relógio entre VPS e backend. Datas: tudo em `NOW()`/`timestamptz` do Postgres (durações, não filtros por dia — TimezoneService não se aplica).

### Eventos Emitidos (DEvento idClasse=-49X)

| Evento | Quando | Payload (aditivo, nada removido) | DEvento |
|---|---|---|---|
| `execution.failed` | sweeper; `failExecution`; busy esgotado | `{executionId, projectId, agentId, taskId?, reason, errorCode}` | -496 (audit-log.consumer) + notificação "Execucao falhou" (consumer existente) + webhook (já em `supported-events.ts:24`) |
| `agent.execution.finished/failed` | callback (inalterado) | + `supersedes?: { reason, recordedAt }` quando sobrescreveu desfecho sintético | -496 |
| (log) `recordSystem` | toda falha sistêmica e cada 409 retry | linha `PROJECT_BUSY retry n/10 em Xs` | -496 |

Nomes seguem `dominio.entidade.acao` (devari-event-naming). **Nenhum evento novo** — evita mexer em `event-types.ts`/webhooks.
Ordem: eventos SEMPRE após a CAS retornar linhas (Padrão #7). Sweeper emite só para linhas do `RETURNING`.

### Impacto no Frontend (repo separado — `scrumban/frontend`, após o commit `d1136b0` da UI de aprovar/rejeitar)

O contrato **não quebra**: nenhum campo some, nenhum tipo muda. O que muda é a **semântica** — `activeExecution` passa a voltar a `null` de verdade e execuções presas viram FAILED.

```
 Backend (esta task)                         Frontend hoje                        Precisa mudar?
 ─────────────────────────────────────────   ──────────────────────────────────   ─────────────────────────
 baixado=true em SUCCESS/FAILED/REJ/EXP ──►  activeExecution=null → drawer        ✅ não (já trata null)
                                             mostra "Executar"; masks "zumbi"
                                             (task-row-backend, task-sheet,
                                             kanban-board, task-detail-drawer)
                                             viram redundantes, mas inofensivas
 REJECTED/EXPIRED somem do activeExecution ► corrige bug: hoje aparecem como      ✅ não (é a correção)
                                             awaiting_approval p/ quem não disparou
 FAILED sintético (sweeper/dispatch)   ──►   deriveStatus usa claude.finishedAt   ⚠️ requisito BACKEND:
                                             + exitCode                           gravar claude.finishedAt
                                                                                  e exitCode=-1 (Fase 3)
 POST /execute → 409 execution_in_progress ► executeMutation sem onError →        🔧 SIM (F-1)
                                             erro genérico
 Callback tardio substitui FAILED      ──►   polling já parou em "failed";        ➖ aceitável; F-2 opcional
                                             tasks refetch mostra DONE
 409 PROJECT_BUSY → volta QUEUED       ──►   approval.status segue approved →     ✅ não
                                             UI mostra "rodando" (correto p/ user)
```

| # | Ajuste frontend | Arquivos | Esforço | Prioridade |
|---|---|---|---|---|
| **F-1** | Tratar `409 {reason:'execution_in_progress', executionId}` no `executeMutation`: buscar `GET /executions/:executionId` e chamar `adoptExecution` (retoma polling da execução existente) em vez de mostrar erro. Toast informativo "Já existe uma execução em andamento". | `src/hooks/use-task-execution.ts` (~220-232) | ~1,5h | MUST no deploy conjunto (senão o 2º clique vira erro cru) |
| F-2 | No polling, após terminal `failed`, se a resposta trouxer `claude.stderr` com reason (`TIMEOUT_NO_CALLBACK`/`AGENT_RESTARTED`/`PROJECT_BUSY_EXHAUSTED`), exibir texto amigável ("A IA não respondeu a tempo") | `use-task-execution.ts`, `task-detail-drawer-ai.tsx` | ~1h | COULD (mesmo item do COULD do backend) |
| F-3 | Atualizar JSDoc de `ActiveExecutionDto.status` (diz "derivado de aprovado/baixado" e "`queued` reservado") — hoje é derivado de `approval.status` e `queued` já é usado | `src/lib/types/api.ts:357-365` | 10min | SHOULD |
| — | Remover as masks "zumbi" (`isTerminalStatus`) | 4 componentes | — | WILL NOT agora: manter como defesa até o backfill rodar em prod e confirmar 0 zumbis |

**Ordem de deploy:** backend e frontend podem subir em qualquer ordem (mudança aditiva), mas F-1 deve estar no mesmo pacote de release para o usuário não ver erro cru no clique duplo.

---

## 5. Plano de Implementação

> Ordem pensada para cada fase compilar e passar testes sozinha. Build: `make build` (ou `npm run build`) no backend; `cd agent && npm run build && npm test` no agente.

### Fase 1: Seed — NÃO SE APLICA
Nenhuma DClasse nova; reuso de -514..-522 e -496. (Pilar 3 ✅)

### Fase 2: Constantes + timeout fonte única (2h)
1. Criar `execution-lifecycle.const.ts` (valores + `resolveExecutionTimeoutSec` + `computeBusyDelayMs`).
2. **Regra da fonte única:** `DPedido.dados.timeoutSec` é gravado **uma vez, na criação**, por `ExecutionsService.execute`:
   - modo COMMAND/HÍBRIDO com `command.timeoutMs` do caller → `clamp(round(timeoutMs/1000), 30, 3600)`;
   - modo PROMPT → `EXECUTION_DEFAULT_TIMEOUT_SEC` (1800) e o placeholder `timeoutMs` passa a ser `1800*1000` (some a incoerência 600000 vs 1800).
3. Processor lê `dados.timeoutSec` (já lê) → manda ao agente (já manda) → agente honra (já honra); o default 30min do agente vira só fallback de compatibilidade.
4. Sweeper usa `dados.timeoutSec` (fallback 1800 para execuções legadas) + `EXECUTION_DEADLINE_MARGIN_SEC` (300s).
   Margem cobre: `git checkout` (30s) + `git pull` (60s) + janela de retry do callback (~65s) + skew + 1 ciclo de cron.
5. `dados.command.timeoutMs` vira só espelho/legado (documentar no JSDoc; `ExecutionResponseDto` continua expondo).

### Fase 3: Engine — desfecho terminal com CAS + baixa (5h)
1. `registrarOutcome`: CAS (SQL acima) com `baixado=true`, `audit.outcome = {success, recordedAt, source:'agent'}`; se a linha anterior tinha `source:'system'`, gravar `audit.outcome.supersedes`. Retornar `{applied, superseded}`. DVFS 7 só se `applied`.
2. `encerrarPorFalhaSistemica({reason, errorCode, expected})`: CAS por `chave`, `statusCode -520`, `baixado=true`, `claude.exitCode=-1`, `claude.stderr=reason`, **`claude.finishedAt`** (obrigatório — o frontend só encerra o polling com ele, achado #11), `runtime.finishedAt`, `audit.outcome={success:false, source:'system', reason, recordedAt}`. Retorna `boolean`.
3. `devolverParaFila({busyAttempt, nextAttemptAt})`: CAS `statusCode='-518' AND NOT outcome` → `-514`, `dados.dispatch = {busyAttempts, nextAttemptAt, lastErrorCode:'PROJECT_BUSY'}`, remove `runtime.startedAt`.
4. `static encerrarVencidas(bd, {marginSec, limit})`: lote do sweeper (SQL acima), retorna linhas.
5. JSDoc completo (template devari-jsdoc) explicando política "verdade tardia prevalece sobre sintético".

### Fase 4: Callback reconciliado (2h)
`agents.service.ts` `recordExecutionResult`: fast-path de leitura mantido **só** quando `outcome.source==='agent'`; delegar decisão ao retorno `applied`. Se `!applied` → `{accepted:true, alreadyPersisted:true, persistedAt: outcome.recordedAt}`. Se `superseded` e `success` → task FAILED→DONE **somente se** `task.status==='FAILED'` (ler via `tasksService.findOne`, 1 query); se `!success` mantém FAILED. Eventos como hoje + `supersedes`.

### Fase 5: Processor — ordem, 409 retry, anti-duplicata (5h)
1. `RemoteAgentHttpError` no client (status + errorCode do body).
2. Nova ordem em `process()`:
   `load → probe → markRunning(CAS reforçada) → emit started → dispatch → [ACK ok] → moveLinkedTaskToExecuting (só se statusCode ainda -518)`.
   - Mover a task **depois** do ACK evita task EXECUTING durante 409/backoff. A releitura de `statusCode` evita regredir DONE→EXECUTING se um callback ultrarrápido (ex.: `GIT_PULL_FAILED`) chegar antes.
3. `catch`:
   - `RemoteAgentHttpError` com `status===409 && errorCode==='PROJECT_BUSY'`:
     `attempt = (job.data.busyAttempt ?? 0) + 1`; se `attempt <= EXECUTION_BUSY_MAX_RETRIES` → `devolverParaFila` + `enqueueRetry(delay=computeBusyDelayMs(attempt))` (30s, 60s, 120s, 240s, 300s… teto 300s; 10 tentativas ≈ 41 min ≥ 1 janela de timeout) + `recordSystem`. Senão → falha `PROJECT_BUSY_EXHAUSTED`.
   - demais erros → `failExecution(reason)` (agora via Engine + task EXECUTING→FAILED se aplicável). **ACK timeout** continua FAILED (`DISPATCH_FAILED`), mas por ser `source:'system'` o callback real, se vier, prevalece (achado #4 resolvido pela mesma política).
4. `markRunning` com CAS falha:
   - se há outra RUNNING da mesma task → `encerrarPorFalhaSistemica('DUPLICATE_TASK_EXECUTION')`;
   - senão (stale/já terminou) → skip como hoje.
5. Atualizar comentário `:185-187` e JSDoc da classe (fila, eventos, retry).

### Fase 6: Sweeper de RUNNING (3h)
`ExecutionRunningSweeperService.sweepStaleRunning()`:
1. Reentrância: flag `running` (cron de 1 min não sobrepõe).
2. `rows = await OperacaoExecucaoClaude.encerrarVencidas(prisma, {marginSec, limit:100})`.
3. Tasks afetadas: batch — `taskIds` das linhas; para cada task **ainda EXECUTING** → `tasksService.updateStatus(id, {status:'FAILED'})` (try/catch por item, log). Leitura em batch do status atual (1 `findMany`) para não pisar em humano — ZERO N+1 nas leituras; os updates são por task (via service, necessário pela telemetria/eventos de status).
4. Por linha: `recordSystem` (-496) + `execution.failed {reason}` (após persistência).
5. Log estruturado `execution_sweeper_failed count=N reasons={...}`.
6. Lock na UI liberado por consequência: `baixado=true` ⇒ `activeExecution=null` (o `findActiveExecutionsForTasks` já filtra `baixado:false`); task sai de EXECUTING ⇒ `resolveActiveWorkSession` deixa de travar o MCP (workSession fica aberta, mas status é o gate — comportamento atual documentado em `worksession-badge-lock-facts`).

### Fase 7: Baixa em todos os terminais + backfill (3h)
1. Reject (`approval-flow.service.ts` ~270) e expire (`approval-flow-sweeper.service.ts:45-58`) passam a gravar `baixado=true` no mesmo UPDATE (UPDATE simples de status — permitido fora do Engine pela regra "UPDATE 1-2 campos").
2. `prisma/scripts/backfill-execution-baixado.ts` (data-only, **sem DDL — não é migration**):
   - **up:** `UPDATE "DPedido" SET baixado=true WHERE "idClasse" IN (-301,-302,-303) AND baixado=false AND dados->>'statusCode' IN ('-517','-519','-520','-521','-522')` — idempotente (rodar 2x = 0 linhas na 2ª).
   - **down:** registra as chaves alteradas em arquivo JSON local (`--dry-run` default imprime contagem; `--apply` grava e salva `backfill-execution-baixado.<timestamp>.json`); rollback = `--revert <arquivo>` volta `baixado=false` só nessas chaves.
   - **Backup:** `pg_dump -t '"DPedido"'` (ou snapshot do provedor) ANTES do `--apply` em prod — Implementer NÃO roda em prod (protocolo de migration).
3. **Execuções presas hoje (RUNNING antigos) — DECISÃO CEO (P3): fechar em silêncio.** O script ganha `--close-stale-running`, rodado **imediatamente antes** do deploy:
   - Critério = **o mesmo deadline do sweeper** (`startedAt|atualizadoEm + COALESCE(timeoutSec,1800) + 300s < NOW()`), não mais "> 24h" — assim, no 1º ciclo pós-deploy o sweeper não encontra nada vencido de antes e **não há rajada**.
   - Grava o mesmo formato do sweeper (`statusCode -520`, `baixado=true`, `claude.finishedAt`, `claude.exitCode=-1`, `audit.outcome={success:false, source:'system', reason:'BACKFILL_STALE'}`) → callback tardio ainda poderia substituir (P1), coerente.
   - **Sem eventos** (`execution.failed`, notificação, webhook, DEvento -496): é limpeza de dívida, não falha nova.
   - Tasks vinculadas ainda em EXECUTING: o script lista no relatório e, com `--release-tasks`, move para FAILED via `TasksService.updateStatus` (script com `NestFactory.createApplicationContext` — preserva workSession/telemetria de status). Os eventos de **status da task** saem normalmente; o silêncio é sobre a execução. Padrão `--dry-run`.
   - Rollback: o mesmo arquivo `backfill-execution-baixado.<timestamp>.json` guarda `chave` + `dados` anteriores dessas linhas; `--revert` restaura.

### Fase 8: Anti-duplicata em todas as entradas (3h)
1. `ExecutionsService.execute`: se `dto.taskId` → `assertNoActiveExecutionForTask(taskId)` **antes** do Engine (query acima) → `ConflictException({reason:'execution_in_progress', executionId, status})`. Ponto único que cobre **REST + MCP + Nexus** (ADR-V2-079).
2. MCP tool: mapear o 409 → `INVALID_PARAMS reason='execution_in_progress'` (precedente `task_locked`).
3. Capability Nexus: + `assertTaskNotLockedByOther` (paridade com o tool MCP) + mesmo mapeamento.
4. Residual TOCTOU (2 requests no mesmo ms): fechado na hora do dispatch pela CAS anti-duplicata do `markRunning` (Fase 5.4). Aceito no ADR como no ADR-V2-073.

### Fase 9: Agente — SIGKILL após grace (2h)
`runner.ts`: guardar timer próprio; no timeout SIGTERM (comportamento do `execFile`) e, se o processo não sair em 15s, `child.kill('SIGKILL')`. Garante que `runAndReport` chega ao `finally` e libera o mutex (fim do 409 eterno). Testes Jest com `execFileImpl` fake que ignora SIGTERM. Versão do agente: bump patch.

### Fase 10: Testes (7h) — ver lista em §8
Inclui corrigir o drift de construtor das 3 suites (`execution-run.processor`, `executions.service.unit`, `approval-flow.service.unit`) **antes** de escrever os casos novos. Regressão obrigatória da Task 1: `risk-gate-adversarial.spec.ts` (58/58), `risk-gate-natural-language.spec.ts`, `OperacaoExecucaoClaude.unit.spec.ts` e `executions.service.prompt-mode.spec.ts` sem diff de resultado.
### Fase 11: Smoke (1,5h)
1. Disparar execução LOW → matar o agente (`systemctl restart scrumban-agent`) no meio → em ≤2 min: DPedido -520 `AGENT_RESTARTED`, `baixado=true`, task FAILED, `activeExecution=null`, notificação "Execucao falhou".
2. Disparar 2 tasks do mesmo projeto → 2ª recebe 409 do agente → volta QUEUED, retenta, roda após a 1ª.
3. Disparar a mesma task 2x (REST) → 2ª recebe 409 `execution_in_progress`.
4. Forçar `timeoutSec=60` (COMMAND mode com `timeoutMs=60000`) e bloquear o callback (derrubar túnel após ACK) → FAILED `TIMEOUT_NO_CALLBACK` em ~6-7 min; reabrir túnel e reenviar callback manualmente → `supersedes` gravado, task DONE.

### Fase 12: ADR-V2-082 (1h, Documenter formaliza)
"Ciclo de vida terminal de execuções: deadline persistido, sentinela de desfecho com `source`, CAS sweeper×callback, baixa canônica e retry de PROJECT_BUSY". **Merece ADR:** é decisão arquitetural nova (política de reconciliação + nova convenção de baixa) e candidata ao template. O ADR registra as 4 decisões do CEO (P1-P4) como "Decisão" e cita ADR-V2-081 como vizinho (mesmo Engine, zonas disjuntas).

### Fase 13: Deploy conjunto Task 1 + Task 2 + Task 3 (runbook, 0,5h de redação — execução é do CEO/ops)
A Task 3 (fluxo de agentes rodando na VPS) ainda não foi planejada; esta fase só fixa **o que a Task 2 exige** do pacote conjunto:

```
 1. pg_dump -t '"DPedido"'                         (backup)
 2. backfill --dry-run → revisar contagens          (Task 2, Fase 7)
 3. backfill --apply --close-stale-running          (silencioso, P3)  ← ANTES do backend novo subir
 4. npm run seed (DVFS) + conferir md5              (Task 1, runbook ADR-V2-081)
 5. RISK_GATE_PROMPT_FLOOR=MEDIUM                   (Task 1, até medir falso positivo)
 6. deploy backend (Task 1 + Task 2)                → sweeper começa a rodar 1/min
 7. deploy frontend (UI aprovar/rejeitar + F-1)
 8. bundle do agente com SIGKILL (Fase 9) na VPS    ← encaixar no fluxo da Task 3
 9. smoke da Fase 11 na VPS real
```

- Entre os passos 3 e 6 há uma janela em que uma execução pode vencer sem sweeper — irrelevante (o sweeper a pega no 1º ciclo, com evento, que é o comportamento correto para falha nova).
- Se a Task 3 atrasar, os passos 1-7 + 9 podem subir sem o 8: o backend cobre o "agente antigo" (R10).
- Documenter atualiza `docs/automation-security-runbook.md` (ou o runbook do agente) com esta sequência.

---

## 6. Estimativa de Tempo (com buffer 20%)

| Fase | Horas |
|---|---|
| 2 Constantes + timeout | 2,0 |
| 3 Engine CAS + baixa | 5,0 |
| 4 Callback | 2,0 |
| 5 Processor 409/ordem/dup | 5,0 |
| 6 Sweeper | 3,0 |
| 7 Baixa terminais + backfill (+ `--release-tasks`, critério = deadline) | 3,0 |
| 8 Anti-duplicata entradas | 3,0 |
| 9 Agente SIGKILL | 2,0 |
| 10 Testes (+ drift das 3 suites + regressão Task 1) | 7,0 |
| 11 Smoke | 1,5 |
| 12 ADR | 1,0 |
| 13 Runbook do deploy conjunto | 0,5 |
| **Subtotal** | **35,0** → ajustado p/ ~31h efetivas (fases 3/4 e 5/8 compartilham contexto) |
| **Total com buffer 20%** | **~37h (≈ 4,5-5 dias)** — era ~35h na rev. 1 (+2h: drift de 3 specs, backfill de tasks, runbook) |
| Frontend (repo separado, fora do total) | F-1 1,5h + F-3 0,2h (+ F-2 1h se COULD) ≈ **~2,5h** com buffer |

---

## 7. Riscos e Mitigações

### Alto
- **R1 — Rajada de `execution.failed` no 1º ciclo pós-deploy** (todas as RUNNING antigas vencidas). → `--close-stale-running` com o **mesmo critério de deadline** do sweeper, rodado imediatamente antes do deploy, sem eventos (Fase 7.3, decisão P3); sweeper com `limit 100`/ciclo.
- ~~R2 — Conflito de merge com o plano do Risk Gate~~ → **RESOLVIDO**: Task 1 já está em `main` (`277afb0`); ela só alterou `calcula()`/guardas (136-266) e JSDoc de `resolveCommandAndPrompt` em `executions.service.ts`. Esta task trabalha em zonas disjuntas. Risco residual (baixo): mexer por engano no bloco `risk` de `IExecucaoData` — Reviewer confere que o diff não toca 65-91 do interface nem 136-266 do Engine.
- **R3 — Política "verdade tardia prevalece" gera sequência failed→finished** para consumidores (notificação/webhook) e o frontend mostra "falhou" até o próximo refetch. → Campo `supersedes` no payload; documentar no ADR (decisão P1 do CEO; ocorre no máximo 1 vez por execução).
- **R11 — Deploy conjunto com Task 3 ainda não planejada.** Se a Task 3 mudar o protocolo `/v1/execute` ou o handler do agente, pode colidir com a Fase 9 (SIGKILL em `runner.ts`). → Fase 9 é isolada em `runner.ts` (sem mudança de protocolo); o plano da Task 3 deve ler este plano. Sequência do deploy fixada na Fase 13; backend e frontend podem subir sem o agente novo (R10).
- **R12 — Frontend sem F-1 no mesmo release** → clique duplo em "Executar" vira erro cru (409). → F-1 marcado MUST do pacote conjunto (§4).

### Médio
- **R4 — Skew de relógio VPS × backend no ramo heartbeat** (falso `AGENT_RESTARTED`). → folga de 60s; `lastSeen` é gravado pelo **backend** (`now` do backend em `agents.service.ts:452`), só `uptime` vem do agente → skew só afeta a precisão do uptime, não o relógio absoluto.
- **R5 — Task movida para EXECUTING depois do ACK:** UI mostra a task "parada" por alguns ms a mais. → aceitável; activeExecution=`queued/running` já trava a UI desde a criação.
- **R6 — jobId de retry e dedup do BullMQ.** → `jobId = ${executionId}-busy-${n}` (sem `:`); teste unitário garante unicidade.
- **R7 — DVFS 7 (pr-auto-open) no supersede:** passa a rodar quando o resultado real chega após o sweeper. → desejado (PR real existe); idempotência do script já é requisito (ADR-V2-020).
- **R8 — 3 specs com drift de construtor** (processor, executions.service.unit, approval-flow.service.unit). → corrigir na Fase 10, antes dos casos novos.

### Baixo
- **R9 — Performance do sweeper:** 1 UPDATE/min com filtro `idClasse IN + baixado=false` e jsonb; volume de RUNNING é ínfimo. Se necessário, índice parcial `WHERE baixado=false` (follow-up, exige migration — não nesta task).
- **R10 — Agente antigo sem SIGKILL** enquanto não atualizado: sweeper cobre do lado do backend; 409 retry esgota e falha com motivo claro.

---

## 8. Critérios de Sucesso

### MUST HAVE
- [ ] Nenhuma execução fica em -518 além de `timeoutSec + 300s` (sweeper) — teste unit + smoke.
- [ ] Ao virar FAILED por timeout/restart: `baixado=true`, `claude.finishedAt` + `claude.exitCode=-1` (frontend encerra o polling), task EXECUTING→FAILED (só se ainda EXECUTING), `activeExecution=null`, `execution.failed` com `reason`.
- [ ] Execução rejeitada/expirada **não** aparece mais como `awaiting_approval` em `activeExecution` (achado #10).
- [ ] Testes da Task 1 (Risk Gate) seguem verdes sem diff; 3 suites com drift corrigidas.
- [ ] Callback tardio substitui o FAILED sintético no máximo 1 vez (P1); backfill silencioso com critério de deadline (P3).
- [ ] `dados.timeoutSec` gravado na criação e única fonte lida por processor, agente e sweeper; placeholder PROMPT coerente (1800s).
- [ ] Corrida sweeper×callback resolvida por CAS com `audit.outcome.source`; callback×callback idempotente por CAS (DVFS 7 não roda 2x).
- [ ] 409 PROJECT_BUSY → QUEUED + retry com backoff (teto 10 tentativas) → `PROJECT_BUSY_EXHAUSTED`.
- [ ] Execução duplicada da mesma task bloqueada em REST, MCP e Nexus (409 / `execution_in_progress`).
- [ ] `baixado=true` em todos os terminais (SUCCESS, FAILED, REJECTED, EXPIRED) + backfill idempotente com dry-run/rollback.
- [ ] `failExecution` tira a task de EXECUTING.
- [ ] ZERO tabela nova, ZERO DClasse nova, ZERO endpoint novo; build e testes verdes.

**Testes obrigatórios (unit, Jest, mocks de Prisma no padrão `devari-backend-patterns §16`):**
1. Sweeper: vencido por deadline → `TIMEOUT_NO_CALLBACK`; agente reiniciado → `AGENT_RESTARTED`; não vencido → nada; `timeoutSec` ausente → fallback 1800; RETURNING vazio → zero eventos; task já movida por humano (READY) → não sobrescreve; reentrância bloqueada.
2. Corrida: (a) callback antes → sweeper 0 linhas; (b) sweeper antes → callback aplica + `supersedes` + task FAILED→DONE; (c) callback 2x → 2º `alreadyPersisted`, DVFS 7 1x; (d) duas réplicas do sweeper → eventos só da vencedora.
3. 409 retry: 1º 409 → `devolverParaFila` + `enqueueRetry` com delay 30s e jobId `-busy-1`; 10º → FAILED `PROJECT_BUSY_EXHAUSTED`; outros HTTP (403/422/500) → FAILED imediato; task não vai a EXECUTING em 409.
4. Processor: task movida só após ACK e só se ainda -518; `markRunning` não sobrescreve execução com `audit.outcome`; CAS perdida por duplicata → `DUPLICATE_TASK_EXECUTION`.
5. `ExecutionsService.execute`: task com execução não-terminal → `ConflictException`; zumbi legado (`baixado=false` + statusCode terminal) não bloqueia.
6. MCP tool + capability Nexus: mapeamento do 409; capability chama `assertTaskNotLockedByOther`.
7. `RemoteExecutionClient`: 409 com body `{errorCode:'PROJECT_BUSY'}` → `RemoteAgentHttpError{status:409, errorCode}` e `instanceof ServiceUnavailableException`.
8. Agente (`agent/__tests__`): processo que ignora SIGTERM recebe SIGKILL após grace; mutex liberado.
9. `resolveExecutionTimeoutSec`: clamp 30..3600, default 1800.
10. Supersede único: sweeper → callback A (aplica, `supersedes`) → callback B (0 linhas, `alreadyPersisted`). Backfill `BACKFILL_STALE` → callback aplica (mesma regra).
11. `encerrarPorFalhaSistemica` grava `claude.finishedAt` e `exitCode=-1`; `serializeExecution` do resultado ⇒ `deriveStatus` do frontend daria `failed` (assert no shape do DTO).
12. Métodos de desfecho não alteram `dados.risk` nem chamam `calcula()` (spy) — guarda da Task 1 não re-executa.

### SHOULD HAVE
- [ ] Detecção precoce `AGENT_RESTARTED` via heartbeat (incluída no MUST do sweeper se o Reviewer não vetar o subquery; senão vira follow-up).
- [ ] `dados.dispatch.{busyAttempts,nextAttemptAt}` visível no `ExecutionResponseDto` (aditivo).
- [ ] Contribuição ao template Devari-Core documentada no ADR-V2-082.

### COULD HAVE
- [ ] Frontend exibir `reason` da falha (ex.: "IA não respondeu em 35 min") — F-2 do §4, frontend-only.
- [ ] Sweeper também para QUEUED/APPROVED órfãos (job perdido no Redis) com `DISPATCH_NEVER_STARTED`.
- [ ] Callback emitir também `execution.completed|failed` (unificar consumidores) — decisão de produto.

### WILL NOT HAVE
- Rota de status/reconciliação no agente (abordagem B) e comando `CANCEL_EXECUTION` (matar o claude remoto quando o backend desiste).
- Mover `markRunning` para o Engine (desvio Pilar 1 sinalizado; follow-up).
- Processor para modo sem Redis (`InMemoryQueueService`).
- Índice parcial novo / qualquer migration de schema.
- Fechar workSessions em FAILED (comportamento atual mantido; status é o gate).

---

## Perguntas abertas (CEO)

Nenhuma. P1-P4 decididas em 2026-11-23 (tabela do §0). Dependência externa (não é pergunta): o plano da Task 3 deve considerar a Fase 9 (SIGKILL em `agent/src/claude-code/runner.ts`) e a sequência da Fase 13.

---

**Handoff para Implementer:**

1. Ler este plano (§0 primeiro) + `OperacaoExecucaoClaude.ts:548-675`, `execution-run.processor.ts` inteiro, `agents.service.ts:608-795`, `approval-flow-sweeper.service.ts` (padrão a copiar).
2. Ordem: Fase 10a (corrigir drift das 3 specs) → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 9 → 10 (testes junto de cada fase) → 11 → 13 (runbook).
3. Partir de `main` (Task 1 já em `277afb0`). **Não tocar** `calcula()`/`_aplicarGuardasModoPrompt`/`_elevarRisco`/`_lerPisoModoPrompt` nem o bloco `risk` de `IExecucaoData`; preservar o JSDoc ADR-V2-081 em `resolveCommandAndPrompt`.
4. Não rodar backfill em prod; só gerar e testar em dev (`--dry-run`, `--apply`, `--close-stale-running`, `--release-tasks`, `--revert` em base local).
5. Frontend (F-1/F-3 do §4) é task separada no repo `scrumban/frontend` — a conversa principal despacha após o backend aprovado (gate Reviewer ≥ 8.5).
5. Comandos:

```bash
# backend
cd /Users/devaritecnologia/Documents/Benedito/scrumban/backend
npx jest src/executions src/automation/agents src/mcp/tools src/common/tool-capabilities
make build

# agente (monorepo, PR único — ADR-V2-036)
cd agent && npm test && npm run build && npm run lint

# backfill (dev)
npx ts-node prisma/scripts/backfill-execution-baixado.ts --dry-run
npx ts-node prisma/scripts/backfill-execution-baixado.ts --apply
```

6. Commit sugerido: `fix(executions): encerra execucoes presas e reenfileira project busy` (body por fase + testes).

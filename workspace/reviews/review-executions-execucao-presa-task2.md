# Review Report: Task 2 — Execuções presas em RUNNING (V2 F13/F6) — Ciclo 3 (re-review incremental)

**Reviewed by:** Reviewer Agent V2
**Date:** 2026-11-23
**Escopo:** campo `outcome {reason, source}` no `ExecutionResponseDto` + códigos canônicos (novo `TUNNEL_UNAVAILABLE`)

---

## Resultado Final (atual)

### APPROVED — Score: 9.0/10

Mudança pequena, bem contida e testada; nada sensível exposto, lista fechada e compatível com outcomes antigos. Apenas ressalvas LOW.

## Testes Automatizados
- Build: PASS
- TypeScript: 67 = baseline; 0 em arquivos tocados (backfill checado isoladamente: 0 erros)
- ESLint (arquivos tocados): 0 errors, 0 warnings
- Jest (executions, automation/agents+runtime, engine, filters, tool-capabilities, execute-task.tool): 758/759; a única falha é o teste de tempo `<50ms` da Task 1 (`risk-gate-natural-language`), mesma flakiness de carga já analisada (passa isolado, 169/169; arquivo não tocado).

## Verificação objetiva

- **Nada sensível exposto — OK.** `toOutcome()` é whitelist: devolve apenas `{reason, source}`. `reason` só é preenchido se `source==='system'` E `isExecutionFailureReason(reason)`; texto livre, `ECONNREFUSED`/`TUNNEL_TIMEOUT`, stderr, `supersedes`, `recordedAt` e `errorCode` não saem pelo outcome (teste verifica `Object.keys`). O detalhe técnico do túnel continua apenas em `claude.stderr` (exposição pré-existente, inalterada).
- **Lista fechada — OK.** `EXECUTION_FAILURE_REASON_CODES = Object.values(EXECUTION_FAILURE_REASONS)` (8 códigos), usada no enum do Swagger e no type guard; teste de contrato fixa a lista exata. Valor fora da lista vira `null`.
- **Pontos de falha gravam código canônico — OK.** Processor: todas as 6 chamadas de `failExecution` passam por `reason: ExecutionFailureReason` tipado (default `DISPATCH_FAILED`; túnel -> `TUNNEL_UNAVAILABLE`; 409 esgotado; duplicata) — impossível passar string livre em compile-time. Sweeper: `TIMEOUT_NO_CALLBACK`/`AGENT_RESTARTED`/`QUEUE_STALE` agora importados das constantes. Backfill: `BACKFILL_STALE` importado. Não há outro escritor de `source:'system'` (grep: único ponto é `sqlDadosFalhaSistemica`, alimentado por esses chamadores).
- **Compatibilidade com outcomes antigos — OK.** Sem outcome -> `{null,null}`; legado sem `source` -> `{null,'agent'}` (só o callback gravava outcome antes da ADR-V2-082); campo é aditivo (`ApiProperty` obrigatório, sempre presente), todos os produtores passam por `serializeExecution` (histórico, aprovação, controller, agents). Sem mudança de schema/migration.
- **Zona da Task 1 — intocada.** Diff do Engine: apenas import das constantes e as 3 constantes de motivo do sweeper.
- **Testes — OK.** +20 (contrato do DTO) +9 parametrizados no processor (cada falha -> 1 código canônico + `execution.failed{reason,errorCode}`) +1 race ponta a ponta (`null/null` -> `TIMEOUT_NO_CALLBACK/system` -> `null/agent`); mutações reportadas falham os testes.

## Issues Encontrados
**CRITICAL / bloqueantes:** None. **MEDIUM:** None.
**LOW:**
- L12 O Engine passou a importar de `src/executions/constants` (dependência de camada Engine -> módulo de domínio); aceitável por serem constantes puras sem imports, mas considerar mover a lista para `src/engine/` ou `src/common/` se o acoplamento crescer.
- L13 `encerrarPorFalhaSistemica(params.reason: string)` no Engine segue aceitando string livre; a garantia de canonicidade é só do processor. Tipar como `ExecutionFailureReason` fecharia a API pública.
- L14 `source` legado sem campo vira `'agent'` mesmo que, hipoteticamente, um outcome antigo fosse sintético — improvável (nenhum caminho antigo gravava outcome sintético).
- Mantidos do Ciclo 2: L8, L9, L10, L11 (validar SQL em staging), L6.

**Score Final:** 9.0/10

## Decisão: APPROVED

**Próximo:** Documenter (atualizar ADR-V2-082 já inclui seção do Ciclo 3) e commit.

---

# Histórico — Ciclo 2 — Review Report: Task 2 (re-review)

**Reviewed by:** Reviewer Agent V2
**Date:** 2026-11-23
**Module:** executions (toca engine, automation, mcp, common, agent/)

---

## Resultado Final (atual)

### APPROVED — Score: 8.9/10

M1, M2 e M3 do Ciclo 1 corrigidos de forma verificável; L1, L2, L3, L4, L5 e L7 resolvidos. Restam apenas ressalvas LOW. Zona da Task 1 intocada.

## Testes Automatizados (re-executados)
- Build: PASS
- TypeScript: 67 errors = baseline; 0 em arquivos tocados
- ESLint (tocados): 0 errors
- Jest (executions, automation/agents, runtime, engine, filters, tool-capabilities): 716/717. A única falha é o teste de tempo `risk-gate-natural-language` (Task 1, `ms < 50`), que reproduzi falhando sob workers paralelos e passando isolado (169/169). Demais falhas do conjunto amplo (provision, execute-task.integration, tasks.*, update-timer, tenant-scope, mcp-block-d, ttl-cache, notification.consumer) estão em arquivos sem diff desta task e já falhavam no Ciclo 1 / baseline.
- agent/: 222/222, build OK, lint OK

## Verificação objetiva do Ciclo 2

**M1 — advisory lock: OK.**
- `markRunning`: `$transaction` que executa `pg_advisory_xact_lock(hashtext('exec-task:'||taskId))` e o UPDATE com NOT EXISTS no MESMO `tx`; sob READ COMMITTED o statement seguinte tira snapshot novo, então a 2ª transação enxerga o RUNNING commitado. `taskId` vem de `dados.task.id` (string), a chave é gerada por `executionTaskLockKey` único para os dois pontos. Sem taskId, sem lock.
- `execute`/`withTaskLock`: lock numa tx dedicada; `assertNoActiveExecutionForTask` e o Engine usam `this.prisma` (outras conexões) e COMMITAM antes de a tx do lock terminar, logo o 2º request vê a execução do 1º e recebe 409. Correto.
- Deadlock: não há ciclo (o lock é a 1ª instrução; o holder do `execute` não espera `markRunning`; o sweeper usa `SKIP LOCKED` e não pega advisory). `hashtext` colide apenas gerando serialização extra, nunca incorreção.
- Pool: o lock do `execute` segura 1 conexão enquanto o Engine usa outras. Se N requests simultâneas da MESMA task >= tamanho do pool, o holder pode não achar conexão (P2024 em ~10s), a tx cai e o lock é liberado — degrada, mas se recupera; risco baixo (rate limit 30/min por projeto, só requests com taskId, só mesma task). Aceitável; registrado como L8.
- `timeout` 60s da tx: se `fn` excedesse, a tx expira e o lock cai com a criação já feita (cenário remoto; Risk Gate/INSERT são ms).

**M2 — marcador `v3.movedBy`: OK.** `updateStatus` reescreve `v3` inteiro em TODA transição com `movedBy: dto.movedBy ?? null` (tasks.service.ts ~L1450), então qualquer movimentação posterior (humano, outra execução, cascata) apaga o marcador — o critério não "gruda". `TaskResponseDto.dados` expõe `v3`, então `findOne` enxerga o marcador. Promoção só se EXECUTING ou (FAILED com marcador desta execução). Sweeper: pré-checagem de `audit.outcome` (1 findMany), libera com marcador, pós-checagem e compensação para DONE (2 findMany no total, sem N+1); qualquer intercalação sweeper x callback converge para DONE. Ressalva L9: `movedBy` é aceito do cliente no DTO REST; um usuário poderia forjar `system:execution-<id>` — impacto desprezível (apenas permitiria a promoção a DONE por callback legítimo daquela execução).

**M3 — QUEUE_STALE 900s: OK.** Referência = `GREATEST(atualizadoEm, dispatch.nextAttemptAt)`; `devolverParaFila` grava `atualizadoEm=NOW()` e `nextAttemptAt`, e o backoff máximo é 300s < 900s, então um retry de 409 legítimo só vira stale 900s DEPOIS do próximo dispatch previsto. APPROVED: `approve` faz `atualizadoEm=NOW()` no mesmo UPDATE que enfileira. Fila cheia: o job só segura worker durante o ACK (<=30s, concurrency 3), então 900s é folga ampla. UPDATE re-confere `statusCode = alvo.status_code` (markRunning concorrente tira a linha do lote) e `markRunning` exige `outcome IS NULL` (não ressuscita QUEUE_STALE). Único caso de falso positivo: backend/worker parado >15min com jobs pendentes — o job tardio é ignorado como stale e o usuário pode redisparar (falha rápida e explícita, aceitável).

**L1** `execution.started` só após o ACK: OK (efeito colateral LOW: com callback ultrarrápido `finished` pode preceder `started`). **L2** `runtime.finishedAt` real no supersede: OK. **L3** `errorCode` canônico: OK. **L4** `.gitignore` + `mode 0o600`: OK (`git check-ignore` confirma). **L5** whitelist `DETAILS_PASSTHROUGH_CODES={EXECUTION_IN_PROGRESS}`: OK, com teste. L6 mantido como follow-up.

**Zona da Task 1:** hunks do Engine seguem restritos a imports, `registrarOutcome` e métodos novos; `calcula()`, guardas e `dados.risk` intocados; nenhum arquivo em `src/engine/dvfs` ou `src/executions/services` modificado.

**Teste de tempo da Task 1:** flakiness aceitável para esta task — o arquivo não foi tocado, não depende do código novo, passa isolado (169/169) e em `--runInBand` (242/242 relatado) e falha apenas por contenção de CPU (melhor de 3 execuções ainda >50ms com muitos workers). Recomendação (não bloqueante, fora do escopo): rodar `src/engine/dvfs` com `--runInBand` no CI ou subir o limiar para ~150ms.

## Issues Encontrados
**CRITICAL / bloqueantes:** None.
**MEDIUM:** None.
**LOW:** L8 pool exhaustion sob rajada de requests da mesma task (documentado pelo Implementer); L9 `movedBy` forjável via REST (impacto desprezível); L10 ordem `started`/`finished` com callback ultrarrápido; L11 semântica SQL (advisory lock real, ramo QUEUE_STALE) só provada em Postgres — validar em staging antes do deploy (sem banco nesta revisão); L6 SIGKILL só no PID (follow-up).

**Score Final:** 8.9/10

## Decisão: APPROVED

**Próximo:** Documenter (formalizar ADR-V2-082 e commit).

---

# Histórico — Ciclo 1 — Review Report: Task 2 — Execuções presas em RUNNING (V2 F13/F6)

**Reviewed by:** Reviewer Agent V2
**Date:** 2026-11-23
**Module:** executions (toca engine, automation, mcp, common, agent/)

---

## Resultado Final

### APPROVED — Score: 8.6/10

CAS/condicionais SQL corretas (sweeper x callback, substituição única do FAILED sintético, markRunning não regride terminal); zero bloqueantes. Ressalvas MEDIUM (M1-M3) recomendadas antes do deploy conjunto.

---

## Testes Automatizados
- Build (`npm run build`): PASS
- TypeScript: 67 errors = baseline. Nenhum em arquivo tocado (tenant-isolation.adversarial, telegram handlers x3, ttl-cache, notification.consumer, update-timer.integration, tasks.service.spec — todos intocados)
- ESLint (arquivos tocados): 0 errors, 25 warnings (no-explicit-any, quase todos pré-existentes)
- Jest (executions, automation, engine, filters, mcp, tools, tasks): 502/504 nas suítes da task; falhas restantes verificadas em worktree limpa de HEAD:
  - `provision.service.spec` (1): falha idêntica em HEAD — pré-existente
  - `execute-task.integration.spec` (2: I-3, I-bonus2): em HEAD a suíte NÃO COMPILAVA (TS2352). O Implementer só adicionou `as unknown as` (2 linhas), o que fez a suíte rodar e expôs 2 falhas do roteador MCP (NotFound/Forbidden viram erro JSON-RPC em vez de rejeitar). Não decorrem da task (sem relação com o diff de execute-task). Confirmado.
  - tasks.* / update-timer: falham igual em HEAD — pré-existentes
- agent/: `npm test` 222/222, `npm run build` OK, `npm run lint` OK

## Validação 3 Pilares
- Pilar 1: OK. Novos UPDATEs raw de desfecho vivem no Engine (`registrarOutcome`, `encerrarPorFalhaSistemica`, `devolverParaFila`, `encerrarVencidas`). Desvio herdado: `markRunning` raw no processor (já sinalizado pelo Implementer). Diff do Engine toca só `registrarOutcome` + métodos novos + imports/tipos; `calcula()`, guardas e `dados.risk` da Task 1 INTOCADOS.
- Pilar 2: OK (sem controller novo). Pilar 3: N/A (sem seed).
- ZERO tabela/coluna nova (sem diff em prisma/schema; sem migration). Backfill é DML, não DDL.

## Análise por foco

1. **CAS SQL** — OK, sem erro jsonb/BigInt/condição que nunca case.
   - `registrarOutcome`: WHERE `outcome IS NULL OR source='system'`; CASE usa `dados` antigo (supersedes), RETURNING usa novo. Após substituir, source='agent' => qualquer callback seguinte acha 0 linhas => DVFS 7 roda no máx. 1x e só com `applied`. Outcome legado sem `source` => não casa (tratado como já persistido) — correto. Sob corrida (callback aguardando lock do sweeper) o re-check READ COMMITTED reavalia e substitui — correto.
   - `markRunning`: `audit.outcome IS NULL` impede sobrescrever terminal. `NOW()::text` já era assim em HEAD e é parseável por `::timestamptz`.
   - `sqlDadosFalhaSistemica`: jsonb_set aninhado correto; ISO UTC; `dados` não ambíguo no UPDATE..FROM alvo.
   - Trava de duplicata: ver M1.
2. **Sweeper** — OK. Prazo = `COALESCE(startedAt, atualizadoEm) + timeoutSec|1800 + 300s`; 1 UPDATE..FROM(SELECT..FOR UPDATE SKIP LOCKED) em lote (multi-réplica seguro, só quem recebe RETURNING emite eventos); leitura de tasks em 1 findMany; guarda de reentrância; registrado independentemente de Redis (cron + ScheduleModule global). Restart: `lastSeen − uptime` (lastSeen = relógio do backend; uptime = `process.uptime()` do agente, segundos) > `startedAt + 60s`; sem skew de fuso (timestamptz/UTC). Falso positivo só se heartbeat omitir `uptime` (DTO opcional, mas o agente sempre envia) — LOW.
3. **409 PROJECT_BUSY** — OK. `RemoteAgentHttpError` é subclasse de ServiceUnavailable (callers antigos intactos); backoff 30→60→120→240→300 (teto), 10 tentativas, depois FAILED `PROJECT_BUSY_EXHAUSTED`; `devolverParaFila` com CAS (-518 + sem outcome); falha de re-enqueue vira FAILED (não fica QUEUED eterno); jobId único `${id}-busy-${n}` (sem `:`). InMemoryQueue: no-op por paridade — sem Redis não há processor (fora de escopo, ver M3).
4. **Terminais** — OK: baixado=true, claude.finishedAt, exitCode=-1, outcome source='system'; task só sai de EXECUTING se ainda EXECUTING (sweeper filtra por `v3.state`; processor via findOne). Reject/Expire também baixam.
5. **HttpExceptionFilter `details`** — OK. grep em src/ (não-spec): o ÚNICO produtor de `details` em exceções é `ExecutionsService.assertNoActiveExecutionForTask` (executionId/status/reason — dados não sensíveis, já visíveis ao membro do projeto). Nenhuma outra exceção do sistema passa `details`, logo nada novo vaza hoje. Exceções cruas continuam 500 genérico. Risco futuro: repasse genérico de qualquer `details` objeto — recomendação L5.
6. **agent/runner.ts** — OK: SIGTERM + SIGKILL após 15s, `settled`, timers limpos, callback do execFile libera o mutex; testes com `killGraceMs` injetável. 222/222.
7. **Backfill** — OK: dry-run por padrão (sem `--apply` zero escrita), idempotente, sem eventos, transação única, snapshot antes de escrever + `--revert` (só reverte linhas ainda `BACKFILL_STALE`), mesmo SQL do sweeper. Não foi executado. Ressalva L4.
8. **Engine Task 1** — intocado conforme item acima.

---

## Issues Encontrados

**CRITICAL / bloqueantes:** None.

**MEDIUM**

- **M1 — Anti-duplicata do `markRunning` não é atômica** (`src/executions/processors/execution-run.processor.ts`, `markRunning`, NOT EXISTS ~L340-380). Sob READ COMMITTED, duas execuções da mesma task (as 2 requests simultâneas que passaram pelo `assertNoActiveExecutionForTask`) em markRunning concorrente não enxergam o RUNNING não-commitado uma da outra (write skew) -> ambas viram RUNNING. Convergência garantida só por acaso: o mutex do agente por slug responde 409 PROJECT_BUSY à segunda, que volta à fila e é então derrubada como DUPLICATE_TASK_EXECUTION. Correção: serializar por task, p.ex. `pg_advisory_xact_lock(hashtext('exec-task:'||taskId))` num `$transaction` que envolva o UPDATE (ou `SELECT ... FROM "DTask" ... FOR UPDATE`). Ajustar o JSDoc ("atômica") enquanto não corrigido.
- **M2 — Corrida sweeper x callback tardio deixa task FAILED com execução SUCCESS** (`agents.service.ts` `transitionLinkedTask` + `execution-running-sweeper.service.ts` `releaseLinkedTasks`). Se o callback substitui o sintético entre o UPDATE do sweeper e a liberação da task, a task ainda está EXECUTING -> callback não promove (só promove se FAILED) -> sweeper depois move EXECUTING->FAILED. Janela estreita, mas gera estado incoerente permanente. Correção: no supersede+success promover a DONE se status ∈ {EXECUTING, FAILED}; e/ou o sweeper reler `audit.outcome.source` das execuções antes de `updateStatus(FAILED)`.
- **M3 — Sem saída para execução presa em QUEUED/APPROVED** (`executions.service.ts` `assertNoActiveExecutionForTask`). O sweeper cobre só -518; -514/-516 órfãos (job perdido/flush do Redis; `REDIS_ENABLED=false` não tem processor) agora bloqueiam a task com 409 para sempre (antes era possível redisparar). Correção: estender o sweeper a QUEUED/APPROVED vencidos (`nextAttemptAt`/atualizadoEm + margem) ou ignorar no assert os não-RUNNING muito antigos.

**LOW**
- L1 `execution.started` é re-emitido a cada retry de PROJECT_BUSY (evento duplicado); emitir só após ACK ou deduplicar.
- L2 `registrarOutcome` sobrescreve `dados` inteiro a partir de leitura anterior (padrão pré-existente); no supersede mantém `runtime.finishedAt` do sintético.
- L3 `errorCode = detail` (mensagem livre) em DISPATCH_FAILED — já era exposto em `claude.stderr`; considerar código canônico.
- L4 Snapshot do backfill (`backfill-execution-baixado.<ts>.json`, contém `dados` completos incl. stdout/prompt) é gravado no cwd e NÃO está no `.gitignore`; adicionar ao ignore e orientar permissões 600/descarte.
- L5 Filtro repassa qualquer `details` objeto; considerar whitelist por `code` (ex.: só `EXECUTION_IN_PROGRESS`) para evitar vazamento futuro.
- L6 SIGKILL mata só o PID do `claude`; netos segurando stdio podem atrasar o callback do execFile (usar process group se virar problema).
- L7 Promoção FAILED->DONE por callback tardio pode ocorrer mesmo após nova execução manual falhar (task FAILED por outra execução).

## Checklist 12 itens
Build OK; TS 0 novos; Engine OK; seed N/A; N+1 zero (lotes + 1 query nas travas); PrismaService OK; BigInt OK; transaction (backfill OK; CAS single-statement); TimezoneService N/A (NOW()/timestamptz, justificado); eventos após persistência OK; Pilar 2 OK; genericidade OK.

**Score Final:** 8.6/10

## Decisão: APPROVED

**Justificativa:** Núcleo de corretude (CAS, supersede único, DVFS 7 uma vez, terminais completos, sweeper multi-réplica, backoff, runner, backfill seguro) verificado e testado; falhas jest remanescentes comprovadamente pré-existentes; sem violação de hard gate. M1-M3 não derrubam a integridade (autocorrigem ou têm janela estreita) mas são correções baratas — recomendadas antes do deploy conjunto Task1+2+3.

**Próximo:** Documenter (formalizar ADR-V2-082); Implementer pode endereçar M1-M3 via resume (opcional, sem novo gate).

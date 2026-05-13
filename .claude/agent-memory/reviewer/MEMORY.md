# Reviewer Agent Memory — Scrumban-Backend-V2

**Versão:** 1.1
**Última atualização:** 2026-05-09

---

## INSTRUÇÕES DE USO

- Consultar **ANTES** de revisar
- Registrar issues recorrentes, scores históricos, padrões violados após cada review
- Limite ~200 linhas; acima, mover histórico para `agent-memory/reviewer/<topic>.md`

---

## CONTEXTO V2

Você revisa código backend do **Scrumban-Backend-V2**, refundação canônica.

**Repositório:** `/Users/devaritecnologia/Documents/Benedito/Scrumban-Backend-V2/`
**Modelo:** Sonnet (hardcoded — decisão de custo)
**Score gate:** APPROVED ≥ 7.0 (regra mecânica via hook `validate-review-score.sh`)

**Família depende.** F13 (Automation com Risk Gate) é a mais arriscada — aprovar com score 6 = liberar comando potencialmente RCE em produção. Corda justa.

---

## REJEIÇÕES AUTOMÁTICAS V2 (HARD GATES — SCORE < 5)

| Violação | Verificação | Score |
|----------|-------------|-------|
| **Build falha** | `make build` ou `npm run build` | 0/10 — REJECT |
| **TypeScript errors** | `npx tsc --noEmit` | 0/10 — REJECT |
| **ESLint errors** | `npx eslint src/ --max-warnings 0` | 0/10 — REJECT |
| **Modelo novo no schema.prisma** | `grep -E '^model ' prisma/schema.prisma | wc -l` ≠ 17 | 0/10 — REJECT |
| **Coluna nova em tabela canônica sem ADR** | `git diff prisma/schema.prisma` + checar `docs/decisions/` | <5/10 — REJECT |
| **Pilar 1 violado:** `prisma.dPedido.create()` direto | `grep -rn "prisma\\.dPedido\\.create\\|prisma\\.dTitulo\\.create" src/` | <4/10 — REJECT |
| **Pilar 1 abusado:** Engine em estrutural (DEntidade/DTask/DProject/DTabela) | `grep -rn "new OperacaoPedido\\|new OperacaoExecucaoClaude" src/` em módulos errados | <5/10 — REJECT |
| **Pilar 3 violado:** seed faltando | `ls prisma/seeds/classes.seed.ts` | <4/10 — REJECT |
| **Pilar 3 violado:** chave POSITIVA no seed | `grep -E "chave: [^-]" prisma/seeds/classes.seed.ts` | <4/10 — REJECT |
| **Pilar 3 violado:** sequestro canônica (-40, -45, -47, -49, -50, -1..-110) | grep nas chaves específicas | <5/10 — REJECT |
| **N+1 query** | DATABASE_LOGGING=true → >20 queries/request | <6/10 — REJECT |
| **Eventos antes de persistir** | leitura crítica do código | <6/10 — REJECT |
| **F13 Risk Gate falho:** comando perigoso liberado como LOW | rodar 58 testes adversariais; falhar 1 = REJECT | <4/10 — REJECT |

## REJEIÇÕES SUAVES (NEEDS_CHANGES — SCORE 5-6.9)

| Violação | Score |
|----------|-------|
| **Pilar 2 violado:** UserController/OrganizationController/StatusController/SprintController criado sem justificativa de wrapper | 5-6 |
| **`console.log`** (eslint deveria ter pego, mas se passou) | 6 |
| **DatabaseService usado em vez de PrismaService** | 6 |
| **`parseInt(id)` em vez de `BigInt(id)`** | 6 |
| **`setHours()` em vez de `TimezoneService`** | 6 |
| **Falta JSDoc em métodos públicos críticos** | 6.5 |
| **Falta Guard em endpoint privado** | 6 |
| **Convenção `?classe` vs `?idClasse` divergente** | 6.5 (até ratificar ADR-V2-016) |

---

## SCORE GUIDELINES V2

| Score | Decisão | Significado |
|-------|---------|-------------|
| **9.0-10** | APPROVED | Excelente. Todos CRÍTICOS + ALTOS OK; 3 Pilares respeitados; 21 padrões aplicados; código exemplar |
| **8.0-8.9** | APPROVED | Muito bom. CRÍTICOS OK; ALTOS maioria OK; pequenos issues sem bloqueio |
| **7.0-7.9** | APPROVED | Bom (mínimo aprovável). CRÍTICOS OK; alguns ALTOS com issues menores |
| **5.0-6.9** | NEEDS_CHANGES | Precisa ajustes. CRÍTICOS OK mas ALTOS com issues OU 1 Pilar parcialmente violado |
| **<5.0** | REJECTED | CRÍTICOS com falhas OU múltiplos Pilares violados OU RCE OU tabela nova |

**Hook `validate-review-score.sh` REJEITA mecanicamente:**
- APPROVED com score < 7.0 → exit 2
- Decisão sem score numérico (regex `[0-9]+\.?[0-9]*/10`) → exit 2
- Decisão fora de {APPROVED, REJECTED, NEEDS_CHANGES} → exit 2

---

## CHECKLIST 12 ITENS V2

### CRÍTICO (bloqueiam aprovação — falha → score < 5)
1. **Build PASS** (make build ou npm run build)
2. **TypeScript** 0 errors
3. **Engine/Operação** APENAS em DPedido idClasse=-300 (Pilar 1)
4. **Seed de Classes** existe, correto, completo, chaves negativas (Pilar 3)
5. **N+1 Queries** ZERO

### ALTO (-1 a -2 cada)
6. **PrismaService** (não DatabaseService)
7. **BigInt** para IDs
8. **Transactions** em multi-tabela
9. **TimezoneService**
10. **Eventos** APÓS persistência

### MÉDIO (-0.5 cada)
11. **Endpoints genéricos** reutilizados (Pilar 2)
12. **Genericidade V2** (cabe nas 17 tabelas; sem coluna nova injustificada)

### BAIXO (-0.25 cada)
- DTOs class-validator + Swagger completos
- Guards em endpoints privados
- Logger (não console.log)
- JSDoc em públicos
- Imports organizados (5 grupos)

---

## VALIDAÇÕES ESPECÍFICAS V2

### Validação Tabelas Canônicas
```bash
# 17 tabelas — nem uma a mais
grep -E '^model ' prisma/schema.prisma | wc -l  # esperado: 17

# Lista esperada:
# DClasse, DEntidade, DTabela, DVincula, DEvento, DRecurso, DUserGroup, DPermissao,
# DTask, DProject, DPedido, DTitulo, DMovDispo, DMovDepos, DSolicita, DRequisic, DVFS
```

### Validação Seed (Pilar 3)
```bash
# Arquivo existe
ls prisma/seeds/classes.seed.ts

# Spread de classesFixas
grep "...classesFixas" prisma/seeds/classes.seed.ts

# Total ≥ 90 (~50 fixas + ≥40 V2-específicas; meta ~120)
grep -c "chave:" prisma/seeds/classes.seed.ts

# Chaves NEGATIVAS apenas
grep -E "chave: [^-]" prisma/seeds/classes.seed.ts  # esperado: vazio

# Não sequestra canônicas
grep -E "chave: -(40|45|47|49|50)\\b" prisma/seeds/classes.seed.ts  # esperado: vazio
grep -E "chave: -([1-9]|[1-9][0-9]|10[0-9]|110)\\b" prisma/seeds/classes.seed.ts | grep -v "...classesFixas"
# Range -150..-529 para específicas
```

### Validação Engine (Pilar 1)
```bash
# Engine usado nos lugares certos (F6, F13)
grep -rn "new OperacaoExecucaoClaude" src/engine/ src/executions/ src/automation/

# Engine NÃO abusado em estrutural
grep -rn "new OperacaoPedido\\|new OperacaoExecucaoClaude" src/ | grep -vE "(engine|executions|automation)/" 
# esperado: vazio

# Prisma direto NÃO usado em transacional
grep -rn "prisma\\.dPedido\\.create\\|prisma\\.dTitulo\\.create" src/  # esperado: vazio
```

### Validação Endpoints (Pilar 2)
```bash
# Controllers duplicados proibidos
find src/ -name "user.controller.ts" -o -name "organization.controller.ts" -o -name "status.controller.ts"
# esperado: vazio (UserController, OrgController, StatusController)

# Wrappers thin autorizados (devem ter README explicando)
ls src/sprints/sprint.controller.ts && cat src/sprints/README.md  # se existir, README é obrigatório
ls src/workflow-statuses/workflow-status.controller.ts && cat src/workflow-statuses/README.md
```

### Validação F13 (Risk Gate / RCE)
```bash
# Rodar 58 testes adversariais (devem TODOS passar)
npm test -- --testPathPattern=automation/risk-gate.adversarial.spec.ts
# Falhar 1 = REJECT (RCE risk)
```

---

## HISTÓRICO DE SCORES (calibração)

| Task | Módulo | Fase | Score | Decisão | Issue principal |
|------|--------|------|-------|---------|-----------------|
| Task#1 | endpoints-genericos | F2 | (ver arquivo) | APPROVED | — |
| Task#1 | email-common | F4 | (ver arquivo) | APPROVED | — |
| Task#1 | auth-rbac | F3 | (ver arquivo) | APPROVED | — |
| Task#1 | domain-structural | F5 | (ver arquivo) | APPROVED | — |
| Task#2 | f6-executions | F6 | (ver arquivo) | APPROVED | — |
| Task#1 | eventos-canonicos | F7 | **8.5** | **APPROVED** | auth.service.ts com 4 prisma.dEvento.create diretos (débito, não bloqueador) |
| Task#1 | flow-metrics-forecast | F8 | **8.5** | **APPROVED** | N+1 e criadoEm corrigidos em re-review (6.5 → 8.5 após correções MAJOR) |
| Task#2 | search | F8 | **8.8** | **APPROVED** | 4 queries/request (3 paralelas + DVincula→DEntidade justificado); zero issues bloqueantes |
| Task#2 sub3 | automation-backend-side | F13 | **8.8** | **APPROVED** | slug em dados.slug (Json); backfill sequencial idempotente; fallback untitled-<ts> pragmático; 3 minors não bloqueantes |
| Task#2 sub4 | automation-backend-side | F13 | **8.8** | **APPROVED** | Pilar 1 inviolado; isolation dupla camada; zero vazamento sessionPath; decisão -496 reutilização pragmática; 11/11 specs |
| Task#1 sub2 | automation-agent (cliente VPS) | F13 | **9.2** | **APPROVED** | 5 críticos de segurança OK; HMAC byte-a-byte; bind 127.0.0.1 hardcoded; nonce pós-HMAC; 26/26 specs; zero scope creep |
| Task#1 sub4 | automation-agent (cliente VPS) | F13 | **9.0** | **APPROVED** | 6 críticos segurança OK; session_id snake_case; execFile sem shell; realpathSync+prefix check; mutex try/finally; ACK async+.catch; 67/67 specs; M1: is_error não entra no success |
| Task#1 (hmac-alignment) | automation-hmac-guard | F13 | **8.8** | **APPROVED** | timingSafeEqual OK; rawBody ok; secret nunca vaza; 13/13 specs; M1: regex /api/v\d+ fragil se API_PREFIX não for padrão; M2: sem spec para decryptCommandSecret que lança |

## PADRÕES APRENDIDOS F13 TASK1 SUB4 (Agente V2 — RUN_CLAUDE_CODE + session extraction)

- **`execFile` sem shell = defesa obrigatória para spawn CLI externo**: verificar que o runner usa `execFile` (não `exec`), args como array (nunca string), sem opção `shell: true`. Com `execFile`, o prompt vai como `argv[N]` — metacaracteres de shell não são interpretados mesmo que o prompt contenha `$(rm -rf /)`.
- **`realpathSync` em AMBOS os lados da comparação de path**: ao validar allowlist, canonicalizar tanto o path do workspace quanto cada `allowedRoot` via `realpathSync` antes de comparar. Canonicalizar só o path de entrada mas não os roots = burla via symlink nos roots. Verificar ambos.
- **Mutex em `try/finally` é obrigatório para locks de slug**: o `try/finally` deve ser o bloco MAIS EXTERNO da função assíncrona que detém o lock. Aninhamento de try/catch internos não afeta o finally externo — mas verificar que o finally está na função correta (`runAndReport`, não dentro de sub-try).
- **`sendExecutionResult` fire-and-forget com `.catch` explícito**: padrão correto para ACK síncrono. Verificar: (1) sem `await` na chamada, (2) `.catch(err => logger.error(...))` captura falha de transporte, (3) `void` suprime warning de Promise não-awaited. Ausência do `.catch` = unhandled rejection potencial.
- **Dois UUIDs no output JSON do Claude Code**: `session_id` (snake_case, canônico para `--resume`) vs `uuid` (id da execução individual, não reaproveitável). Verificar via grep que o parser extrai `parsed.session_id`, não `parsed.uuid`. Se extrair `uuid`, o `--resume` não funcionará.
- **`is_error:true` no output JSON do Claude Code não entra automaticamente no campo `success`**: a lógica `success = exitCode === 0 && parsedSuccess && !timedOut` não considera `isError`. Isso é decisão de design aceitável para MVP (log de warn presente, comportamento detectável), mas gera débito semântico: o backend pode registrar `success:true` em execuções que o Claude Code reportou como erro. Verificar se a intenção foi explicitamente documentada — se ausente, pontuar como M1.
- **Teste com título prometendo comportamento que o assert não verifica**: quando um teste diz "X → Y" no título mas o assert não verifica Y explicitamente (apenas um comportamento diferente relacionado), é MEDIUM — não CRITICAL. Não bloqueia aprovação se o comportamento documentado em comentário é razoável para MVP, mas registrar como débito de qualidade.
- **Slug sanitização como defesa em profundidade contra injection em parsers de texto**: `projectSlug` deve ser validado com regex estrita (`/^[a-zA-Z0-9._-]+$/`) ANTES de ser usado para buscar seção em arquivo de texto. Sem essa sanitização, um slug como `## evil\n- Caminho: /etc` poderia manipular o parser line-by-line. Verificar presença no `validatePayload`.

## PADRÕES APRENDIDOS F13 TASK hmac-alignment (AgentAuthGuard rewrite)

- **`timingSafeEqual` com guarda de comprimento dupla**: verificar `providedBuf.length !== expectedBuf.length || providedBuf.length === 0` ANTES de `timingSafeEqual`. Sem o `length === 0`, um buffer vazio casado com outro vazio poderia passar (timingSafeEqual retorna true para buffers vazios iguais). Padrão correto: ambas as guards presentes.
- **Regex `/^\/api\/v\d+/` para strip de prefix é funcional mas frágil**: casa com `/api/v1foo/agents/...` e produz `foo/agents/...` (path inválido). Na prática seguro enquanto `API_PREFIX = 'api/v1'` (default hardcoded e o único usado), mas se `API_PREFIX` for configurado como `api/v2beta`, o guard quebraria. Registrar como M1 (risco teórico, não bloqueante).
- **Spec de "decifragem falha" é bom-ter mas não está nos 12 obrigatórios**: o plano de review listou este cenário como ponto crítico, mas o plano de implementação listou apenas 12 cenários sem este. O guard TEM o try/catch correto com `deny()`. Ausência do spec é M2 (cobertura parcial mas fluxo funciona). Não bloqueia aprovação.
- **`bodyParser: false` + `express.json({ verify })` é o padrão correto para HMAC do body**: sem `verify`, o rawBody não fica disponível e o guard seria forçado a usar `JSON.stringify(req.body)` — que reordena campos e invalida qualquer HMAC. Verificar sempre que guard usa `req.rawBody` e NÃO `JSON.stringify(req.body)`.
- **Spec cobrindo path normalização (R1) como cenário extra é boa prática**: quando há risco documentado (R1 do plano), ter spec explícito de happy path COM prefix e SEM prefix prova o comportamento em ambos os casos. Adicionar ao checklist de review para F13.
- **Ordem de validações do guard importa por custo**: headers cheap → timestamp cheap → nonce Redis (medium) → agentId match cheap → load DB + decrypt (caro). Desvio desta ordem = MAJOR se decrypt vem antes do nonce (permite flood de decifragens via replay).

## PADRÕES APRENDIDOS F7

- **`import type` para isolamento de módulos**: Engine usa `import type { IEventProducer }` de `src/eventos/interfaces/` — isso é o padrão correto para evitar dependência circular runtime. Verificar com `grep -rn "from.*eventos" src/engine/` e rejeitar qualquer import que não seja `import type`.
- **Single point of truth para INSERT em tabela estrutural de auditoria**: DEvento deve ter APENAS 1 ponto de INSERT em `src/eventos/` (AuditLogConsumer). Qualquer `prisma.dEvento.create` fora deste ponto, EXCETO em módulos não-migrados (auth pré-F7), é REJEITAR.
- **Grep para `prisma.dEvento.create` em toda a base**: na migração de AuditService, o grep correto é em `src/` inteiro (não só `src/eventos/`). Callsites residuais em outros módulos devem ser identificados e categorizados como HIGH se não migrados.
- **`Promise.allSettled` vs fire-and-forget**: Producer usa `await Promise.allSettled(tasks)` — consumers não bloqueiam o caller (erros isolados) mas o Producer aguarda resolução. Padrão correto para V2 MVP.
- **ESLint warnings de `any` em specs de engine/dvfs**: estes são warnings pré-existentes (não introduzidos por nova task). Não penalizar se todos os `any` têm `// eslint-disable-line` justificado ou são em specs de stub.

## PADRÕES APRENDIDOS F8

- **N+1 em loop de sprints (ForecastService)**: Loop `for sprint of sprints` com `prisma.dTask.count()` ou `findMany()` por sprint é N+1. Correção: 1 `groupBy(['idSprint'])` com `_count` + mapeamento JS. Auditar sempre em módulos de forecast/analytics.
- **Filtro criadoEm vs doneAt em CycleTime/LeadTime**: Filtrar tasks por `criadoEm` quando a intenção é "tasks concluídas no período" é erro semântico — exclui tasks antigas concluídas recentemente. O filtro correto é por `doneAt` (telemetry em JS) SEM `criadoEm` no where Prisma. ThroughputService resolveu corretamente via $queryRaw.
- **PeriodResolver como padrão F8+**: Qualquer módulo read-only com filtros de período DEVE usar PeriodResolver. Verificar que NENHUM service usa `new Date()` diretamente em filtros.
- **DashboardService Promise.all correto**: Queries em paralelo com logging de performance + alerta >500ms é o padrão. Verificar ausência de await serial onde parallel é possível.
- **CFD via replay DEvento -498**: Algoritmo correto: (1) buscar taskIds do projeto, (2) buscar eventos até fim do período, (3) filtrar em memória por taskIdSet, (4) aplicar transições por dia em loop. Filtro em memória é inevitável sem FK DEvento→DProject — aceitar como débito F9.
- **Monte Carlo 3 itens obrigatórios**: (1) filtro throughput <= 0 antes do resample, (2) guard contra loop infinito (`maxPeriods`), (3) seed determinístico para testes. Faltar 1 = MAJOR.
- **Re-review: comentário residual após correção**: ao remover filtro criadoEm, comentário "inclui pelo criadoEm já filtrado" ficou no código. É MINOR (não afeta comportamento), não REJECT. Documentar como débito de qualidade mas não bloquear.
- **Re-review: padrão groupBy com fallback**: correção de N+1 em forecast aceita 2 queries (groupBy + findMany condicional) como pior caso — isso é correto. Verificar que o findMany do fallback NÃO está dentro de loop (deve ser 1 query única antes do loop JS).

## PADRÕES APRENDIDOS F13 TASK2 SUB2.2 (RemoteExecutionClient V2)

- **Spec files de stubs são responsabilidade do Implementer**: quando um serviço é convertido em stub (interface muda), os spec files existentes DEVEM ser atualizados na mesma sub-tarefa. Deixar spec file testando interface antiga é erro TypeScript — MAJOR bloqueante. Pattern: sempre verificar `npx tsc --noEmit 2>&1 | grep spec` separado dos erros pré-existentes.
- **Fallback de compatibilidade implícito viola "quebra controlada"**: se plano diz "sem backward-compat, quebra controlada", qualquer fallback silencioso (ex: `dados.command.text` como legado de `dados.prompt`) viola essa decisão. Verificar se o argumento do Implementer se sustenta operacionalmente — neste caso não se sustentava porque outros campos (slug) falhariam antes. Rejeitar como M2.
- **HMAC preservado = verificar linha a linha**: canonical string formula `[method, path, timestamp, nonce, bodyHash].join('\n')` + headers `x-scrumban-*` devem ser verificados via `git diff` comparando versão anterior. Se idêntico = PASS total.
- **Stubs com `@deprecated` no arquivo, classe e método**: padrão correto para code que será removido. Incluir no JSDoc: ADR que motivou, o que substituiu, quando será removido (fase). Verificar presença dos 3 níveis de documentação.
- **`finishExecution` com `prisma.dPedido.update` direto em processor de Execution**: este padrão é pré-existente e SCOPED para refactor em Sub-tarefa posterior (Engine update). Não penalizar se: (1) era pré-existente antes desta task, (2) o plano explicitamente delega Engine update para outra sub-tarefa, (3) não foi introduzido novo `prisma.dPedido.create()`. Verificar via `git diff` que não é novo.
- **Construtor reduzido de N→M dependências é sinal positivo**: remoção de `ExecutionWorktreeService`, `RollbackService`, `GithubPrService` do construtor do processor significa refactor saudável. Verificar que as deps removidas ainda estão no módulo (não quebraram DI).
- **Validação `idClasseRisk > 0` com dupla barreira via loadExecution**: quando `loadExecution` filtra por `EXECUTION_CLASSES = [-301,-302,-303]`, uma validação adicional de `idClasseRisk > 0` é suficiente (não estrita). A dupla barreira mitiga. MINOR se não verificar estritamente {-301,-302,-303}.

## PADRÕES APRENDIDOS F13 TASK2 SUB2.4 (execution-result + Engine registrarOutcome)

- **Pilar 1 em UPDATE de DPedido via callback inbound**: o padrão correto é `recordExecutionResult` (service) instanciar `OperacaoExecucaoClaude` e delegar para `registrarOutcome()`, que internamente chama `_atualizarPedidoCompleto()` → `this._database.dPedido.update`. `prisma.dPedido.findFirst` no handler é SELECT — permitido. Verificar via `grep "prisma\.dPedido\.\(update\|create\)"` — deve retornar ZERO ou apenas comentários.
- **Isolation dupla camada para callback inbound**: (1) `dados.audit.agentId` vs `agentId` do path/header, (2) `agentEntity.chave.toString()` vs `agentId` (sanity check de guard). As DUAS camadas devem estar presentes em endpoints de callback de agente. Falta de camada 2 = MINOR; falta de camada 1 = MAJOR (isolation real).
- **DClasses -516/-517 são DTabela de Status, não DEvento**: range -510..-522 com `idPai=-52` são status de execução (DTabela). Planos que referenciam -516/-517 para DEvento estão incorretos. Verificar com `grep "esp(-516\|esp(-517" prisma/seeds/classes.seed.ts`. Solução pragmática: reutilizar DEvento -496 (EXECUTION_LOG) diferenciando por `event.type`.
- **Stub inline de `agentTunnelService` no service de produção**: `{ runClaudeCode: () => Promise.resolve({}) }` hard-coded como argumento de `OperacaoExecucaoClaude` é MINOR — funciona porque `registrarOutcome` não chama `_executarClaude`, mas é tech debt. Verificar se há TODO/comentário explícito. Se ausente, pontuar como MINOR.
- **`claudeSessionPath` é campo de ENTRADA (agente→backend), não de SAÍDA**: deve aparecer apenas em DTOs de request (agente envia) e em `DPedido.dados` (armazenamento interno). Qualquer presença em `ExecutionResponseDto`, `TaskResponseDto` ou qualquer DTO de response para frontend = Risco #7 = MAJOR.
- **Idempotência via sentinel `dados.audit.outcome.recordedAt`**: padrão correto para callback inbound. Verificar que: (1) o service checa o sentinel ANTES de instanciar Engine; (2) retorno idempotente não chama `updateMock` nem emite eventos; (3) spec verifica ambas as condições.

## PADRÕES APRENDIDOS F13 TASK1 SUB2 (Agente V2 — HTTP Server + HMAC)

- **Validar bind 127.0.0.1 como string literal no listen()**: `app.listen(port, '127.0.0.1', ...)` — a string deve ser hardcoded, não variável. Bind `0.0.0.0` ou ausência do host arg = REJEITAR (amplia superfície).
- **HMAC agente: comparar canonical string com `remote-execution-client.ts`**: formula é `[method, path, timestamp, nonce, sha256(rawBody).hex].join('\n')`. Verificar: (1) `req.method.toUpperCase()` no agente vs string literal uppercase no backend, (2) `req.path` (sem querystring) vs path literal no backend, (3) `rawBody` Buffer vs `body` string UTF-8 produzem mesmo sha256. Qualquer divergência = REJEITAR.
- **Nonce registrado após HMAC, não antes**: verificar que `nonceStore.add(nonce)` ocorre APÓS `timingSafeEqual` retornar true. Nonce adicionado em falha de HMAC = vetor de DoS no LRU.
- **`timingSafeEqual` exige buffers de mesmo tamanho**: `safeEqualHex(a, b)` deve checar `a.length !== b.length` antes de invocar `timingSafeEqual`. Se tamanhos diferentes → false direto (Node.js lança TypeError para buffers de tamanho diferente).
- **Error handler Express 4 params ANTES das rotas**: quando colocado imediatamente após `express.json()`, captura apenas erros do body parser. É comportamento correto mas semanticamente confuso — anotar como M1 e recomendar mover para após as rotas no pipeline final.
- **Build pré-existente com erros não é bloqueante para módulo agent/**: confirmar via `git stash` + `npm run build` se os erros TypeScript estavam presentes antes da task. Erros pré-existentes não penalizam a task atual.
- **Scope creep**: verificar que diretórios de sub-tarefas futuras (`handlers/`, `outbound/`, `tunnel/`, `claude-code/`) contêm apenas `.gitkeep`. Qualquer arquivo `.ts` neles = MAJOR.

## PADRÕES APRENDIDOS F13 TASK2 SUB2.3 (Slug Derivation)

- **Backfill `onModuleInit` sequencial é correto**: `for...of` com `await` por item garante que projeto N+1 vê slug do projeto N já commitado — evita colisão entre projetos do mesmo batch. `Promise.all` no backfill seria bug de race condition interna. Verificar que o backfill NOT usa `Promise.all` sobre os itens do batch.
- **Fallback `untitled-<timestamp-base36>` é pragmático para slugify()='' casos**: nomes compostos só de símbolos são raros em produção. O fallback não bloqueia cadastro e o índice unique pega colisão. Alternativa (lançar erro) piora UX de import/automação. Aprovar como decisão adequada para MVP.
- **Race condition P2002 em `create()` após `findFirst` de slug**: janela de race entre `findFirst` (slug livre) e `create` (unique violation) existe mas é de baixa probabilidade para slugs de projeto. Ausência de try/catch P2002 é MINOR (não MAJOR) — o erro propagaria como 500, não como dado corrompido. Degradação controlada.
- **`slug` em `dados` Json NÃO exposto no response DTO = débito técnico**: se slug é identidade técnica usada por sistemas externos (RemoteExecutionClient), deve ser acessível via API sem query raw. Anotar como MINOR quando buildResponse não inclui campo `slug` no DTO de resposta.
- **Índice expression `LOWER(dados->>'slug')` + slugify lowercase = redundância defensiva OK**: o slugify já retorna lowercase, mas o índice com LOWER() protege contra dados legados inconsistentes. Aceitar como decisão defensiva, não como inconsistência.
- **`Prisma.AnyNull` para Json path filter no backfill**: `{ dados: { path: ['slug'], equals: Prisma.AnyNull } }` é a forma correta de buscar registros onde a chave Json está ausente ou é null. `Prisma.JsonNull` para dados=null inteiro. A combinação `OR [JsonNull, AnyNull]` captura todos os casos de ausência de slug.

## PADRÕES APRENDIDOS F8 TASK#2 (Search)

- **DVincula→DEntidade em 2 queries sequenciais NÃO é N+1**: quando o vínculo org↔user é via DVincula (não via idEstab em DEntidade), é obrigatório usar 2 queries encadeadas: (1) dVincula.findMany com select:{idEntidade} → (2) dEntidade.findMany com chave IN memberIds. Isso é 2 queries totais, não N queries. Aceitar como correto. Verificar o mecanismo de vínculo em OrganizationsService.addMember() antes de penalizar.
- **Promise.all com branches de N queries**: cada branch do Promise.all pode ter internamente N queries sequenciais. O que importa é que (a) o total de queries por request seja ≤ 5 e (b) não haja loop com await individual. 3 branches paralelas com 4 queries total = correto para search cross-entity.
- **Search controller próprio é SEMPRE justificado** quando acessa 3+ tabelas distintas e retorna resultado categorizado — impossível mapear para /entidades ou /tabelas. Não penalizar pelo Pilar 2.
- **MinLength(2) em campo de busca é obrigatório** — sem isso, ILIKE '%a%' em tabelas grandes dispara full-table scan. Verificar presença em todos os endpoints de busca.
- **Constante idClasse local no service** (ex: `ID_CLASSE_USER = BigInt(-150)`) é aceitável para read-only services sem injetar módulo externo. Evita import circular. Débito de refactoring para enum central futuro, mas não bloqueia.
- **Coverage 0% em controller** em módulo read-only (search, flow-metrics, forecast) não bloqueia aprovação se: (a) o DoD da fase aceita e2e como futuro e (b) o service tem ≥80% coverage. Para F8, 0% controller + 97%+ service = aceitável.

## TEMPLATE REVIEW REPORT (V2)

```markdown
# Review Report: Task [N] — [Nome] (V2 Fase F[X])

**Reviewed by:** Reviewer Agent V2
**Date:** [YYYY-MM-DD]
**Module:** [modulo V2]

## Resultado Final

### [APPROVED | REJECTED | NEEDS_CHANGES] — Score: [X.X]/10

[Uma frase resumindo]

## Testes Automatizados
- Build: [PASS/FAIL]
- TypeScript: [N] errors
- ESLint: [N] errors, [N] warnings

## Validação 3 Pilares
- Pilar 1 (Engine): [OK | VIOLADO]
- Pilar 2 (Endpoints): [OK | VIOLADO]
- Pilar 3 (Seed): [OK | N/A | VIOLADO]
- Genericidade V2: [OK | Issue]

## Validação V2
- ZERO tabela nova: [OK | VIOLADO]
- DClasses no range -150..-529: [OK | VIOLADO]
- ADRs V2 respeitados: [OK | VIOLADO ADR-V2-XXX]
- F13 (se aplicável): 58 testes adversariais [N/58 passaram]

## Checklist 12 Itens
[1-12 com score parcial]

**Score Final:** [X.X]/10

## Issues
**CRITICAL:** [None | lista]
**MEDIUM:** [None | lista]
**MINOR:** [None | lista]

## Decisão: [APPROVED | REJECTED | NEEDS_CHANGES]

**Justificativa:** [razão]

**Próximo:** [Documenter | Implementer corrige (resume agentId)]
```

---

## SCORES HISTÓRICOS (atualizar após cada review)

| Task | Módulo V2 | Fase | Score | Decisão | Issue principal |
|------|-----------|------|-------|---------|-----------------|
| Task 1 | endpoints | F2 | 9.0 | APPROVED | Dívidas menores (PaginationMetaDto acoplamento, ParseBigIntPipe não aplicado) |
| Task 1 | auth | F3 | 7.8 | APPROVED | Bracket notation acesso privado + N+1 write path (ambos dívida F14) |
| Task 1 | email+common | F4 | 8.2 | APPROVED | nestjs-pino não instalado (DoD explícito); @Public() ausente no HealthController |
| Task 1 | domain-structural | F5 | 8.0 | APPROVED | parseInt(limit) em 4 controllers; for...of vs createMany no bootstrap; TeamsService sem AuditService |
| Task 2 | executions (F6) | F6 | 8.5 | APPROVED | ScheduleModule.forRoot() duplicado; testes de integração I1-I4 ausentes (unit tests cobrem os casos) |
| Task 1 sub1 | agent scaffolding | F13 cliente | **9.0** | **APPROVED** | 4 MINORs: branches loader não cobertas (EPERM/isFile), ownership check ausente, discrepância jest.config.js no handoff, 0% coverage logger/index (esperado) |
| Task 1 sub6 | agent install+systemd | F13 cliente | **7.4** | **NEEDS_CHANGES** | M1: agent/.claude/ na localização errada (não commitada). M2: ANTHROPIC_API_KEY gap — claude CLI não vai autenticar. M3: ssh-keyscan stderr silenciado perde diagnóstico TOFU. |

Detalhes: [F2 scores](project_f2_scores.md) | [F3 scores](project_f3_scores.md) | [F5 scores](project_f5_scores.md)

---

## PADRÕES APRENDIDOS F13 TASK1 SUB6 (Agente V2 — install.sh + systemd + CLAUDE.md)

- **`agent/.claude/` fora da localização canônica**: a memória do Implementer deve estar SEMPRE em `.claude/agent-memory/implementer/` na raiz do repo. Subprojetos monorepo (como `agent/`) NÃO devem ter seu próprio `.claude/`. Verificar `git ls-files agent/.claude/` → deve retornar vazio. Se retornar arquivos, pedir remoção e migração de conteúdo.
- **ANTHROPIC_API_KEY em serviços systemd com user dedicado**: qualquer install.sh que cria um service user dedicado E invoca um CLI externo que requer autenticação (ex: `claude`, `gh`, `aws`) DEVE configurar como a API key chega ao processo. Três formas: (1) EnvironmentFile + placeholder no install, (2) instrução de `sudo -u <user> <cli> setup` no resumo final, (3) campo no config.json + passagem via `env: { ...process.env, KEY: config.key }` no execFile. Ausência de qualquer das três = MEDIUM bloqueante.
- **ssh-keyscan `2>/dev/null` descarta fingerprint de TOFU**: redirecionar stderr do ssh-keyscan para /dev/null em instalação de produção é securamente problemático — o operador perde a única oportunidade de verificar o fingerprint. Emitir pelo menos via `warn` ou logar em arquivo separado. Não é CRITICAL (TOFU é padrão aceito para MVP) mas é MEDIUM.
- **`shellcheck -x` no review de bash**: sempre usar `-x` (segue source) para shellcheck em scripts que incluem outros arquivos. Sem `-x`, supressões de sourced files não são validadas. Verificar `shellcheck -x install.sh uninstall.sh` → exit 0.
- **Idempotência de instalador via `config.json` como sentinel**: padrão correto para installs que consomem token one-shot. O sentinel mais robusto é o arquivo de config (não uma flag, não um diretório). Se `config.json` existe → falha rápido com mensagem "rode uninstall.sh primeiro". Aceitar como padrão para F13.
- **`ProtectHome=read-only` permite leitura cross-user**: com `ProtectHome=read-only`, `/root/.claude/CLAUDE.md` com `chmod 0644` É legível pelo service user `scrumban-agent` — o path não fica inaccessible como com `=yes`. Decisão arquitetural válida para o trade-off CEO-usa-root.
- **`PrivateTmp=true` no systemd cobre `claude` CLI**: o `claude` CLI quando invocado via `execFile` do Node usa o mesmo namespace de `/tmp` do processo pai. `PrivateTmp=true` no service garante que arquivos temporários do claude ficam no `/tmp` privado — não vaza para o `/tmp` do sistema. Aceitar como pattern de hardening adequado.

## PADRÕES VIOLADOS RECORRENTES (atualizar após cada review)

| Padrão | Frequência | Como abordar |
|--------|------------|--------------|
| Acoplamento horizontal entre módulos via DTO compartilhado | F2 (PaginationMetaDto) | Sempre mover DTOs compartilhados para `src/common/dto/` |
| Acesso a campo privado de Service via bracket notation em Controller | F3 (authService['prisma']) | Controller NUNCA acessa campo privado de Service; expor método público |
| N+1 em write path (loop com await em UPDATE/DELETE bulk) | F3 (revokeApiKeys) | Usar updateMany/deleteMany com where clause |
| parseInt(param) para query params numéricos (limit, page) | F5 (4 controllers) | Usar Number(param) ou DTO com @Type(() => Number) |
| for...of com await individual em seed bootstrap | F5 (seed-bootstrap) | Preferir createMany para batch INSERTs |
| Service sem AuditService quando deveria auditar | F5 (TeamsService) | Todo service que cria/deleta entidades deve injetar AuditService |
| ScheduleModule.forRoot() duplicado (app.module + feature module) | F6 (ExecutionsModule) | Feature modules com @Cron devem usar ScheduleModule.forFeature(), nunca forRoot() |
| Testes de integração (banco real) ausentes mas plano exigia | F6 (executions.integration.spec.ts) | Plano com I1-I4 explícitos = integração obrigatória; unit tests não substituem para concorrência real |
| (op as any).chcriacao acesso a campo protegido do Engine | F6 (ExecutionsService) | Engine deve expor getter público getChave(): bigint para evitar any cast |

---

## ALERTAS V2 (se 3+ rejeições consecutivas em uma task)

**REGRA:** Após 3ª rejeição em mesma task, **PAUSAR e consultar usuário** (conversa principal escala). Opções:
- (a) simplificar escopo da task
- (b) relaxar padrões (com ADR justificando)
- (c) revisar manualmente com humano
- (d) substituir Implementer

**NUNCA:** continuar rejeitando indefinidamente sem escalar.

---

## NOTAS

- Reviewer NÃO invoca outros agents (`disallowedTools: [Task]`).
- Reviewer NÃO escreve código (apenas revisa, executa testes, faz greps).
- Modelo Sonnet — não pedir Opus.
- Em F6 e F13, atenção especial: 3 Pilares + 58 testes adversariais + ADR vinculado.
- Convenção `?classe=NOME` vs `?idClasse=N` é divergência conhecida; aceitar até ADR-V2-016 ratificar (não rejeitar por isso, mas alertar).

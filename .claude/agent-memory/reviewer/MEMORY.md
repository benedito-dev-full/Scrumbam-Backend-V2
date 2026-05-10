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

Detalhes: [F2 scores](project_f2_scores.md) | [F3 scores](project_f3_scores.md) | [F5 scores](project_f5_scores.md)

---

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

---
name: f9-v3-flow-telegram
description: Fase 9 ADR-V2-047 — guard PHASE em updateStatus, Flow Metrics by-phase com taskIdsFilter, TelegramNotificationConsumer auto-registrante via EventRouter.registerConsumer
metadata:
  type: project
---

# F9 ADR-V2-047 — V3 + Flow by Phase + Telegram Listener

**Branch:** `feature/dtask-fases-via-idpai`
**Commit anterior:** `0668860` (F8)

## F9a — Guard PHASE em updateStatus (ADR-V2-048)

- `tasks.service.ts:updateStatus` agora bloqueia `task.idClasse === BigInt(-200)` com `BadRequestException` ANTES de qualquer mutação.
- Mensagem: `"Fase não tem status próprio — use GET /tasks/:id/metrics para consultar percent agregado."`
- Swagger no controller: `@ApiResponse({status: 400, description: '... Fase (idClasse=-200) — use GET /tasks/:id/metrics (ADR-V2-048).'})`.
- Quebrou 1 teste pré-existente F8 ("NÃO deve emitir phase.completed se a task que mudou é ela mesma uma PHASE") — adaptado: agora espera `BadRequestException`. Semântica reforçada.

## F9b — Flow Metrics by Phase (6 endpoints)

**Why:** acompanhar % de cycle/lead/throughput/WIP/CFD restritos a tasks-folha de uma fase, sem duplicar lógica nos 6 services.

**How to apply:**
- `PhaseDescendantsService` (`src/flow-metrics/services/phase-descendants.service.ts`): CTE recursiva → `bigint[]` de folhas. Pattern espelhado de `PhaseMetricsService.computeRecursive` (F5). Defense-in-depth: pré-query `findUnique` extrai `idProject` da raiz; filtro aplicado em anchor + passo recursivo. Guardrail `depth < 20` HARDCODED (PG não aceita placeholder em literal).
- `ByPhaseResolverService` (`src/flow-metrics/services/by-phase-resolver.service.ts`): resolve `phaseId → { projectId, taskIds }` validando tenant via `dTask.project.idEstab`. 404 anti-enumeration (idClasse !== -200, soft-deleted, cross-org).
- **Extensão retro-compat** dos 6 services Flow Metrics: cada `calculate()` ganha `taskIdsFilter?: bigint[]` opcional:
  - `undefined` → comportamento idêntico (sem filtro).
  - `[]` (vazio explícito) → resposta zerada sem hit no banco (fase sem descendentes).
  - `bigint[]` → adiciona `chave: { in: taskIdsFilter }` ao where Prisma.
- **Throughput é o caso especial:** usa Prisma.sql + `Prisma.join(taskIdsFilter)` num fragmento condicional via `Prisma.empty` (não use template string!). Refatorei o duplo branch day/week em um único query usando `truncUnit` variável (mais limpo).
- 6 rotas novas em `flow-metrics.controller.ts`: `GET /flow-metrics/by-phase/:phaseId/<metric>`. `@TenantConfig('PROJECT_ESTAB')` da classe faz pass-through (sem `:projectId`/`:id` no path — `org-tenant.guard.ts:134`); tenant é resolvido pelo `ByPhaseResolverService`.
- Dashboard by-phase propaga `taskIdsFilter` aos 5 sub-services via Promise.all. `automationMetricsService.getOverview()` permanece projeto-wide (não passa filtro).

## F9c — TelegramNotificationConsumer (ADR-V2-049)

**Decisão arquitetural crítica:** REUSO de `-494 TELEGRAM_MSG_OUT` (já no seed F1) — NÃO criar nova `-494 TELEGRAM_NOTIFICATION_SENT` (era proposta do plano). Reuso evita pollution + idempotência via `identificadorExterno` é unicidade-suficiente.

**Pattern "um consumer por canal externo de saída":**
- `EventRouterService.registerConsumer(match, consumer)` — método NOVO simétrico a `registerWebhookListener`. Permite que módulos externos (Channels) anexem consumers sem dependência cíclica com Eventos.
- Consumer auto-registra em `OnModuleInit`:
  ```typescript
  this.eventRouter.registerConsumer((type) => type === 'phase.completed', this);
  ```
- EventosModule é `@Global()`, então EventRouterService é injetável em qualquer módulo (sem import circular).

**Idempotência:** `identificadorExterno = "${correlationId}:${event.type}:${recipientId}"`. Antes de enviar: batch findMany em DEvento -494. Depois: createMany por destinatário com `metaDados.success` + opcional `metaDados.error`. Reuso de `-494 TELEGRAM_MSG_OUT` é seguro porque audit-log já usa mesma DClasse para `telegram.message.out`.

**Timeout 3s via Promise.race:** previne pipeline em-process travar com API Telegram lenta. Timeout NÃO propaga — vira DEvento com `metaDados.error='timeout'`. Token ausente vira DEvento com `error='token_missing'` (skip silencioso, ADR-V2-010). Usuário não pareado: `error='no_chat_link'`.

**Destinatários v1:** `idCreator` da fase + assignees diretos das tasks-folha **filhas DIRETAS** (`idPai = phaseId`, sem recursão). Dedup + intersect com membros da org via `DVincula` org-membership.

**Notification triggers:** `phase.completed` adicionado em `notification-triggers.const.ts`. Como `NotificationConsumer.buildDrafts` tem default `[]`, o efeito é só apareça no in-app router — não dispara drafts (sem extra work).

## Gotchas

1. **`DTask.project` (não `DProject`)** é o nome da relation no schema Prisma — passe `select: { project: { ... } }` para tenant lookup.
2. **`Prisma.join(bigint[])` + `Prisma.empty`** são a forma correta de tornar filtros condicionais em `$queryRaw` (NÃO use template strings ou interpolação direta — SQL injection).
3. **Hook ESLint trava em `unused import`** — sempre que adicionar import, no MESMO Edit já adicionar o uso (constructor inject, providers, ou consumo). Caso contrário hook bloqueia.
4. **`jest.useFakeTimers` + `advanceTimersByTimeAsync(3001)`** para testar timeout — `Promise.race` precisa que o setTimeout interno seja "fake" e avançado.
5. **Refactor do queryThroughput**: unifiquei day/week num único `Prisma.sql` template — mais limpo, mas mantém `truncUnit` como string interpolada Prisma (que vai como parâmetro). Reviewer pode validar que `date_trunc(${truncUnit}, ...)` ainda parametriza.
6. **Atualizei 1 teste F8 pré-existente** (`tasks.service.spec.ts:859-881`) para esperar `BadRequestException` em vez de skip silencioso — semântica reforçada pelo guard F9a.

## Métricas

- **Arquivos criados:** 4 src + 3 specs + 2 ADRs = 9
- **Arquivos modificados:** ~13
- **Testes:** 188 verdes em F9-related (40 baseline flow-metrics retro-compat + 35 novos).
- **TS check:** 0 erros novos (7 pré-existentes preservados — ttl-cache, agents-*, execution-run.processor).
- **Build NestJS:** PASS.
- **Seed:** ZERO diff (reuso de -494 TELEGRAM_MSG_OUT).

---
name: phase-fase4-endpoints
description: Gotchas ADR-V2-047 Fase 4 — DTO query (idPai/idClasse/depth), CTE recursiva no findMany, stubs PhaseTreeService/PhaseMetricsService
metadata:
  type: feedback
---

# ADR-V2-047 Fase 4 — Endpoints + filtros hierárquicos

**Why:** Fase 4 do plan-entidades-fases-via-dtask-idpai-task1 (gate ≥8.0,
estimativa 6h+buffer). Estende GET /tasks com 3 query params novos (idPai,
idClasse, depth) e adiciona 2 endpoints novos (`/tasks/:id/tree`,
`/tasks/:id/metrics`) como stubs para Fase 5 implementar a CTE real.

**How to apply:** Sempre que adicionar query params hierárquicos em Pilar 2
endpoints reusados (`/tasks`), validar via class-validator com `@Matches`
(BigInt-friendly strings) e degradar bem para o caso sem dados (early return
`{ items: [], pagination: ... }`).

## Pontos críticos

- **`ListTasksQueryDto.idPai` aceita "null" literal** — string para filtrar
  por raízes (`where.idPai = null`). Regex: `^(-?\d+|null)$`.
- **Combinação `where.chave` com cursor** — o cursor já popula
  `where.chave = { lt: BigInt(cursor) }`. Ao adicionar `equals` (depth=0)
  ou `in` (depth>=2), MERGE `{ ...where.chave, equals/in }` para preservar
  o cursor. Cast `as Prisma.BigIntFilter` (depois de checar
  `typeof where.chave === 'object'`).
- **CTE recursiva com `depth >= 2`** — embute `Math.min(depth, 20) - 1`
  no `d.depth < ${cappedDepth - 1}` (defesa em profundidade, espelha
  guardrail hardcoded `20` do PhaseHierarchyService). Cap absoluto na CTE
  é `d.depth < 20` adicional.
- **Early return CTE-vazio** — se `descendants.length === 0`, retornar
  `{ items: [], pagination }` ANTES de tocar `dTask.findMany` (evita
  query desnecessária).
- **Endpoints `/tasks/:id/tree` e `/tasks/:id/metrics` precisam vir ANTES
  do `/:id`** no controller (ordem importa no NestJS — colocar handlers
  específicos antes do path-param genérico).
- **Tenant gate ANTES do service stub** — `tasksService.findOne(id, allowed)`
  é chamado antes de `phaseTreeService.buildTree`/`compute`. Garante que
  task fora de scope retorna 404 mesmo com service não implementado
  (anti-enumeration intencional).
- **`ParseBoolPipe` + `DefaultValuePipe(true|false)`** — pipe order: o
  default vem PRIMEIRO; `ParseBoolPipe` interpreta string→boolean
  (`"true"`/`"false"`). Sem `DefaultValuePipe`, query omitida quebra.
- **Stubs com `NotImplementedException`** — preferível a 501 inline no
  controller. Motivos: (1) Nest mapeia automaticamente para HTTP 501;
  (2) testes unitários conseguem chamar o service real e verificar
  contrato; (3) F5 substituirá o corpo do método com diff mínimo.
- **`PrismaService` injetado nos stubs com `void this._prisma`** — TS6133
  bloqueia campos não usados. Marcador prefixo `_` + `void` documenta
  intenção (será usado em F5) sem disable de regra.
- **`maxDepth` no GET /tree** — validação inline no controller (Number.parseInt
  + range 1..20) em vez de `ParseIntPipe` puro, pois precisamos rejeitar
  com mensagem custom + manter `undefined` quando query omitida.
- **Spec do controller usa `.overrideGuard(AuthCompositeGuard)`** para
  bypassar autenticação real e testar apenas o handler. Mock retorna
  `canActivate: () => true`.
- **TasksService.findMany.findMany já chamado `dTabela.findMany` para
  resolver status** — quando combinar filtro `idClasse` (ex: -200 PHASE)
  com filtro `status` (lookup DTabela -44X), nenhum conflito: o
  `where.idClasse` é da DTask, o `where.idStatus.in` vem do lookup
  separado. Ambos coexistem.

## Arquivos novos / modificados

- **Novos:**
  - `src/tasks/dto/phase-tree-response.dto.ts`
  - `src/tasks/dto/phase-metrics-response.dto.ts`
  - `src/tasks/services/phase-tree.service.ts` (stub)
  - `src/tasks/services/phase-metrics.service.ts` (stub)
  - `src/tasks/__tests__/tasks-phase-list-filters.spec.ts` (16 testes)
  - `src/tasks/__tests__/tasks-phase-endpoints.controller.spec.ts` (12 testes)
- **Modificados:**
  - `src/tasks/dto/list-tasks-query.dto.ts` (+idPai/idClasse/depth)
  - `src/tasks/tasks.service.ts` (findMany aceita idPai/idClasse/depth, CTE p/ depth>=2)
  - `src/tasks/tasks.controller.ts` (+getTree, +getMetrics, +Swagger ApiQuery)
  - `src/tasks/tasks.module.ts` (+PhaseTreeService, +PhaseMetricsService)

## Testes — 28 novos, todos passando

- DTO validation: 8 testes (regex idPai/idClasse, range depth)
- findMany filtros: 8 testes (idClasse, idPai numérico, idPai="null",
  depth=0, depth>=2 com CTE, CTE vazia, combinação, scope tenant)
- Controller endpoints: 12 testes (tenant gate ANTES, maxDepth range,
  recursive default, propagação 404, stubs reais lançando 501)

## Comandos verificados

```
npx jest src/tasks/__tests__/tasks-phase-list-filters.spec.ts
  → 16 passed, 0 failed
npx jest src/tasks/__tests__/tasks-phase-endpoints.controller.spec.ts
  → 12 passed, 0 failed
npm run typecheck
  → 7 erros pré-existentes (baseline), zero novos
npx eslint src/tasks/**/*.ts
  → 0 warnings, 0 errors
npm run build
  → PASS
```

## Baseline regression check

Antes de F4: `src/tasks/tasks.service.spec.ts` → 24 failed / 53 passed (77 total)
Depois de F4: `src/tasks/tasks.service.spec.ts` → 24 failed / 53 passed (77 total)
**Zero regressão** — verificado com `git stash` antes/depois.

## Decisão Fase 4 → Fase 5

**Stubs `NotImplementedException` (opção a do brief)** — endpoints
registrados (Swagger, guards, validação), service real preenche em F5.
Benefícios:
1. Frontend e MCP já têm URL definida.
2. Diff mínimo em F5 (substitui só corpo dos métodos).
3. Spec do controller testa contrato HTTP sem depender de SQL real.

Alternativa rejeitada (b — 501 inline): perderia o stack trace claro
do exception e exigiria mover a lógica de 501 → real ao implementar F5
(2 lugares para mexer ao invés de 1).

# Roadmap — Scrumban-Backend-V2

**Versao:** 1.0
**Mantido por:** Documenter Agent V2
**Atualizado em:** 2026-05-08

> Este documento rastreia tasks por Fase (F0..F17). Strategist abre, Implementer entrega, Reviewer valida, Documenter fecha. Cada task tem entrada com Status, Modulo, Fase, Tempo Real, Quality Score, Pilares aplicados e ADRs vinculados.
>
> Bíblia operacional: `docs/plano/00-PLANO-MESTRE.md` (17 fases, ADRs, escopo).
> Workflow agents: ver `CLAUDE.md` §SISTEMA MULTI-AGENT.

---

## F0 — Verificacao canonica + setup repo + Multi-agent infra

### Task #0: Esqueleto canonico V2 — COMPLETA

**Status:** Completo (manual, pre-multi-agent)
**Modulo V2:** core / agents
**Fase V2:** F0
**Completado em:** 2026-05-08
**Commit:** `690d7c1`

**O Que Foi Feito:**
- Pasta Scrumban-Backend-V2/ inicializada
- `package.json` minimalista (NestJS + Prisma + class-validator + class-transformer + bullmq)
- `tsconfig.json` strict mode, `Makefile`, `docker-compose.yml`, `.env.example`
- `prisma/schema.prisma` com as 17 tabelas canonicas
- `.claude/` populado: 4 agents, 4 MEMORY.md, 11 hooks, 6 commands, settings.json
- `templates/classes-base-template.ts` (45 classes universais Devari-Core)
- 8 rules canonicas (`devari-*.md`)
- ADRs V2-001..V2-017 redigidos

**Pilares aplicados:**
- Pilar 1 (Engine): preparacao estrutural (DPedido + DVFS prontos para F6)
- Pilar 2 (Endpoints): N/A em F0
- Pilar 3 (Seed): preparacao (45 fixas no template, ainda nao aplicadas)

**ADRs vinculados:** ADR-V2-001 (17 tabelas) ate ADR-V2-017 (Generator feedback loop)

---

## F1 — Schema 17 tabelas + Seed DClasses (Pilar 3)

### Task 1: Pilar 3 — Schema canonico + Seed de DClasses — ✅ COMPLETA

**Status:** Completo
**Modulo V2:** seeds (+ schema)
**Fase V2:** F1
**Tempo Real:** ~3h Implementer + ~30min Reviewer + ~30min Documenter
**Completado em:** 2026-05-08
**Quality Score:** 9.0/10

**O Que Foi Feito:**
- Schema canonico `prisma/schema.prisma` consolidado com 17 tabelas + 4 relations FK adicionadas pre-F1 (DTask.assignee/creator, DProject.estab, DPedido.locEscritu) com reversas em DEntidade
- Migration inicial `prisma/migrations/20260508204157_initial_canonical/migration.sql` aplicada (17 CREATE TABLE + FKs)
- `prisma/seeds/classes.seed.ts` com **128 DClasses** (45 fixas + 83 especificas, range -150..-527) — acima do piso DoD-06 (>=97)
- `prisma/seeds/validate-hierarchy.ts` — validador puro O(N) com 6 checagens (chave negativa, sem duplicatas, root unico=-1, idPai existe, sem ciclos via DFS, sem sequestro de canonica reservada) + helpers `FIXED_RANGE_MIN/MAX` + `isInFixedRange()`
- `prisma/seeds/seed-runner.ts` — UPSERT atomico em `prisma.$transaction`, modo `--dry-run`, idempotencia forte (1a execucao 948ms, 2a 149ms)
- `prisma/seeds/__tests__/validate-hierarchy.spec.ts` — 12 testes unit (todos PASS, vs 6 minimos do DoD-08)
- 6 ADRs MADR canonicos: V2-019 (seed monolitico), V2-020 (UPSERT idempotente), V2-021 (validador puro), V2-022 (renumeracao corte limpo, ratifica V2-002), V2-023 (4 relations FK pre-F1), V2-024 (console.log cirurgico)
- `docs/SCHEMA-CANONICO-AUDITORIA.md` — auditoria das 17 tabelas + dump das 128 classes
- `docs/lessons/metrics-fase-1.md` — metricas Generator (ADR-V2-017)

**Smoke test integrado (verde):**
- `make build` PASS
- `npx tsc --noEmit` 0 errors
- `npx eslint src/ prisma/seeds/ --max-warnings 0` 0 errors
- `npx jest` 12/12 PASS
- `npx prisma validate` valid
- `prisma db seed` 128 classes em 948ms / 149ms (idempotente)
- `SELECT count(*) FROM "DClasse"` = 128
- 9/9 classes criticas presentes (-150 USER, -151 PLATFORM_SCRUMBAN, -152 ORG, -156 AGENT, -180 TEAM, -300 EXECUTION, -440 STATUS_INTENTION_V3, -441 INBOX, -491 WEBHOOK_ATTEMPT)

**Pilares aplicados:**
- Pilar 1 (Engine): preparacao — DClasses -300/-301/-302/-303 EXECUTION + DVFS chaves -91..-95 prontos para F6
- Pilar 2 (Endpoints): N/A em F1 (escopo F2)
- Pilar 3 (Seed): **ATIVADO PLENAMENTE** — 128 classes, validacao em time de import, hierarquia integra, zero sequestro

**ADRs vinculados:** ADR-V2-019, ADR-V2-020, ADR-V2-021, ADR-V2-022, ADR-V2-023, ADR-V2-024

**Plan:** [`workspace/plans/plan-seeds-canonical-task1.md`](../workspace/plans/plan-seeds-canonical-task1.md)
**Impl Notes:** [`workspace/implementations/impl-seeds-canonical-task1.md`](../workspace/implementations/impl-seeds-canonical-task1.md)
**Review:** [`workspace/reviews/review-seeds-canonical-task1.md`](../workspace/reviews/review-seeds-canonical-task1.md)
**Documentation:** [`workspace/documentation/doc-seeds-canonical-task1.md`](../workspace/documentation/doc-seeds-canonical-task1.md)
**Commit Implementer:** `7af80d2`

---

## F2 — Endpoints Genericos /entidades /tabela /classes (Pilar 2) — ✅ COMPLETA

### Task #1: Pilar 2 — 3 Controllers Genéricos (EntidadeController + TabelaController + ClasseController) — ✅ COMPLETA

**Status:** Completo
**Módulo V2:** endpoints
**Fase V2:** F2
**Tempo Real:** ~3h Implementer + ~1h Reviewer + ~30min Documenter
**Completado em:** 2026-05-08
**Quality Score:** 9.0/10

**O Que Foi Feito:**
- `EntidadeController` + `EntidadeService` — CRUD completo `/api/v1/entidades` com cursor pagination, soft-delete, N+1 ZERO via include/join, BigInt serializado, Swagger 100%
- `TabelaController` + `TabelaService` — CRUD completo `/api/v1/tabelas` com filtro `dEntidadeId`, cursor pagination, soft-delete
- `ClasseController` + `ClasseService` — Read-only `/api/v1/classes` + `/classes/tree` (1 query + Map em memória)
- Infraestrutura comum: `ParseBigIntPipe`, `ParseOptionalBigIntPipe`, `@SkipGuard()` placeholder, LRU cache para `?classe=NOME`
- **ADR-V2-015:** `?idClasse=N` canônico + `?classe=NOME` deprecated com headers `Deprecation` + `Sunset` (sunset: 2026-06-05)
- Audit inline via DEvento -497 em create
- Métodos canônicos: `getEntidadeIdFromUserGroup()`, `createSeller()`

**Smoke test integrado (verde):**
- `npm run build` PASS (0 erros TypeScript)
- `npx tsc --noEmit` 0 erros
- `npx eslint --max-warnings 0` 0 warnings
- `npm run test` 43/43 PASS (mínimo 26)
- ZERO controllers duplicados (`find src -name "*.controller.ts"` retorna APENAS: entidades, tabelas, classes)
- ZERO console.log
- ZERO parseInt/Number em IDs (BigInt SEMPRE)
- N+1 ZERO (listagens com include/join, getTree = 1 findMany + Map)
- BigInt serializado como string em todos os responses
- `?idClasse=N` + `?classe=NOME` + ambos → testes regressão passando
- Swagger em `/api/docs` com 3 controllers documentados

**Pilares aplicados:**
- Pilar 1: N/A (tabelas estruturais — Prisma direto correto)
- Pilar 2: **ATIVADO PLENAMENTE** — 3 controllers genéricos canônicos (0 controllers específicos)
- Pilar 3: RESPEITADO — 128 DClasses do seed validadas, ZERO nova criada

**ADRs vinculados:** ADR-V2-015 (implementado)

**Tech Debt (resolver antes de F3):**
- `[TECH-DEBT/F3]` Mover `PaginationMetaDto` para `src/common/dto/`
- `[TECH-DEBT/F3]` Mover `formatTabelaResponse` para `src/tabelas/helpers/`
- `[TECH-DEBT/F3]` Extrair `validarClasse` duplicada
- `[TECH-DEBT/F3]` Aplicar `ParseBigIntPipe` em `@Param('id')`
- `[ADR/F3]` Redigir ADR-V2-025 (BigInt strategy)
- `[TECH-DEBT/F3]` Cache em memória para `validarClasse`
- `[TECH-DEBT/F3]` Remover wrapper `?classe=NOME` após sunset (2026-06-05)

**Plan:** [`workspace/plans/plan-endpoints-genericos-f2-task1.md`](../workspace/plans/plan-endpoints-genericos-f2-task1.md)
**Impl Notes:** [`workspace/implementations/impl-endpoints-genericos-f2-task1.md`](../workspace/implementations/impl-endpoints-genericos-f2-task1.md)
**Review:** [`workspace/reviews/review-endpoints-genericos-f2-task1.md`](../workspace/reviews/review-endpoints-genericos-f2-task1.md)
**Commit:** (a ser criado pelo Documenter)

---

## Proximas fases (preview)

| Fase | Nome | Pilar dominante |
|------|------|-----------------|
| F3 | Auth + RBAC duplo via DUserGroup + DVincula | — |
| F4 | Email module + Common Services | — |
| F5 | Dominio estrutural (Org/Team/Project/Sprint/Status/Task) | Pilar 2 |
| F6 | **Engine + OperacaoExecucaoClaude** (CORACAO V2) | **Pilar 1** |
| F7 | Eventos canonicos (DEvento + EventProducerService) | — |
| F8 | Flow Metrics + Forecast + Search (runtime) | — |
| F9 | Reports + Dashboards | — |
| F10 | Channels (Telegram + voz Groq) | — |
| F11 | MCP Server (5 tools) | — |
| F12 | Webhooks outbound (HMAC + retry + auto-disable) | — |
| F13 | **Automation Claude Code (Agent + Engine)** | Pilares 1+2 |
| F14 | Hardening | — |
| F15 | **Migration de dados do legado** | — |
| F16 | Documentacao + Handoff | — |
| F17 | Launch + pos-launch | — |

Detalhes completos: `docs/plano/00-PLANO-MESTRE.md` §1.1.

---

**Maintained by:** Documenter Agent V2 (Scrumban-Backend-V2)

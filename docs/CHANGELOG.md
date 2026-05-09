# Changelog — Scrumban-Backend-V2

Todas as mudancas notaveis deste projeto serao documentadas neste arquivo.

O formato segue [Keep a Changelog 1.1.0](https://keepachangelog.com/pt-BR/1.1.0/),
e este projeto adere a [Semantic Versioning 2.0.0](https://semver.org/lang/pt-BR/).

Tipos de entrada usados: `Added`, `Changed`, `Deprecated`, `Removed`, `Fixed`,
`Security`, `Performance`, `Tests`.

---

## [Unreleased]

### Added

- **F3 Auth + RBAC Duplo** (Task #1, V2 F3) — 2026-05-09
  - `AuthModule` completo: 7 guards (JwtAuthGuard, ApiKeyGuard, McpKeyGuard, AuthCompositeGuard, OrgTenantGuard, ProjectScopeGuard, RolesGuard), 5 services (AuthService, ApiKeyService, McpKeyService, RefreshTokenService, RoleResolverService)
  - `AuthController`: 13 endpoints (register, login, refresh, logout, /me CRUD + api-key + mcp-key) — todas com Swagger 100%, JSDoc completo
  - `PermissoesModule`: 4 endpoints CRUD DPermissao com `@Roles('ADMIN')` guard
  - RBAC duplo via DVincula + idClasse (ADR-V2-003): Org roles (-161 ADMIN / -162 MEMBER / -163 VIEWER); Project roles (-171 MANAGER / -172 MEMBER / -173 VIEWER)
  - API Keys via DTabela(-471) + MCP Keys via DTabela(-472) com hash duplicado em DUserGroup.dados (ADR-V2-004)
  - `@Public()` decorator substitui `@SkipGuard()` placeholder de F2
  - Refresh token rotativo: cada refresh gera novo hash, token antigo invalidado (reuse detection)
  - RoleResolverService com LRU cache 1000 entries TTL 5min — N+1 ZERO em RBAC queries
  - OrgTenantGuard com LRU cache — isolamento multi-tenant via DProject.idEstab

### Fixed (Dívidas F2 resolvidas em F3)
- `PaginationMetaDto` movida de `src/entidades/dto/` para `src/common/dto/pagination-meta.dto.ts` (resolve cross-module dependency)
- `formatTabelaResponse` extraída de inline em `tabelas.service.ts` para `src/tabelas/helpers/format-tabela-response.ts`
- `validarClasse` extraída para `src/common/helpers/validar-classe.helper.ts` (elimina duplicação entre entidades e tabelas)
- `ParseBigIntPipe` aplicado em `@Param('id')` em todos os controllers F2 (EntidadeController, TabelaController, ClasseController)
- `POST /classes` registrado explicitamente com `@Post()` retornando `HttpStatus.FORBIDDEN` com mensagem clara

### Technical Debt (Registrado para F14)
- `findUserGroupByRefreshToken` em AuthController acessa `this.authService['prisma']` via bracket notation — refatorar para método público em AuthService
- `revokeApiKeys` usa loop sequencial com `await` em vez de `updateMany` — refatorar para batch update
- `ApiKeyService.validate` sem índice GIN em DTabela.dados Json — avaliar raw query ou criar índice se volume > 100 keys
- `findUserGroupByRefreshToken` faz scan O(n) em DUserGroup — adicionar campo indexado ou userGroupId no RefreshDto

### Performance
- N+1 ZERO em `/auth/me`: 2 queries (DUserGroup+DEntidade JOIN + DVincula findFirst)
- N+1 ZERO em RBAC queries: RoleResolverService com LRU cache TTL 5min
- `getMe` performance: ≤3 queries verificado com DATABASE_LOGGING=true

### Tests
- 78 unit tests PASS (12 suites: auth.service, api-key.service, role-resolver.service, refresh-token.service, auth-composite.guard, roles.guard + F2 carryover)
- Todos os bloqueadores DoD verificados: build clean, TypeScript 0 erros, ESLint 0 warnings, Swagger 100%, JSDoc completo
- Refresh token reuse detection testado: token antigo vira inválido após rotate
- Bcrypt rounds = 12 (constante explícita com comentário ADR)
- Senha NUNCA logada (grep confirmado)

### Security
- Bcrypt rounds ≥ 12 para hash de senha (ADR-V2-004)
- API Key plaintext retornado UMA VEZ ao criar (nunca reexibido)
- MCP Key hash duplicado em DUserGroup.dados com sync em transaction
- Refresh token rotativo com reuse detection (detecta e revoga ao ver token antigo)
- Sem `console.log` no código auth (grep confirmado)

---

### Added (F2 Pilar 2 — Endpoints Genéricos)
  - `EntidadeController` + `EntidadeService` — CRUD completo `/api/v1/entidades` (GET/POST/PATCH/DELETE) com cursor pagination, soft-delete, N+1 ZERO (include com JOIN), BigInt serializado, Swagger 100%, JSDoc completo
  - `TabelaController` + `TabelaService` — CRUD completo `/api/v1/tabelas` com filtro `dEntidadeId`, cursor pagination, soft-delete
  - `ClasseController` + `ClasseService` — Read-only `/api/v1/classes` + `GET /classes/tree` (1 query + Map em memória, ZERO N+1), bloqueio 403 explícito para POST (classes do seed — imutáveis via API)
  - Infraestrutura comum: `ParseBigIntPipe` + `ParseOptionalBigIntPipe` (conversão segura string → bigint), `@SkipGuard()` decorator placeholder (F3 substitui por JwtAuthGuard), LRU cache genérico (max 200 entradas, TTL 5min) para alias `?classe=NOME`
  - **ADR-V2-015 implementado:** `?idClasse=N` canônico V2; `?classe=NOME` aceito com headers `Deprecation: true` e `Sunset: 2026-06-05T00:00:00.000Z` por 2 sprints (sunset em 2026-06-05); ambos simultaneamente → 400 BadRequest
  - Audit inline via DEvento -497 em `criar()` para entidades (placeholder até F7 EventProducerService)
  - Método canônico `getEntidadeIdFromUserGroup(userGroupId)` — Pattern #5 Devari-Core, pré-requisito de F3
  - Helper canônico `createSeller(dto)` — template para criação de sellers com conta virtual em transaction, ready para uso futuro

### Performance

- N+1 ZERO: todas as listagens usam `include: { classe }` (JOIN no banco), `getTree` = 1 `findMany` + Map em memória (O(n) linear)
- Cursor pagination em todas as listagens (não usa offset ineficiente)

### Tests

- 43 unit tests novos passando (meta mínima: 26)
  - `src/entidades/entidades.service.spec.ts` — 8 specs
  - `src/tabelas/tabelas.service.spec.ts` — 6 specs
  - `src/classes/classes.service.spec.ts` — 4 specs
  - `src/common/pipes/parse-bigint.pipe.spec.ts` — 5 specs
  - `src/common/helpers/lru-cache.spec.ts` — 3 specs
  - `prisma/seeds/__tests__/validate-hierarchy.spec.ts` — 12 specs (carryover F1, incluso em contagem)

### Technical Debt

- `[TECH-DEBT/F3]` `PaginationMetaDto` em `src/entidades/dto/` — mover para `src/common/dto/pagination-meta.dto.ts` para quebrar dependência cruzada `TabelasModule → EntidadesModule`
- `[TECH-DEBT/F3]` `formatTabelaResponse` inline em `tabelas.service.ts` — mover para `src/tabelas/helpers/format-tabela-response.ts`
- `[TECH-DEBT/F3]` `validarClasse` duplicada em `EntidadeService` e `TabelaService` — extrair para `src/common/helpers/validate-classe.ts` ou injetar `ClasseService`
- `[TECH-DEBT/F3]` `ParseBigIntPipe` não aplicado em `@Param('id')` dos 3 controllers — aplicar em F3
- `[ADR/F3]` Redigir ADR-V2-025 (BigInt serialization strategy: interceptor global vs por-módulo)
- Cache de `validarClasse` em memória (Map imutável no `onModuleInit`) — implementar em F3 (15 linhas)
- `?classe=NOME` removal — sunset em 2026-06-05, remover wrapper em F3/F5 se não tiver uso

### Generator Impact

- 3 controllers genéricos (`EntidadeController`, `TabelaController`, `ClasseController`) com cursor pagination + soft-delete + Swagger 100% + ADR-V2-015 compat wrapper são **candidatos a entrar no Devari-Core v3.0** como módulos base reutilizáveis
- Registrado em `docs/lessons/issues-evolution-from-v2.md` com label `evolution-candidate`

---

- **F1 Pilar 3 — Schema canonico + Seed de DClasses** (Task #1, V2 F1)
  - 17 tabelas canonicas Devari-Core no `prisma/schema.prisma` com 4 relations FK adicionadas pre-F1 (DTask.assignee, DTask.creator, DProject.estab, DPedido.locEscritu) + reversas em DEntidade (`tasksAssigned`, `tasksCreated`, `projetos`, `pedidosAsLocEscritu`).
  - Migration inicial `prisma/migrations/20260508204157_initial_canonical/migration.sql` (17 CREATE TABLE + FKs).
  - **128 DClasses** seedadas em `prisma/seeds/classes.seed.ts` (45 fixas Devari-Core via spread de `templates/classes-base-template.ts` + 83 especificas Scrumban-V2 no range -150..-527).
  - Validador puro `prisma/seeds/validate-hierarchy.ts` — funcao `validateHierarchy()` com 6 checagens (chave negativa, sem duplicatas, root unico=-1, idPai existe, sem ciclos via DFS O(N), sem sequestro de canonicas Devari-Core -45/-47/-49/-50). Rodado em time de import — falha precoce em `tsc`/`jest`/CI antes de tocar o banco.
  - Helpers exportados: `CANONICAL_RESERVED`, `FIXED_RANGE_MIN`, `FIXED_RANGE_MAX`, `isInFixedRange()` para auditoria externa.
  - Seed-runner `prisma/seeds/seed-runner.ts` — UPSERT atomico em `prisma.$transaction` (idempotencia forte, drift detection); modo `--dry-run` para CI offline; logs estruturados.
  - 6 ADRs MADR canonicos em `docs/decisions/`: ADR-V2-019 (seed monolitico vs particionado), ADR-V2-020 (UPSERT idempotente em transacao), ADR-V2-021 (validador puro testavel), ADR-V2-022 (renumeracao corte limpo, ratifica ADR-V2-002), ADR-V2-023 (4 relations FK pre-F1), ADR-V2-024 (console.log cirurgico em prisma/seeds/).
  - Auditoria documental `docs/SCHEMA-CANONICO-AUDITORIA.md` (253 linhas, 17 tabelas + dump das 128 classes + mapeamento V2).
  - Metricas Generator (ADR-V2-017): `docs/lessons/metrics-fase-1.md`.
  - Pilares: P3 ATIVADO PLENAMENTE; P1 preparado (DPedido -300..-303 + DVFS -91..-95 prontos para F6); P2 fora de escopo F1.
  - ADRs: ADR-V2-019, ADR-V2-020, ADR-V2-021, ADR-V2-022, ADR-V2-023, ADR-V2-024.

### Changed

- `prisma/schema.prisma` — 4 relations FK acrescentadas para integridade referencial completa (justificativa em ADR-V2-023; nao infringe ADR-V2-001 — zero tabela nova).
- `package.json` — bloco `"prisma": { "seed": "ts-node prisma/seeds/seed-runner.ts" }` adicionado; `jest.rootDir` migrado de `"src"` para multi-roots `["<rootDir>/src", "<rootDir>/prisma/seeds"]` para descobrir specs do validador; `coverageDirectory` ajustado para `"./coverage"`.

### Performance

- Seed: 1a execucao **948ms** / 2a execucao **149ms** (idempotencia forte via UPSERT em transacao).
- Validador: O(N) DFS amortizado com 1 unica passada por elemento; falha em milissegundos sobre 128 classes.
- Smoke test integrado total: ~5s (excluindo docker compose startup).

### Tests

- 12 unit tests em `prisma/seeds/__tests__/validate-hierarchy.spec.ts` (vs 6 minimos do DoD-08), 100% PASS:
  1. arvore valida (classesFixas)
  2. ciclo direto A->B->A
  3. ciclo indireto A->B->C->A
  4. idPai inexistente
  5. sequestro de canonica reservada (-47)
  6. chave duplicada
  7. chave positiva
  8. root duplicado
  9. root com chave != -1
  10. exporta CANONICAL_RESERVED com 5 chaves
  11. array vazio
  12. expoe FIXED_RANGE_MIN/MAX e isInFixedRange para validacoes externas

### Security

- ZERO tabela nova fora das 17 canonicas (ADR-V2-001 enforcing via `enforce-canonical-tables.sh`).
- ZERO sequestro de DClasses canonicas Devari-Core (-45/-47/-49/-50 livres para uso fintech; validador bloqueia em time de import).
- Convencao chave negativa (seeds) vs positiva (runtime) preservada — validador rejeita chave positiva no seed.

---

**Maintained by:** Documenter Agent V2 (Scrumban-Backend-V2)

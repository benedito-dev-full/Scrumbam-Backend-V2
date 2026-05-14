---
name: orphan-login-etapa3
description: Etapa 3 do plano orphan-workspace — destrava login/refresh/issueSessionForUser órfão + isOrphan no /auth/me + fix do switch-org guard (carryover M1 da Etapa 2). ADR-V2-040 em ratificação.
metadata:
  type: project
---

# Etapa 3 orphan-workspace — destrave de login órfão + isOrphan

**Why:** completa o ciclo de JWT órfão iniciado nas Etapas 1 e 2. Etapa 1 deixou `organizationId?` no payload + removeu o fallback ruim `?? entidade.chave`; Etapa 2 montou guards (`RequireWorkspaceGuard`, `@AllowOrphan`). Mas o login ainda jogava 401 quando user não tinha DVincula — então o estado órfão era inalcançável em produção. Etapa 3 remove esses 401 e adiciona o sinal canônico `isOrphan: boolean` no perfil.

**How to apply:** ao adicionar campo obrigatório em UserProfileDto (ou qualquer DTO usado como response em VÁRIOS endpoints), buscar TODOS os mocks/literais de teste em outros módulos que constroem o DTO inline (`grep -rn "user: {" src/`). Adicionar o campo ao mock para evitar TS2741 em cascata. No caso de `isOrphan`, foi um único spec (`invites/invites.controller.spec.ts:137`) — outros módulos não constroem o DTO manualmente.

## Decisões de design

1. **Helper privado `buildAuthResponse` deriva `isOrphan` de `orgs.length === 0`**, não recebe como parâmetro. Single source of truth: se loadAvailableOrgs retorna [], o user é órfão — ponto final. Evita inconsistência tipo "passei orgId mas availableOrgs vazio".

2. **Spread condicional `...(orgId === undefined && { orphan: true })` no metaDados do DEvento -501.** O `false` NÃO é serializado — auditoria de login normal fica limpa, e queries SQL `metaDados->>'orphan' = 'true'` retornam só os órfãos sem precisar coalesce.

3. **Login órfão usa `logger.log` (não warn)**. Estado válido, não exceção operacional. Warn ficou reservado para `login_failed` (credenciais erradas).

4. **`switch-org` migrado de `JwtAuthGuard` para `AuthCompositeGuard`** — carryover M1 da Etapa 2. Antes o `@AllowOrphan()` era dead code naquela rota (só `AuthCompositeGuard` lê o decorator via `RequireWorkspaceGuard`). Agora o decorator é load-bearing: user órfão consegue chamar `/auth/switch-org` para entrar numa org via convite aceito (preparação para Etapa 4/5).

## Gotchas

- **`tsconfig.build.json` exclui specs**, mas `npx jest` compila com `ts-jest` que respeita o `tsconfig.json` raiz (sem exclude). Por isso `make build` passou enquanto `npx jest src/invites` falhou com TS2741. Lição: ao mexer em DTO obrigatório, rodar `npx jest` em TODA suite (`npx jest`) — não só no módulo tocado. Procurar por mocks inline em outros specs.
- **Múltiplos pre-existing failures NÃO relacionados:** `src/tasks/tasks.service.spec.ts` (state machine — 24 failures), `src/automation/agents/__tests__/*` (TasksService DI missing — 5 suites), `src/common/cache/ttl-cache.service.spec.ts`. Verificar com `git stash && npx jest <path> && git stash pop` antes de gastar tempo "consertando" — os 5 specs de automation e 1 de tasks já estavam vermelhos no `main` (commits recentes `5b510c4` flexibilizaram transições V3 sem atualizar specs).
- **`metaDados` lookups em testes**: `prisma.dEvento.create.mock.calls.find(...)` para isolar o evento de login normal vs falha (`registrarEventoLoginFalhou` também chama `dEvento.create`). Sem filtrar, o assertion sobre `orphan` puxa o evento errado.

## Testes adicionados (auth.service.spec.ts)

- `login()` órfão → JWT sem organizationId + DEvento orphan:true (52 → 51 tests no spec file — uma migração de format renomeou).
- `login()` normal → NÃO marca orphan no DEvento (regressão zero do JSONB).
- `refresh()` órfão → JWT sem organizationId, sem 401.
- `getMe()` órfão → `isOrphan: true`, `availableOrgs: []`, `organizationId: undefined`.
- `getMe()` happy path + multiplas orgs → `isOrphan: false` (regressão zero).
- `issueSessionForUser()` sem `preferredOrgId` + órfão → emite JWT sem joga UnauthorizedException.

Total auth suite: 51 → 56 specs (5 novos), todos verdes.

## Próximos passos

Etapa 4 cria `GET /auth/pending-invites` (lista convites pelo email do user órfão).
Etapa 5 marca `POST /organizations` com `@AllowOrphan()` + smoke E2E + ADR-V2-040 formal (Documenter).

---
name: orphan-workspace-etapa5
description: Etapa 5 do plano orphan-workspace — @AllowOrphan em POST /organizations + smoke E2E + esboço ADR-V2-040
metadata:
  type: project
---

# Etapa 5 — Orphan Workspace (FINAL)

**Data:** 2026-05-14
**Plano:** `workspace/plans/plan-orphan-workspace.md` (Etapa 5)
**ADR:** `docs/decisions/ADR-V2-040-orphan-jwt.md` (esboço — Documenter formaliza)

## O que foi feito

### 1. `POST /organizations` agora aceita JWT órfão

- `src/organizations/organizations.controller.ts`: adicionado `@AllowOrphan()` no endpoint `@Post()`.
- Controller **já usava** `AuthCompositeGuard` no nível da classe (`@UseGuards(AuthCompositeGuard)` linha 45). NÃO foi necessário trocar guard — só adicionar o decorator + atualizar `@ApiOperation.description` mencionando ADR-V2-040.
- Import `AllowOrphan` adicionado de `'../auth/decorators/allow-orphan.decorator'`.

### 2. Smoke E2E manual documentado

- `workspace/smoke/smoke-orphan-workspace-etapa5.md` — 2 fluxos:
  - **Fluxo A:** register → login órfão → `/auth/me` (isOrphan:true) → `/auth/pending-invites` → `/projects` 403 NO_WORKSPACE → `POST /organizations` 201 → `POST /auth/switch-org` → `/auth/me` (isOrphan:false) → `/projects` 200.
  - **Fluxo B:** convite pendente → `/auth/pending-invites` → `POST /invites/:token/accept` → JWT novo → org ativa.
- Inclui validação final de regressão zero (user normal continua funcionando).
- Smoke **não executado** (sem stack rodando); recomendado executar antes de merge.

### 3. Esboço do ADR-V2-040

- `docs/decisions/ADR-V2-040-orphan-jwt.md` — esboço com seções completas (contexto, decisão, consequências, alternativas, componentes, trade-offs, métricas, referências).

## Gotchas

### Conflito de numeração de ADR

**Já existe** `ADR-V2-040-hmac-bilateral-agent-backend.md` (aceito 2026-05-13, F13 automation/HMAC). Mas:
- Todos os artefatos das Etapas 1-4 (decorator, guard, strategy, eventos -501) já referenciam textualmente **"ADR-V2-040"** significando "JWT órfão".
- O plano `plan-orphan-workspace.md` chama este ADR de `ADR-V2-040`.

**Decisão:** criei o esboço com o nome do arquivo `ADR-V2-040-orphan-jwt.md` (conforme plano), mas adicionei nota explícita no topo pedindo ao Documenter para decidir:
- **Opção A (recomendada):** manter HMAC como 040 e renumerar este ADR para próximo livre (ex: ADR-V2-041), atualizando referências em código.
- **Opção B:** renumerar HMAC (não recomendado — quebra histórico).

Cabe ao Documenter resolver na formalização.

### `POST /organizations` JÁ usava AuthCompositeGuard

Antes de adicionar `@AllowOrphan()`, **verificar sempre** se o controller usa `AuthCompositeGuard` (não `JwtAuthGuard` raw). Se usar `JwtAuthGuard`, o decorator é **silenciosamente ignorado** (não há guard que leia a metadata `ALLOW_ORPHAN_KEY`).

No caso do `OrganizationsController`, o guard composite já estava no nível da classe — só foi necessário adicionar `@AllowOrphan()` no método.

### Hook PostToolUse:Edit + import não-usado

Ao adicionar import `AllowOrphan` em um Edit separado do uso, o hook ESLint trava com `@typescript-eslint/no-unused-vars`. Solução já documentada na memory de Etapa 4: **agrupar import + primeiro uso no MESMO Edit**, ou usar `// eslint-disable-next-line` temporário.

Nesta etapa o hook quebrou no primeiro Edit (só import); resolvi fazendo o segundo Edit imediatamente para adicionar o `@AllowOrphan()` no `@Post()`. O formatter (Prettier?) também reformatou `@ApiOperation({...})` de single-line para multi-line entre os Edits, então o `old_string` do segundo Edit teve que ser re-lido.

### Build + Tests

- `npm run build` PASS.
- `npx jest --testPathPattern="(auth|invites|organizations)"` → 11 suites, 114 tests, todos verdes.
- Não precisei adicionar tests novos para o `@AllowOrphan()` no `POST /organizations` — a cobertura já existe em `require-workspace.guard.spec.ts` (Etapa 2) que valida o comportamento genérico do decorator.

## Arquivos alterados/criados

**Modificados:**
- `src/organizations/organizations.controller.ts` — import `AllowOrphan` + `@AllowOrphan()` no `POST /` + descrição ADR-V2-040 em `@ApiOperation`.

**Criados:**
- `docs/decisions/ADR-V2-040-orphan-jwt.md` (esboço estruturado, ~280 linhas).
- `workspace/smoke/smoke-orphan-workspace-etapa5.md` (~250 linhas com 2 fluxos completos).
- `.claude/agent-memory/implementer/orphan-workspace-etapa5.md` (este arquivo).

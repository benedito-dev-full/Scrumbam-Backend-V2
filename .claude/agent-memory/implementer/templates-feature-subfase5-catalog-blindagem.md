---
name: templates-feature-subfase5-catalog-blindagem
description: Sub-fase 5 Templates (ADR-V2-061) — catálogo de templates + blindagem das visões normais
metadata:
  type: project
---

# Templates Sub-fase 5 — Catálogo + Blindagem (ADR-V2-061, 2026-06-03)

Última sub-fase da feature Templates. Plano: `workspace/plans/plan-templates-feature.md`.

**TAREFA A — Blindagem (templates -401/-402 somem das visões de "trabalho"):**
- `projects.service.ts findMany`: nas DUAS queries de DProject (Camada A públicos `~:709` e findMany final `~:772`), quando `idClasse` é específico o filtro `idClasse: X` já exclui templates; quando AUSENTE adicionei `idClasse: { notIn: TEMPLATE_CLASSES }`. Padrão ternário: `idClasse !== undefined ? { idClasse: BigInt(idClasse) } : { idClasse: { notIn: TEMPLATE_CLASSES } }`. O caminho de catálogo retorna ANTES desse ponto, então aqui `idClasse` nunca é -401/-402.
- `folders.service.ts listUnassigned` (`~:353`): limbo lista todos DProjects da org sem filtro de classe → template org-scoped apareceria. Add `idClasse: { notIn: TEMPLATE_CLASSES }`.
- `search.service.ts queryProjects` (`~:214`): busca por nome traria template → add `idClasse: { notIn: TEMPLATE_CLASSES }`.
- Outras listagens de DProject (folder-content via -183, space-tree via `findMany`+idPai) NÃO precisam: templates não têm -183 e o caminho idPai cai na blindagem do findMany. `findFirst` (tenant checks) não lista.

**TAREFA B — Catálogo (`GET /projects?idClasse=-401|-402`):**
- Caminho DEDICADO em `findMany`: `if (isTemplateClasseFilter(idClasse)) return this.listTemplates(...)` logo após resolver `orgIdBig` (antes da lógica de team). BYPASSA DVincula/público (globais idEstab NULL não têm DVincula → união normal não os veria).
- `private listTemplates(templateClasse, orgIdBig, {cursor,take,categoria})`: 1 query só. `where: { idClasse: templateClasse, excluido:false, OR: [{idEstab:org},{idEstab:null}], ...categoria via dados JSON-path, ...cursor }`. Acesso = org ativa OU global. Sem org → só globais.
- Filtro categoria: `{ dados: { path: ['categoria'], equals: categoria } }` (Prisma JSON-path).
- Resposta FLAT (decisão do plano, Pilar 2): expus `categoria` em `ProjectResponseDto` lendo `dados.categoria` no `buildResponse`; front agrupa. NÃO agrupei server-side.
- Catálogo é read-only → `myRole=null`, sem member/team/folder/progresso (passei `0/null/null/undefined/undefined/null` ao buildResponse).
- Permissão: só autenticado + org ativa (qualquer membro VÊ catálogo, NÃO exige MANAGER — usar ≠ gerenciar).

**DTO:** `ListProjectsQueryDto.categoria?: string` (@IsOptional @IsString) + `FindManyProjectsOptions.categoria?` + propaga no controller + @ApiQuery. `ProjectResponseDto.categoria?: string|null`.

**GOTCHAs:**
- Prisma `notIn` exige `bigint[]` MUTÁVEL — `readonly bigint[]` dá TS2322. Declarar `const TEMPLATE_CLASSES: bigint[] = [...]` (sem readonly). Repetido em 3 arquivos (cada módulo tem sua const local; sem import cruzado).
- Hook ESLint roda a CADA Edit e falha `no-unused-vars` enquanto a const/helper ainda não é referenciada (intermediário esperado, some quando o uso é adicionado).
- **Mock do batch findMany**: os testes de blindagem do findMany quebram com `doneStatusRows.map of undefined` (~l.838) se não mockar `prisma.dTask.groupBy` E `prisma.dTabela.findMany` (o `Promise.all` final destrutura 6 resultados incl. totalCounts/doneStatusRows). Catálogo NÃO precisa (não passa pelo batch).
- **Baseline pré-existente projects.service.spec**: 8 failed (todos em findMany cursor/teamId/idClasse/idPai/privado — mesmo bug doneStatusRows l.838, commit 7c23cd4, NÃO meu). Confirmei via `git stash` (68 passed baseline → 73 com meus +5). folders/search specs: 30 failed/15 passed PRÉ-EXISTENTES (DI/integration, idênticos com/sem minha mudança).
- 5 testes novos: catálogo -401 (org+global+categoria exposta), categoria filter JSON-path, -402 space-templates, blindagem findMany final (notIn), blindagem Camada A pública (notIn). Asserções via `prisma.dProject.findMany.mock.calls[0][0].where`.

Gates: `make build`(nest+copy:dvfs) PASS; tsc 25 baseline (0 non-spec); eslint 0 nos 7 arquivos; N+1 zero (catálogo=1 query, asserção `dVincula.findMany not called` + `dProject.findMany times(1)`).

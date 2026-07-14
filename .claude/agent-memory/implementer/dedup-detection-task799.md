---
name: dedup-detection-task799
description: Detecção de duplicata na criação de task (task #799/DEV-128) — método único SearchService reusado por HTTP + MCP, informativo nunca bloqueia
metadata:
  type: project
---

Task #799 (DEV-128, 2026-07-10): detecção de duplicata na criação de task. Cross-repo, INFORMATIVO — NUNCA bloqueia. Método único no backend, dois consumidores.

**Backend `Scrumban-Backend-V2`:**
- `SearchService.findPossibleDuplicates({nome,projectId,scope?,organizationId?,accessibleProjectIds?,excludeTaskId?,limit?})` reusa o helper PRIVADO `buildTokenizedTextFilter(nome,['nome'])` (#791) — mesma classe, título APENAS (duplicata é mesmo título, não descrição). matchType `exact` (nome ci-equal trim) vs `similar`; sort estável exatos primeiro; `take limit+5` buffer, `slice(limit)`. Escopo default `project` (idProject fixo). `dados.identifier` extraído com `typeof === 'string'`. 1 query, ZERO $queryRaw/N+1/Engine. Inclui DONE (só `excluido:false`, sem filtro de status — decisão #4).
- DTO `src/search/dto/task-duplicate.dto.ts` (TaskDuplicateDto: chave/identifier/nome/idProject/projectNome/idStatus/matchType/criadoEm).
- `GET /tasks/check-duplicates?nome=&projectId=&excludeTaskId?&limit?` no TasksController (DTO `check-duplicates-query.dto.ts`). **DECLARAR ANTES de `@Get(':id')`** senão o wildcard captura. Autorização = igual POST /tasks (`allowed.includes(projectId)` → 404 anti-enumeration). **TasksModule NÃO importava SearchModule** — adicionar aos imports (SearchModule exporta SearchService; sem ciclo). Controller ganhou 6º ctor param `searchService`.
- MCP `create-task.tool.ts`: 3º ctor param `searchService?: SearchService` OPCIONAL (Nest injeta em prod pois McpModule já importa SearchModule; testes 2-arg → undefined → attach pulado → back-compat byte-idêntica). Busca ANTES do create (evita auto-match), helper privado `findPossibleDuplicates` engole erro→`[]` (best-effort, nunca bloqueia). Retorno: `textResult(this.searchService ? {...(result as object), possibleDuplicates} : result)`.

**GOTCHA schema-consistency:** mudei a `description` da tool create_task → OBRIGATÓRIO atualizar `src/mcp/schemas/tools.schema.json` (o router serve descrições do JSON, e `mcp-tools.schema-consistency.spec` faz `expect(entry.description).toBe(tool.description)` deep-equal). inputSchema NÃO mudou (sem params novos).

**Baseline de testes (não regressão):**
- `npx jest src/mcp` = 4 suites FAIL SEMPRE no baseline (update-timer.tool, update-timer.integration, execute-task.integration TS2352, mcp-block-d fake-timer timeout) — nenhuma é minha. schema-consistency + scope-enforcement PASSAM.
- `npx jest src/tasks` = 8 suites/76 tests FAIL no baseline (confirmado via `git stash push -- tasks.controller.ts tasks.module.ts` → contagem IDÊNTICA). `tasks.controller.create-phase.e2e.spec.ts` já quebrado antes (não provê PunctualityMetricsService, index [4], nem SearchService) — spec desatualizado.
- Meus: search.service.spec +7 (findPossibleDuplicates), mcp-tools.create-task.spec +3 (attach/vazio/erro-não-bloqueia). Build `npm run build` (nest build) exit 0.

**Frontend `Scrumbam-Frontend-V2`:**
- `use-check-duplicates.ts` IMPERATIVO (não useQuery reativo): `checkDuplicates(nome,projectId)` via `queryClient.fetchQuery` (qk.tasks.duplicates, staleTime 15s), try/catch→`[]` (nunca bloqueia). `useCreateTask` intacto.
- `duplicate-warning-step.tsx`: overlay `position:absolute inset-0 zIndex:20` DENTRO do modal (`position:relative`) — cobre tabs+footer; usa estilo inline dark do próprio modal (NÃO shadcn Dialog, p/ não destoar), paleta âmbar espelhando semântica do TakeoverConfirmDialog (#795). `formatSince` reusado.
- `create-task-modal.tsx`: `handleCriar` virou async → valida → checkDuplicates → candidates>0 mostra passo, senão `doCreate()` direto (zero atrito). `doCreate` extraído; `handleOpenExisting` → `router.push('/lists/'+idProject)`. States dupStep/dupCandidates/checking resetados no open-effect. Footer `isCreating={createTask.isPending || checking}`.
- api.ts +`TaskDuplicateResult`; query-keys +`qk.tasks.duplicates(projectId,nome)`.
- **GOTCHA eslint frontend:** PostToolUse hook roda `eslint --max-warnings 0` por Edit no repo frontend também (acha package.json) → cada Edit precisa terminar lint-clean; warnings de import-antes-de-uso são transitórios esperados. `react-hooks/set-state-in-effect` reporta 1x por effect (o open-effect já tinha 1 disable e vários setState passam) → adicionar resets no mesmo effect é OK. `next build` NÃO gateia eslint; validar com `npx tsc --noEmit`+`npx eslint <arquivos>`. tsc/eslint/build exit 0.

**Desvios do plano (justificados):** (1) endpoint HTTP NÃO expõe `scope` na query (decisão #2 = só a lista; método suporta org p/ futuro). (2) UI não renderiza label de status por candidata — `idStatus` (id cru) está no payload mas mapear→label exigiria fetch per-project (atrito numa cortesia); matchType chip Idêntica/Parecida + projeto + "criada há X" cobrem o essencial. ADR-V2-072 (política dedup) fica p/ Documenter.

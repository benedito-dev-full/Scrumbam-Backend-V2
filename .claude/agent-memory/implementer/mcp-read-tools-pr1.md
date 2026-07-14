---
name: mcp-read-tools-pr1
description: PR1 das 3 MCP tools de leitura (get_task_tree/get_project_metrics/list_my_tasks) — checklist e gotchas de adicionar tools MCP read-only
metadata:
  type: project
---

# MCP read tools PR1 (get_task_tree / get_project_metrics / list_my_tasks)

ADR-V2-068 (scope `tasks:read`), 2026-06-17. Catálogo MCP 18→21 tools.

**Fato:** 3 tools de LEITURA adicionadas como wrappers finos sobre services já existentes (PhaseTreeService.buildTree, DashboardService.getDashboard + ForecastService.forecast, TasksService.findMany). ZERO Prisma direto, ZERO Engine, ZERO seed/DClasse/tabela.

**Why:** fechar lacunas de produtividade do agente MCP (árvore hierárquica, métricas/forecast, "meu trabalho").

**How to apply (ao adicionar tool MCP read-only nova):**
- Templates: `list-block-tasks.tool.ts` (gate+tenant+textResult) e `get-project.tool.ts` (Promise.all/2 services). Helpers em `tool-params.ts` (requireScope, assertRecord/optionalRecord, requiredString/optionalString, parseBigIntParam, optionalLimit, invalidParams, textResult, V3_STATUS_CODES).
- **inputSchema raiz SEMPRE `{type:'object', required:[...], properties}` — NUNCA anyOf/oneOf/allOf na raiz** (bug 4b0a947: cliente MCP descarta a tool). Condicionais no handler.
- `tools.schema.json` deve ser DEEP-EQUAL ao `inputSchema` da classe (spec `mcp-tools.schema-consistency`). `required: [] as string[]` vira `[]`; `enum: [...CONST]` vira o array literal. NÃO adicionar `additionalProperties` se a classe não tem (várias tools legadas não têm).
- `requireScope(ctx, MCP_SCOPES.TASKS_READ)` 1ª linha do handler.
- Tenant: leituras de PROJETO via MCP usam `tasks:read` (NÃO existe `projects:read`). `findAccessibleProjectIds` é a autoridade (contexto MCP não tem org JWT). 404 anti-enumeration (ADR-V2-042) para get-by-id; **listagem → lista vazia, nunca 404**.
- **assigneeId SEMPRE de `ctx.dEntidadeId.toString()`, nunca do input** (não expor no schema). Anti-fraude.

**Wiring (3 lugares, ordem importa):**
- `mcp-router.service.ts`: injeção POSICIONAL — params novos ENTRE `deleteTaskTool` e `configService` (configService é SEMPRE o último). Espelhar no array `tools` na MESMA ordem.
- `mcp.module.ts`: 3 providers + imports `FlowMetricsModule`/`ForecastModule` (ambos JÁ EXPORTAM DashboardService/ForecastService; TasksModule já exporta PhaseTreeService+TasksService — nenhum export novo necessário).
- `tools.schema.json`: append no FINAL.

**Specs de contagem/consistência a atualizar (achados reais, paths diferem do plano macro):**
- `mcp-tools.scope-enforcement.spec.ts`: +1 case por tool, com router posicional (cada tool no seu índice). Asserta FORBIDDEN + service não chamado.
- `mcp-tools.schema-consistency.spec.ts`: import + entrada em `buildRegisteredTools()` com a arity certa (GetTaskTree=3, GetProjectMetrics=3, ListMyTasks=2 args). Tem teste de cardinalidade (registeredTools.length == schemaEntries.length).
- `mcp-block-d.spec.ts`: `expect(toolsSchema.tools).toHaveLength(N)` + array de nomes na ORDEM EXATA do JSON (não a ordem do router — ex.: `execute_task` vem ANTES de `list_block_tasks` no JSON). Título do teste "tools/list retorna 16 tools" é STALE mas o assert real é o length.

**get_project_metrics — forecast tolerante:** `ForecastService.forecast` lança `BadRequestException` se histórico < 2 semanas. CAPTURAR no handler → `forecast: null` + `forecastError`; a tool NÃO falha (dashboard continua). `else { throw e }` para não engolir erros inesperados. NotFound do forecast não ocorre (gate de tenant já confirmou o projeto).

**get_task_tree:** valida `maxDepth` 1-20 no handler (o service faz clamp silencioso — preferimos INVALID_PARAMS). Gate prévio `tasksService.findOne(taskId, accessibleProjectIds)` por consistência ADR-V2-042 (buildTree já tem defense-in-depth por idProject, mas o gate é obrigatório).

**Frontend (Scrumbam-Frontend-V2):**
- `src/lib/mcp-scopes.ts`: adicionar nomes em `MCP_SCOPE_META[MCP_SCOPES.TASKS_READ].tools`.
- `src/app/(app)/ai/page.tsx`: catálogo `TOOL_GROUPS`. `TOOL_COUNT` é derivado (reduce) → atualiza sozinho. Coloquei get_task_tree/list_my_tasks em "Tarefas" e criei grupo novo "Métricas" (#ec4899) p/ get_project_metrics.

**Validação / baseline:**
- Backend: `npm run build` (`nest build`) FALHA SÓ por `src/realtime/*` (deps @nestjs/websockets/socket.io ausentes no dev) + `src/ai/providers/*` (@anthropic-ai/sdk, openai ausentes) — PRÉ-EXISTENTE, NÃO regressão. Validar com `npx tsc --noEmit` filtrando esses + 2 `*.integration.spec.ts` TS2352 (baseline). `make` NÃO existe.
- `npx jest src/mcp/` baseline = 4 suites failed / 26 passed, 3 tests failed / 259 passed (update-timer.tool, mcp-block-d fake-timer timeout, update-timer.integration TS2352, execute-task.integration TS2352). Com PR1 = 4 failed / 29 passed (+3 minhas suites), 3 failed / 294 passed (+35). ZERO regressão.
- ESLint hook por-edit é ERROR em no-unused-vars: ao adicionar imports antes dos usos, o hook bloqueia até o uso existir — faça import + uso no mesmo "lote" mental (vai bloquear nos edits intermediários, é esperado; o batch fica verde no fim).
- Frontend: `npx eslint <arquivos> --max-warnings 0` + `npx tsc --noEmit` ambos exit 0.

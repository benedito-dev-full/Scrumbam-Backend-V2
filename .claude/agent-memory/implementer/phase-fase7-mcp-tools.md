---
name: phase-fase7-mcp-tools
description: F7 ADR-V2-047 — MCP tools de phase (list_tasks idClasse filter, list_phases, get_phase_tree) — gotchas e padroes
metadata:
  type: project
---

# F7 ADR-V2-047 — MCP tools de phase

Branch `feature/dtask-fases-via-idpai`. Fase 7 do ADR-V2-047 (Fases via DTask.idPai). Sem Strategist novo — diretivas vieram inline do Orchestrator. 2 tools novas + 1 estendida + 3 specs novos.

## Arquivos alterados

- `src/mcp/tools/list-tasks.tool.ts` — adiciona campo `idClasse?: string` ao inputSchema + handler. Valida regex `^-?\d+$` antes de propagar para `TasksService.findMany` (que ja suporta `idClasse` desde F4 via `ListTasksQueryDto`).
- `src/mcp/tools/list-phases.tool.ts` — NEW. Wrapper sobre `findMany` com `idClasse='-200'` fixo + `projectId` obrigatorio. **NAO** computa metricas (anti N+1) — `includeMetrics` aceito mas IGNORADO; descricao do schema diz para usar `get_phase_tree`.
- `src/mcp/tools/get-phase-tree.tool.ts` — NEW. Delega para `PhaseTreeService.buildTree(BigInt(phaseId), { maxDepth, includeMetrics })`. Tenant gate explicito via `tasksService.findOne(phaseId, accessibleProjectIds)` ANTES do buildTree (mesma mensagem 404 anti-enumeration do REST).
- `src/mcp/schemas/tools.schema.json` — 14→16 tools. `list_tasks` description atualizado (menciona `idClasse`).
- `src/mcp/mcp.module.ts` — adiciona `ListPhasesTool` + `GetPhaseTreeTool` em providers.
- `src/mcp/services/mcp-router.service.ts` — adiciona 2 parametros opcionais no constructor ANTES do `configService` (sempre por ultimo). Append no array `tools[]`.
- `src/tasks/tasks.module.ts` — exporta `PhaseTreeService` (era apenas `TasksService`).
- `src/mcp/__tests__/mcp-tools.schema-consistency.spec.ts` — adiciona instancias em `buildRegisteredTools`.
- `src/mcp/__tests__/mcp-block-d.spec.ts` — atualiza `toHaveLength(16)` + array `[..., 'list_phases', 'get_phase_tree']`. 2 instanciacoes `new McpRouterService(...)` ganham +2 `undefined` (agora 16 antes do configService).
- 3 specs novos: `mcp-tools.list-tasks-phase-filter.spec.ts` (5 testes), `mcp-tools.list-phases.spec.ts` (9 testes), `mcp-tools.get-phase-tree.spec.ts` (11 testes).

## Gotchas

### 1. ESLint autofix em testes/imports

Quando adiciono `import { ListPhasesTool } from ...` num spec MAS ainda nao usei na funcao logo abaixo no MESMO Edit, o `PostToolUse:Edit` hook ESLint roda e remove o import (regra `@typescript-eslint/no-unused-vars`). Solucao: **agrupar import + uso PRIMEIRO USO no mesmo Edit**. Para `schema-consistency.spec.ts`, fiz dois Edits separados (1: imports / 2: usos) e o hook reverteu o primeiro. Quando re-aplico ambos juntos, passa. Aplica-se tambem ao `mcp.module.ts` e `mcp-router.service.ts` — adicionar import + provider/parametro de constructor + entrada no array no MESMO Edit.

### 2. `optionalLimit` em tool-params

`optionalLimit(input)` exige `input.limit` ser integer 1-50 ou ausente. Quando vejo `limit: 999` rejeitado com `INVALID_PARAMS field=limit`, isso e o `optionalLimit` fazendo seu papel.

### 3. PhaseTreeService.buildTree assinatura

`buildTree(rootId: bigint, options?: PhaseTreeOptions)`. `maxDepth` undefined → service usa default 20 hardcoded. O tool propaga `{ maxDepth: undefined, includeMetrics: false }` sem qualquer transformacao especial — `Math.min(Math.max(requestedDepth, 1), 20)` no service ja trata.

### 4. Tenant gate via `findOne` ANTES de `buildTree`

Padrao herdado do REST `tasks.controller.ts` (linhas 232-238). Mesmo `PhaseTreeService` ja faz seu proprio `resolveRootProjectId` (defense-in-depth via `idProject`), a tool MCP chama `tasksService.findOne(phaseId, accessibleProjectIds)` ANTES porque:
- Mensagem 404 identica ao "task nao encontrada" (anti enumeration uniforme)
- Falha rapido sem rodar CTE recursiva quando o caller nao tem acesso
- Em testes, mockar `findOne` cobre o cenario de scope sem precisar mockar a CTE

### 5. NotFoundException propaga como exception (nao result.error)

O router envolve em `try/catch` mas SO converte `McpToolError` e `McpTimeoutError`. `NotFoundException` do NestJS escapa para fora do `dispatch`. Specs validam com `rejects.toThrow(NotFoundException)`, NAO `result.error`. Mesmo padrao do `get_task` (Task #1).

### 6. `includeMetrics` em `list_phases` — desativado intencionalmente

Aceito no schema (com descricao explicita), mas o handler **ignora** quando `true`: apenas chama `findMany` normalmente. Razao: computar metricas por fase em listagem de 50 fases = N+1 garantido (50× CTE recursiva por chamada). Decisao escalavel: usuario que precisa de metricas chama `get_phase_tree(phaseId, includeMetrics=true)` por fase de interesse — ou um futuro `bulk_phase_metrics` (fora desta F7).

### 7. Cardinalidade — 3 lugares para atualizar

Ao adicionar tool nova:
1. `tools.schema.json` (entries)
2. `mcp.module.ts` providers
3. `mcp-router.service.ts` constructor params + `tools[]` array
4. `mcp-tools.schema-consistency.spec.ts` `buildRegisteredTools()` array
5. `mcp-block-d.spec.ts` `toHaveLength(N)` + nomes em `expect(...).toEqual([...])` + +1 `undefined` em cada `new McpRouterService(...)` que passa configService explicito (2 ocorrencias no block-d)

### 8. Numbers de tests finais

- F7 specs novos: 5 + 9 + 11 = **25 testes**
- Specs atualizados: schema-consistency (8) + block-d (6) = 14 mantidos
- MCP total: 158 testes em 19 suites (era ~133 antes)

## Padrao reaplicavel

Cada nova tool MCP segue:
1. Criar `*.tool.ts` em `src/mcp/tools/` implementando `McpTool`
2. Adicionar entry em `tools.schema.json` (deep-equal com `inputSchema` da classe — spec valida)
3. Registrar em `McpModule.providers`
4. Adicionar parametro opcional no constructor de `McpRouterService` ANTES de `configService` + push no array `tools[]`
5. Atualizar `mcp-tools.schema-consistency.spec.ts` (`buildRegisteredTools`)
6. Atualizar `mcp-block-d.spec.ts` (length + names + undefined counts)
7. Criar spec dedicado em `src/mcp/__tests__/mcp-tools.<name>.spec.ts`

Sempre **agrupar import + 1º uso no mesmo Edit** para nao tropecar no hook ESLint.

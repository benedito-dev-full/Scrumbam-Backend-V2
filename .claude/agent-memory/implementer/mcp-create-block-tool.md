---
name: mcp-create-block-tool
description: MCP tool create_block (write) — wrapper fino de TasksService.create idClasse=-200; catálogo 21→22; gotchas de registro/specs
metadata:
  type: project
---

# MCP tool `create_block` (Task #1 iniciativa create_*) — 2026-07-03

Tool MCP nova `create_block` (scope `tasks:write`), wrapper fino sobre `TasksService.create` com `idClasse='-200'` FIXO (FASE/BLOCO, ADR-V2-047/050). Completa CRUD de blocos (já havia list_blocks/list_block_tasks read + create_task idBloco). **Why:** agente MCP não conseguia criar a estrutura de fases sozinho. **How to apply:** molde EXATO = `create-task.tool.ts` (mesmas deps `TasksService`+`ProjectsService`, mesmo tenant gate `projectsService.findOne(projectId, ctx.dEntidadeId)` — herda ADR-V2-042/069, sem RBAC novo). inputSchema mínimo: `projectId`+`titulo` required, `descricao`+`idPai` opcionais. `titulo`→`nome` no DTO (maxLength 512), `descricao` maxLength 10000. Handler passa `{ projectId, nome, idClasse:'-200', ...descricao?, ...idPai?, source:'mcp' }` + `ctx.dEntidadeId`.

## Checklist de tool MCP nova (confirmado nesta task) — 4 pontos de registro
1. **`src/mcp/tools/<nome>.tool.ts`** — classe `implements McpTool`, `@Injectable`, deps no ctor.
2. **`src/mcp/schemas/tools.schema.json`** — FONTE DE VERDADE do `tools/list` (router lê `cachedToolDefinitions` daqui, NÃO das classes). Esquecer = tool despacha mas some da listagem. inputSchema no JSON deve ser **deep-equal byte** ao da classe (schema-consistency spec valida).
3. **`src/mcp/services/mcp-router.service.ts`** — import + param `xTool?: XTool` no ctor **ANTES de `configService?`** (configService é sempre o ÚLTIMO param) + `push` no array `tools`.
4. **`src/mcp/mcp.module.ts`** — import + entrada em `providers[]`.
   - `constants.ts` (MCP_SCOPES) e `mcp.types.ts` NÃO mudam se o scope já existe (`tasks:write` já existia).

## Specs que enumeram tools e QUEBRAM se não atualizadas (3)
- **`mcp-tools.schema-consistency.spec.ts`** → `buildRegisteredTools()`: add `new XTool(noop, noop)`. Valida cardinalidade (registeredTools.length == schemaEntries.length) + deep-equal name/description/inputSchema. Se esquecer, cardinalidade quebra.
- **`mcp-block-d.spec.ts`** → 2 pontos: `toHaveLength(21→22)` e append `'create_block'` ao array de nomes **na ORDEM do JSON** (append no fim = append no fim do JSON).
- **`mcp-tools.scope-enforcement.spec.ts`** → NÃO precisou tocar (usa 1 `it` por tool, sem loop/count global). O comentário topo diz "18 tools" mas é stale; sem assertion de contagem. Coloquei o teste de scope no MEU spec novo.

## Gotchas
- **Router ctor é posicional** mas DI resolve por TIPO (cada param tem classe distinta) → ordem no ctor é indiferente pra DI real; posição só importa nos `new McpRouterService(...)` manuais dos specs. `create_block` é o param índice 21 (após list_my_tasks=20), configService vira índice 22. No spec novo construí via `const args = new Array(21).fill(undefined); args.push(tool); new McpRouterService(...(args as never[]))`.
- **`mcp-block-d` timeout tests são PRÉ-EXISTENTES falhando** (baseline: 1 failed/5 passed, confirmado por git stash). Causa: configService drift posicional — o timeout test passa 16 args (configService no índice 15) mas o ctor já tinha configService no 21 (agora 22). Fake-timer nunca dispara. NÃO é regressão minha; o test "tools/list ordem/length" no mesmo suite PASSA após eu atualizar 22+append.
- **PostToolUse eslint hook roda em CADA Edit** e bloqueia (exit 2) em `no-unused-vars` quando adiciono o import ANTES de adicionar a usagem — o Edit PERSISTE mesmo assim; só continuar com a edição que usa o símbolo. JSON não é lintado pelo hook.
- Baseline MCP: 4 suites falhando SEMPRE (`update-timer.tool`, `update-timer.integration`, `execute-task.integration`, `mcp-block-d`) = mock drift `doneStatusRows`/fake-timer. Full suite após minha task: 4 failed/30 passed, 3 tests failed/304 passed — MESMAS 4, zero regressão.
- Build = `make build` (Makefile só chama `npm run build` = `nest build`) — PASSOU exit 0 nesta máquina Mac (diferente do Win onde faltavam deps src/realtime+src/ai). `TasksService.create(dto, creatorId, accessibleProjectIds?)` — tool passa 2 args. `idClasse` e `source` são campos válidos do CreateTaskDto (`@IsIn(['-154','-200'])`).

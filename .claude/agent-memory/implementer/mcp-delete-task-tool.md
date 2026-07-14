---
name: mcp-delete-task-tool
description: Como adicionar uma tool MCP nova (delete_task, ADR-V2-068) — registro, schema, specs e gotchas de enumeração estática
metadata:
  type: project
---

# MCP `delete_task` tool (ADR-V2-068, tasks:write) — 2026-06-17

Adicionar tool MCP nova ao Scrumban-Backend-V2 toca 7 pontos no backend (+2 front +2 docs).

**Why:** wrapper fino sobre `TasksService.delete` para deletar via MCP. Decisão CEO: gate `MCP_SCOPES.TASKS_WRITE`.

**How to apply (checklist de tool MCP nova):**
1. `src/mcp/tools/<x>.tool.ts` — `@Injectable` implements `McpTool`; `requireScope(ctx, ...)` ANTES de qualquer query; validar input com helpers de `tool-params.ts`; padrão de acesso 2-etapas (`tasksService.findOne(taskId)` + `projectsService.findOne(task.projectId, ctx.dEntidadeId)`) igual update_status/update_timer.
2. `mcp-router.service.ts` — import + novo param opcional no constructor (NA ORDEM, é posicional) + entrada no array `tools`.
3. `mcp.module.ts` — import + provider.
4. `tools.schema.json` — entrada com `name`/`description`/`inputSchema` DEEP-EQUAL ao da classe (a spec `schema-consistency` exige igualdade exata; se a classe NÃO tem `additionalProperties:false`, o JSON também não pode ter).
5. Spec própria `<x>.tool.spec.ts` (mirror de update-timer.tool.spec).
6. `mcp-tools.scope-enforcement.spec.ts` — atualizar comentário-cabeçalho (17→18), lista de scope, + 1 case FORBIDDEN.
7. `mcp-tools.schema-consistency.spec.ts` — import + entrada em `buildRegisteredTools()`.

**GOTCHAS CRÍTICOS:**
- **`TasksService.delete` retorna `{ affected: number }` NÃO void** (o prompt dizia void). Assinatura real: `delete(id: string, accessibleProjectIds?: string[], options?: { cascade?: boolean }, actorId?: bigint): Promise<{ affected: number }>`. `cascade` omitido → service usa default `true`.
- **`allowedProjectIds` = `[task.projectId]`** (string[]) — o acesso já foi validado pelos 2 findOne; passar o projeto exato evita alargar o gate redundante para "qualquer projeto". `task.projectId` é STRING no `TaskResponseDto`.
- **`tasksService.findOne(taskId)`**: chamar com 1 arg (igual update_status). A assinatura aceita 2º arg opcional `accessibleProjectIds`; update_timer chama com 2, update_status com 1 — ambos OK.
- **Enumeração estática stale**: `mcp-block-d.spec.ts` tem um teste que faz `toHaveLength(N)` + array de nomes EM ORDEM. Estava stale (15) já no baseline (real=17) — quem adicionou execute_task/update_timer não atualizou. A ORDEM dos nomes segue a ORDEM do `tools.schema.json`, não a do registro: `...list_blocks, execute_task, list_block_tasks, update_timer, delete_task`. Atualizar length e array ao adicionar tool.
- **Boolean opcional**: não há helper `optionalBoolean` em tool-params; o padrão é inline `typeof x !== 'boolean' → invalidParams(field,'boolean expected')` (igual update-project/list-block-tasks).

**Baseline de falhas PRÉ-EXISTENTES em `npx jest src/mcp/` (NÃO são regressão):**
- `update-timer.tool.spec`: 2 fails — (1) happy start espera `findOne(taskId, dEntidadeId)` 2-arg; (12b) membership.
- `update-timer.integration.spec` + `execute-task.integration.spec`: TS2352 (cast de JsonRpcResponse) → 0 testes rodam.
- `mcp-block-d.spec`: teste fake-timer "timeout em tools/call" (5002ms flake).
- `npm run build` (nest build) FALHA por `src/realtime/` (@nestjs/websockets + socket.io não instalados no dev). Gate real = `npx tsc --noEmit` (filtrar erros pré-existentes: realtime, anthropic/openai/gemini SDK, tenant-isolation arity, agents arity, ttl-cache spec) + `npx eslint <arquivos> --max-warnings 0`.

**Frontend (repo Scrumbam-Frontend-V2):** `src/lib/mcp-scopes.ts` (`MCP_SCOPE_META[TASKS_WRITE].tools` += 'delete_task') + `src/app/(app)/ai/page.tsx` (`TOOL_GROUPS` grupo "Tarefas"). Nota: `update_timer` ainda NÃO está no TOOL_GROUPS do ai/page.tsx (débito pré-existente, fora de escopo). Validar: `npx eslint <files> --max-warnings 0` + `npx tsc --noEmit` (ambos 0).

---
name: mcp-expansion-task1-gotchas
description: Gotchas e codepaths descobertos durante Task #1 da MCP Expansion (get_task tool); valido p/ Tasks #2-#8
metadata:
  type: project
---

# MCP Expansion — Task #1 (get_task) gotchas

**Fato:** Tasks #2-#8 do plano `workspace/plans/plan-mcp-expansion-8tools.md` vão TODAS modificar os mesmos 3 arquivos (`mcp.module.ts`, `mcp-router.service.ts`, `tools.schema.json`). Cada nova tool empurra a posição do `configService` no construtor do router.

**Why:** O construtor do `McpRouterService` mantém `configService` SEMPRE como último param opcional (padrão Nest DI). Adicionar uma tool no meio quebra os 2 testes em `mcp-block-d.spec.ts` que instanciam `McpRouterService` com `configService` posicional (linhas 84-91 e 110-112) — eles precisam ganhar 1 `undefined` a cada nova tool.

**How to apply:**
- Append-only no array `tools[]` do router e no JSON. NUNCA inserir no meio.
- Hardcoded `toHaveLength(N)` em `mcp-block-d.spec.ts:64` precisa ser incrementado a cada nova tool, junto com a lista de nomes esperados (linhas 65-71). Plano não documentou isso — descoberta da Task #1.
- O spec `mcp-tools.schema-consistency.spec.ts` é a SALVAGUARDA contra drift entre classe e JSON: cada nova tool só precisa ser adicionada em `buildRegisteredTools()`.

**Codepaths confirmados:**
- `TasksService.findOne(id: string, accessibleProjectIds?: string[])` — em `src/tasks/tasks.service.ts:360`. Tenant check: se `accessibleProjectIds !== undefined`, valida que `task.idProject` está no array; senão lança `NotFoundException` com mesma mensagem (anti enumeration).
- `ProjectsService.findAccessibleProjectIds(userEntidadeId: bigint, organizationId?: string)` — em `src/projects/projects.service.ts:433`. Quando `organizationId` omitido (caso MCP — cross-org by design), retorna TODOS os projetos onde o usuário é membro via DVincula -160..-179.
- `McpUserContext` — em `src/mcp/interfaces/mcp.types.ts`. NÃO tem `organizationId`. Tem `dEntidadeId: bigint`, `scopes`, `keyChave: bigint`, `keyPrefix`, `keyHash`.

**Padrão de propagação de exceções na tool:**
- `McpToolError` (gerado por `tool-params.ts` helpers como `invalidParams`) → router traduz para `JsonRpcError` no `dispatchTool` (linha 154-156).
- `NotFoundException`/`ForbiddenException` (de services) → NÃO são traduzidas pelo router; ele faz `throw error` (linha 168). Em testes, usar `rejects.toThrow(...)`, NÃO `expect(result.error)`.
- A tradução `NotFound`→404 HTTP só ocorre na camada de controller HTTP (interceptor Nest). No JSON-RPC, propaga como exception runtime.

**Spec pattern para tools MCP:**
- Use o padrão do `mcp-tools.block-b.spec.ts`: instancie `McpRouterService` com `new GetTaskTool(tasksService as never, projectsService as never)` (ou semelhante) e despache via `router.dispatch('tools/call', { name, arguments }, userCtx)`.
- Mock dos services com `jest.fn()` retornando dados shape-compatible. `mockResolvedValueOnce` para sequência de calls.
- TS strict: cast `as never` para mocks que não implementam toda a interface do service.

Relaciona-se com [[tenant-isolation-adr-v2-042]] (defense-in-depth ADR-V2-042 — `findAccessibleProjectIds` antes de `findOne` em tools MCP).

---
name: mcp-expansion-task2-gotchas
description: Gotchas e codepaths confirmados na Task #2 (update_task) da MCP Expansion — orquestracao condicional de 3 metodos do TasksService
metadata:
  type: project
---

# MCP Expansion — Task #2 (update_task) gotchas

**Fato:** Tool unica orquestra 3 metodos do TasksService (`update`, `updateSprint`, `updateStatus`) baseado em quais campos vem no payload. Re-hidrata via `findOne` ao final.

**Why:** LLMs lidam mal com tools-quase-iguais; concentrar em UMA tool com `anyOf` no schema simplifica `tools/list` e centraliza a logica de roteamento. Custo: ~50 linhas de orquestracao na tool.

**Confirmacoes de assinatura (importantes para Tasks #3-#8 que tocam o mesmo service):**

- `TasksService.update(id: string, dto: UpdateTaskDto, accessibleProjectIds?: string[])` — DTO em PT-BR: `{ nome?, descricao?, priority?, assigneeId?, taskType? }`. `assigneeId === ''` (string vazia) significa "limpar" (idAssignee=null); `assigneeId === undefined` significa "nao tocar". `priority === null` significa "limpar"; `priority === undefined` significa "nao tocar"; string valida → lookup DTabela.
- `TasksService.updateStatus(id, dto, actorId?, accessibleProjectIds?)` — 4 parametros, `accessibleProjectIds` no QUARTO arg. DTO: `{ status, movedBy? }`. Audit `task.status.changed` emitido APOS commit.
- `TasksService.updateSprint(id, dto, accessibleProjectIds?)` — DTO: `{ sprintId: string }` (NAO aceita null no DTO; se quiser desvincular sprint, precisa metodo separado).
- `TasksService.findOne(id, accessibleProjectIds?)` — retorna `TaskResponseDto`.

**Padrao de orquestracao condicional (template para tools futuras):**

```typescript
const accessibleProjectIds = await projectsService.findAccessibleProjectIds(ctx.dEntidadeId);
if (hasBasicUpdate) await tasksService.update(taskId, dto, accessibleProjectIds);
if (hasSprintUpdate) await tasksService.updateSprint(taskId, dto, accessibleProjectIds);
if (hasStatusUpdate) await tasksService.updateStatus(taskId, dto, ctx.dEntidadeId, accessibleProjectIds);
const final = await tasksService.findOne(taskId, accessibleProjectIds);
return textResult(final);
```

`accessibleProjectIds` resolvido UMA vez e propagado — evita 3 queries a `findAccessibleProjectIds` no mesmo handler.

**Schema com `anyOf` funciona:** `tools.schema.json` aceita `anyOf` na raiz do `inputSchema`. O LLM honra (Claude testado). Mas o validador interno do MCP NAO interpreta `anyOf` automaticamente — a validacao "ao menos 1 campo de update" precisa estar no handler tambem. Schema e documentacao; handler e enforcement.

**Hook ESLint PostToolUse:Edit + workflow Edit incremental:**
- Adicionar `import X` em um Edit + usar `X` em outro Edit = hook bloqueia entre os dois (no-unused-vars).
- Solucao: agrupar imports+usos no MESMO Edit, OU aceitar o "blocking error" temporario (proximo Edit corrige) e validar manualmente com `npx eslint <file>` ao final.
- Em 3 arquivos (mcp.module, mcp-router.service, schema-consistency.spec) o hook reclamou em dois Edits consecutivos mas o ESTADO FINAL passou em todos.

**Block-d spec (mcp-block-d.spec.ts) — append rule confirmado novamente:**
- 2 construtores `new McpRouterService(...)` ganham +1 `undefined` a cada nova tool (antes do configService).
- `toHaveLength(N)` e a lista de nomes esperados (linhas 60-68) precisam ser incrementados.
- Em Task #2: 6→7 tools. Tasks #3-#8 vao continuar somando.

**Testes — pattern de ordem de chamada:**
- Usar `mockImplementationOnce` com array compartilhado `callOrder: string[]` para validar sequencia.
- Mais robusto que `toHaveBeenCalledBefore` (Jest puro nao tem essa matcher por default — vem de jest-extended).

**Spec final: 17 testes (12 do DoD + 5 extras de qualidade), todos verde.** Total MCP: 78 testes passando.

Relaciona-se com [[mcp-expansion-task1-gotchas]] (padrao base) e [[tenant-isolation-adr-v2-042]].

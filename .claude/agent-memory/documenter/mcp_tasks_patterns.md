---
name: mcp-tasks-patterns
description: Patterns para documentação de MCP tools (Tasks #1-#8 F11 Expansion)
metadata:
  type: feedback
---

# MCP Tools Documentation Patterns — Task #1..#8 F11

## O que já foi entregue (Tasks #1, #2, #3, #7)

### Task #1: `get_task`
- **Tool:** `GetTaskTool`
- **Pattern:** Validação tenant isolation via `ProjectsService.findAccessibleProjectIds` + service validation
- **Spec pattern:** DRY via `mcp-tools.schema-consistency.spec.ts` (bidirecional classe ↔ tools.schema.json)
- **Registração:** Position [6] no array tools em `mcp-router.service.ts`

### Task #2: `update_task`
- **Tool:** `UpdateTaskTool`
- **Pattern:** 3+ helpers privados para extração de parâmetros opcionais com semântica clara
- **Registração:** Position [7] (append-only, nunca insert no meio)

### Task #3: `list_notifications`, `update_notification`, `get_unread_count`
- **Tools:** ListNotificationsTool, UpdateNotificationTool, GetUnreadCountTool
- **Especificidade:** BooleanString conversion (boolean → 'true'/'false') para compatibilidade DTO
- **Pattern notificationId:** Obrigatório em mark_read/delete, ignorado em mark_all_read (use `optionalString` + throw `invalidParams`)
- **Registração:** Positions [8, 9, 10]

### Task #7: `update_project`
- **Tool:** `UpdateProjectTool`
- **Especificidade:** Semântica ternária para teamId (undefined=no-op, null=desvincular, string=novo time)
- **Registração:** Position [10]

## Padrões detectados para Tasks #4, #5, #6, #8

### Tenant Isolation (ADR-V2-042) — PADRÃO UNIVERSAL
- SEM `organizationId` em McpUserContext (cross-org by design)
- Usar `ProjectsService.findAccessibleProjectIds(ctx.dEntidadeId)` ou equivalente
- Service propaga validação (anti-enumeration: 404 se fora do scope)
- Comentário explícito: "// ADR-V2-042: tenant isolation defense-in-depth"

### Helper Functions — padrão tool-params.ts
- `assertRecord(params)` — validação básica de Record
- `optionalLimit(input)` — clamp 1-50, default 20
- `optionalString(input, field)` — extração opcional
- `requiredString(input, field)` — extração obrigatória + throw invalidParams
- `parseBigIntParam(str, field)` — parse safe com throw invalidParams
- `textResult(data)` — envelope JSONRPC response

### Schema Consistency — PADRÃO REUTILIZÁVEL
Arquivo: `src/mcp/__tests__/mcp-tools.schema-consistency.spec.ts`
- Itera todas as tools (via `toolRegistry` ou require dinâmico)
- Valida bidirecional: classe presente em tools.schema.json ↔ entrada no schema.json
- 1 linha por tool nova (append-only, zero lógica especial)
- Mitigação R-3 do plano MCP expansion (consistência mecânica)

### JSDoc Template — MCP Tools
```typescript
/**
 * Tool MCP `tool_name` — [descrição em 1 linha].
 *
 * [Contexto adicional:
 *  - Usa cursor pagination / simplesmente retorna resultado
 *  - Filtros suportados
 *  - NAO usa Engine (estrutural via Service) OU usa Engine XXXX
 *  - Pilar aplicado]
 *
 * @example
 * ```json
 * {
 *   "jsonrpc": "2.0",
 *   "id": 1,
 *   "method": "tools/call",
 *   "params": {
 *     "name": "tool_name",
 *     "arguments": { ... }
 *   }
 * }
 * ```
 */
```

### Handler method — Estrutura padrão
```typescript
async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
  const input = assertRecord(params);
  // 1. Extração + validação params
  // 2. Logger.debug (incluir ctx.dEntidadeId, filtros principais)
  // 3. Chamada ao service (com tenant isolation se necessário)
  // 4. Return textResult(resultado)
}
```

## Checklist de Documentação — MCP Tool

- [ ] JSDoc na classe `McpTool` (descrevendo o que faz + contexto)
- [ ] JSDoc no método `handler` (descrevendo fluxo)
- [ ] @example com request JSONRPC JSON-RPC válido
- [ ] Menção explícita de Pilares (N/A ou qual pilar respeitado)
- [ ] ADRs mencionados (usualmente ADR-V2-001 + ADR-V2-042)
- [ ] CHANGELOG.md — entry em [Unreleased] → feat(mcp) com detalhes
- [ ] ROADMAP.md — atualizar task com score, status, deliverables
- [ ] STATUS.md — section "Task #N — COMPLETE" com consolidação MCP tools totais
- [ ] Registração em tools.schema.json (append-only, nunca insert)
- [ ] Registração em mcp.module.ts (import + providers array)
- [ ] Registração em mcp-router.service.ts (constructor param + tools array posição correta)
- [ ] Build PASS (`npx nest build`)
- [ ] Tests PASS (spec próprio + schema-consistency atualizado)
- [ ] Git commit Conventional scope(mcp) com body detalhado

## Próximas Tasks F11 (Entrega estimada)

- **Task #4:** `search_tasks` (cursor + filtros: projectId, assigneeId, status, priority, sprintId)
- **Task #5:** `create_task` (CUD completo — create_task, mas update/delete via Task #2 já existe)
- **Task #6:** `get_project_metrics` (read-only: counts, burndown, velocity)
- **Task #8:** Última tool (TBD — provavelmente automation ou channel-related)

**Total plano:** 10 tools (8 entregues = 80% feito)

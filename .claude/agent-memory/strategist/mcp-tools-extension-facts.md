---
name: mcp-tools-extension-facts
description: Fatos não-óbvios do MCP server V2 verificados ao planejar 6 novas tools — registro/scope/serviços de backend a reusar
metadata:
  type: project
---

Fatos verificados no código (2026-06-17) ao planejar 6 novas MCP tools. Plano em `workspace/plans/plan-mcp-novas-tools.md`.

**Onde o backend já tem o que envelopar (wrappers finos):**
- Flow metrics: `src/flow-metrics/services/dashboard.service.ts → getDashboard(pid: bigint, query)` (cycle/lead/throughput/wip/cfd). Controller usa OrgTenantGuard, mas MCP deve usar `findAccessibleProjectIds` como autoridade e chamar o service com `pid` direto.
- Forecast Monte Carlo: `src/forecast/forecast.service.ts → forecast(pid, query)` — lança `BadRequestException` se histórico < 2 pontos (tool deve capturar, não propagar).
- Árvore fase→task→subtask: `src/tasks/services/phase-tree.service.ts → buildTree(rootId, {maxDepth,includeMetrics})` — **JÁ IMPLEMENTADO (CTE recursiva), NÃO é stub**. O Swagger/JSDoc de `GET /tasks/:id/tree` e `/metrics` ainda diz "stub Fase 4 / 501" — está DESATUALIZADO.
- Criar bloco/fase: `tasksService.create(dto, userEntidadeId, allowed)` com `dto.idClasse='-200'` (ver `CreateTaskDto`). -200 ignora assignee/priority/taskType.
- Criar projeto: `projectsService.create(CreateProjectDto, userEntidadeId)`. idClasse -350 SPACE/-351 FOLDER/-352 LIST.
- Add member: `projectMembersService.addMember(projectId, {userId,role,cargo}, requesterId, organizationId?)` — role→idClasse (-171/-172/-173) já mapeado via `ROLE_TO_CLASSE`.
- Minhas tasks: `tasksService.findMany({assigneeId,...}, allowed)`.

**Armadilhas (não-óbvio):**
- **`mcp-router.service.ts` usa injeção POSICIONAL no construtor** (params 66–84) + array `tools` paralelo. `configService` é SEMPRE o último param. Adicionar tools novas ANTES dele, na mesma ordem nos dois lugares. Errar embaralha tools silenciosamente.
- **Tratamento de exceções no dispatch:** `mcp-router.service.ts:191-208` só trata `McpToolError`/`McpTimeoutError`. `NotFoundException`/`Conflict`/`BadRequest` de services precisam ser convertidas em `McpToolError` no handler (ou via helper `toMcpError`) — auditar antes de tools de escrita.
- **Scope `projects:write` cobre HOJE só `update_project`** (back `src/mcp/constants.ts` + front `Scrumbam-Frontend-V2/src/lib/mcp-scopes.ts`). Estender para `create_project`/`add_member` exige ADR (extensão de ADR-V2-068) + grandfathering implícito.
- **Contexto MCP NÃO tem JWT `organizationId`** (`McpUserContext` = dEntidadeId/scopes/key). Logo: herança ORG_ADMIN→MANAGER do `requireManagerRole` não ativa via MCP (só MANAGER explícito passa); `create_project` sem `orgId` nasce órfão de org.
- **Schema raiz:** PROIBIDO `anyOf/oneOf/allOf` na raiz do inputSchema (clientes descartam a tool — bug do update_task, commit 4b0a947). Condicionais no handler. `tools.schema.json` deve ser idêntico ao inputSchema da classe (há teste de consistência). Atualizar contagem em `mcp-block-d`.

Ver também [[mcp-scope-catalog]].

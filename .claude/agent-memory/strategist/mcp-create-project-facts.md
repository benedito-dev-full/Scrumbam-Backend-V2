---
name: mcp-create-project-facts
description: Fatos p/ tool MCP create_project — resolução de org sem token, resolveOrgIdsForUser (private→public), CreateProjectDto sem `source`, router re-lança Nest exceptions.
metadata:
  type: project
---

Planejamento da tool MCP `create_project` (Task 2/3 de "MCP cria estrutura"). Plano: `workspace/plans/plan-mcp-create-project-task2.md`.

**O miolo é RBAC/org (MCP não tem org de token):**
- SPACE (-350) precisa nascer numa org (`DProject.idEstab`). Resolução recomendada (híbrida): derivar via `ProjectsService.resolveOrgIdsForUser(userEntidadeId)` — 1 org→auto; N orgs sem `orgId`→erro claro; `orgId` de org alheia→FORBIDDEN; 0→erro. FOLDER/LIST (-351/-352) **herdam** org do pai via `findOne(idPai).orgId` (ignoram `orgId` do input) → subtree sempre na mesma org.
- `resolveOrgIdsForUser(userEntidadeId, {adminOnly?})` **já existe** (`projects.service.ts:734`) mas é **`private`** — usado no ramo MCP-sem-org de `findMany` (ADR-V2-069). Tornar **público** p/ o tool reusar (1 linha, zero lógica nova; duplicar violaria DRY/Pilar 2).

**Armadilhas confirmadas (verificadas 2026-07-03):**
- `CreateProjectDto` **NÃO tem campo `source`** (diferente de `CreateTaskDto` que aceita `source:'mcp'`). Não passar `source` ao `ProjectsService.create`.
- `mcp-router.service.ts:219` faz `throw error` p/ exceções não-`McpToolError` → Nest exceptions (`findOne` NotFound, `validateHierarchyRule` BadRequest) **propagam cru** (não viram JSON-RPC error no dispatch). `create_block` (aprovado) convive com isso; validações do próprio tool devem lançar `McpToolError` via helpers de `tool-params`.
- Scope: `MCP_SCOPES.PROJECTS_WRITE` existe mas hoje só `update_project` usa. Reusar p/ `create_project` = extensão de ADR-V2-068 → **ADR-V2-070 proposto** (widening bounded por membership; grandfathering). NÃO inventar `projects:create`.
- Schema plano: condicional idPai↔tipo e orgId↔ambiguidade vão no HANDLER; `enum` só na propriedade `idClasse` (permitido — não é combinador de raiz).
- Contagem de tools: **22→23** (`create_project` é o 23º; `create_block` foi o 22º). Atualizar `mcp-tools.schema-consistency.spec.ts` + `mcp-block-d.spec.ts`.
- Confirmar que `ProjectResponseDto` expõe `orgId` (mapeado de `idEstab`); se não, método fino `getProjectOrgId` no service (tool não acessa prisma).

Ver também [[mcp-tools-extension-facts]], [[mcp-camada-a-rbac-facts]], [[mcp-scope-catalog]].

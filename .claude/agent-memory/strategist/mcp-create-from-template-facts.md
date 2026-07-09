---
name: mcp-create-from-template-facts
description: Fatos p/ tool MCP create_from_template — createFromTemplate exige org, resolução por presença de idPai, autorização de origem grátis (global/org-scoped), 23→24 tools.
metadata:
  type: project
---

Planejamento da tool MCP `create_from_template` (Task 3/3, última, de "MCP cria estrutura"). Plano:
`workspace/plans/plan-mcp-create-from-template-task3.md`. Fecha o ciclo montar-workspace-via-MCP
(create_project + create_block + create_task + create_from_template).

**O miolo é AUTORIZAÇÃO DE ORIGEM + ORG DE DESTINO (o clone já está pronto):**
- Backend materializa template via `ProjectsService.createFromTemplate(id, userEntidadeId, organizationId, dto)`
  (`projects.service.ts:2007`) → aciona `cloneTree(fromTemplate=true, idEstabDestino=org)` (remap -401→-352, -402→-350).
  `CreateFromTemplateDto` = {includeTasks?, novoNome?, novoIcone?, idPai?} — **template é o `:id`, não vem no dto**;
  NÃO tem `orgId` nem `templateId` no dto.
- **createFromTemplate EXIGE org** (linha 2013-16: `BadRequestException` se `organizationId` vazio). MCP não tem org
  de token → a tool DEVE resolver org concreta antes de delegar (mesmo problema de Task 2).
- **Autorização de origem já embutida** (linha 2039): usável se `template.idEstab === orgResolvida` OU `=== null`
  (global); outra org → 404 leak-free. `cloneTree` **pula RBAC de origem** (usar ≠ gerenciar) — NÃO exige MANAGER na
  origem. Resolvendo a org de destino certo, a visibilidade de origem se resolve sozinha.
- **Resolução de org ramifica por PRESENÇA de `idPai` (não pela classe do template):** idPai presente → herda
  `findOne(idPai).orgId` (destino; findOne autoriza leitura, createFromTemplate revalida MANAGER); idPai ausente →
  `resolveOrgIdsForUser` (1 auto / orgId valida membership→FORBIDDEN / N ambíguo→INVALID_PARAMS / 0→erro). O service
  revalida classe↔idPai (LIST exige idPai, SPACE proíbe) e devolve BadRequest limpo se inconsistente. Copiar a
  resolução de `create-project.tool.ts:209-271`.

**Armadilhas / decisões:**
- Scope: reusa `projects:write` (ADR-V2-070). NÃO inventar `templates:materialize`. Sem ADR novo (coberto por
  V2-070 + V2-061 + V2-069); só registrar nuance "sem MANAGER na origem".
- Contagem tools **23→24** (`mcp-block-d.spec.ts` tem literal; `mcp-tools.schema-consistency.spec.ts` usa
  `buildRegisteredTools()` array → só add `new CreateFromTemplateTool(noop)`, arity 1).
- Router (`mcp-router.service.ts`) = **args posicionais**; novo tool ANTES de `configService?` (sempre último) + push no array. Module providers.
- Nest exceptions do service propagam CRUAS pelo router (:222 `throw error`); validações de shape do tool usam `McpToolError`. OK (paridade create_project/create_block).
- `ProjectResponseDto.orgId` existe (mapeado de idEstab) — create_project já lê `parent.orgId`.
- Edge documentado: template org-scoped de orgB + orgId=orgA (user em ambas) → 404 (correto: template deve ser visível da org de destino escolhida).

Ver também [[mcp-create-project-facts]], [[mcp-scope-catalog]], [[mcp-tools-extension-facts]].

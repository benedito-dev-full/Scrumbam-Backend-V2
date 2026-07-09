---
name: mcp-create-project-tool
description: MCP tool create_project (ADR-V2-051/069/070) — wrapper sobre ProjectsService.create com resolução de org por tipo
metadata:
  type: project
---

# MCP tool `create_project` (Task 2, 2026-07-03)

Wrapper fino de `ProjectsService.create` para criar Space(-350)/Folder(-351)/List(-352) via MCP. Molde = `create-block.tool.ts`. Catálogo 22→23.

**Why:** MCP lia/atualizava projeto mas não criava; com create_project + create_block + create_task o agente monta Space→Folder→List→Bloco→Task sem UI.

**How to apply (checklist de tool MCP nova — 4 pontos de registro + specs):**
1. `src/mcp/tools/create-project.tool.ts` — dep única `ProjectsService`; scope `MCP_SCOPES.PROJECTS_WRITE` (reusado, constants.ts intacto).
2. `tools.schema.json` — espelho byte-a-byte do inputSchema (append como ÚLTIMA, índice 22). `enum` só na propriedade idClasse; NADA de anyOf/oneOf/allOf na raiz.
3. `mcp-router.service.ts` — import + param `createProjectTool?` no ctor APÓS `createBlockTool` ANTES de `configService` + push no array (mesma posição). Wiring POSICIONAL.
4. `mcp.module.ts` — import + provider.
5. specs de cardinalidade: `mcp-block-d.spec.ts` (length 22→23 + append 'create_project' na lista ORDENADA) e `mcp-tools.schema-consistency.spec.ts` (import + `new CreateProjectTool(noop)` em buildRegisteredTools — cardinalidade compara com JSON).
6. `scope-enforcement.spec.ts` NÃO precisou mudar (projects:write já existia).

**Miolo — resolução de org (o adaptador MCP não tem org de token):**
- SPACE(-350): `resolveOrgIdsForUser(dEntidadeId)` (tornado PÚBLIC — era private, 1 linha). 1 org→auto; N sem orgId→INVALID_PARAMS ambíguo; orgId∉set→FORBIDDEN; 0→INVALID_PARAMS. idPai proibido. NUNCA nasce sem idEstab (senão órfão invisível Camada A, ADR-V2-069).
- FOLDER/LIST(-351/-352): exigem idPai; herdam `findOne(idPai).orgId` (autoriza pai + herda org); orgId do input IGNORADO. `ProjectResponseDto.orgId` já existe.
- `descricao` (MCP) → `description` (DTO). `create()` intocado (Pilar 2).

**Helper novo:** `optionalBoolean` em `tool-params.ts` (exige boolean real, `"false"` string→INVALID_PARAMS). Usado por `privado`.

**GOTCHAS:**
- Router ctor: create_project índice 22, configService 23. Spec buildRouter: `new Array(22).fill(undefined)` + push tool. create-block spec (`new Array(21)`) segue válido — createBlockTool continua índice 21.
- Hook eslint roda a CADA Edit: import novo sozinho = `no-unused-vars` bloqueante → adicionar ctor param/provider no MESMO ciclo (ou aceitar o bloqueio e completar a seguir; o arquivo persiste).
- Baseline mcp: 4 suites SEMPRE falhando (execute-task.integration, update-timer.integration, update-timer.tool ×2, mcp-block-d fake-timer) — confirmado por stash. NÃO são regressão.
- `make build` = `npm run build` (nest build) EXIT 0. gate = build (nest exclui specs).
- 19 specs novos verdes; jest src/mcp = 3 failed/323 passed (só os 4 known suites).

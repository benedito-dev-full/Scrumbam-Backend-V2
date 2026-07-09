---
name: mcp-camada-a-rbac-facts
description: Por que admin não vê toda a workspace via MCP — Camada A desliga sem organizationId; getProjectRole já tem a herança; fix em 3 métodos de ProjectsService.
metadata:
  type: project
---

Gap de RBAC: ORG_ADMIN (DVincula -161) com chave MCP só vê projetos que criou, não a workspace.

**Causa estrutural (não óbvia):** `ProjectsService` tem 2 camadas de visibilidade — Camada B (DVincula direta -171/-172/-173, liga sempre) e Camada A (espaços públicos do SPACE -350 + herança ORG_ADMIN→MANAGER, liga SÓ se `organizationId` presente). HTTP passa `organizationId` (do JWT); MCP não tem org → Camada A nunca liga no MCP. Criador vê porque `createManagerLink()` lhe dá -171 (Camada B).

**Os 3 métodos que pulam Camada A sem org (chokepoints de TODOS os read tools MCP):**
- `findMany(userEntidadeId, opts)` — usado por `list_projects`.
- `findAccessibleProjectIds(userEntidadeId, organizationId?)` — usado por list_tasks, list_my_tasks, get_project, get_task_tree, get_project_metrics, list_members, search_tasks.
- `findOne(id, userEntidadeId, organizationId?)` — gate de projeto único.
Consertar os 3 corrige 9+ tools SEM tocar arquivo de tool nem `McpUserContext`.

**Reuso-chave:** `RoleResolverService.getProjectRole` (src/auth/services/role-resolver.service.ts) JÁ resolve herança ORG_ADMIN→MANAGER e fallback de espaço público SEM token, derivando org de `project.idEstab` (`resolveOrgAdminRole`/`resolvePublicSpaceRole`). Guards de mutação já respeitam admin; só os 3 reads de leitura ficaram para trás → assimetria leitura↔autorização. `listPublicSpaceProjectIds(prisma, orgId)` (public-space.util.ts) é a CTE batch da Camada A.

**Decisão de design recomendada:** ativar Camada A no MCP derivando org das memberships (helper `resolveOrgIdsForUser`), só no ramo `organizationId === undefined` (HTTP intocado). Público apenas (não privados) = leak-free + paridade HTTP. Decisões abertas p/ CEO: (1) admin-only vs todos os membros; (2) público vs incluir privados (Alternativa B = paridade com getProjectRole). ADR-V2-042 documentou de propósito "MCP exige membership direto" → este fix EXIGE estender (ADR-V2-069 proposto).

Plano: workspace/plans/plan-mcp-rbac-admin-org-visibility-task1.md

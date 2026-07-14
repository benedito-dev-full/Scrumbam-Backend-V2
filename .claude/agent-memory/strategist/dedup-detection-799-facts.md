---
name: dedup-detection-799-facts
description: Task #799 — detecção de duplicata na criação de task (backend+MCP+frontend); método único SearchService.findPossibleDuplicates reusando #791.
metadata:
  type: project
---

Task #799 (DEV-128): detecção de duplicata ao criar task. Cross-repo. Plano: `workspace/plans/plan-799-dedup-detection.md`. Origem: ADR-077 (Rizar), incidente 2026-07-07.

**Abordagem canônica — MÉTODO ÚNICO:** `SearchService.findPossibleDuplicates({nome, projectId, scope?, organizationId?, accessibleProjectIds?, excludeTaskId?, limit?})` reusa o `buildTokenizedTextFilter` privado da **#791 (DEV-120)** sobre `['nome']` (título apenas). ZERO $queryRaw, read-only, Pilar 2. Consumido por dois caminhos:
- **UI:** novo `GET /tasks/check-duplicates?nome&projectId` no TasksController (mesma autorização do POST /tasks: `projectId ∈ accessibleProjectIds`, 404 anti-enum). TasksModule precisa importar SearchModule (hoje não importa; McpModule já importa).
- **MCP `create_task`:** busca ANTES de `tasksService.create` (evita auto-match), anexa `possibleDuplicates[]` ao textResult. NÃO bloqueia. CreateTaskTool só injeta SearchService (wiring já existe).

**Contrato possibleDuplicates[]:** `{chave, identifier(DEV-N de dados.identifier), nome, idProject, projectNome, idStatus, matchType('exact'|'similar'), criadoEm}`. Exatos primeiro (JS sort; ci-equal do nome).

**Frontend (Scrumbam-Frontend-V2):** chokepoint = `src/components/tasks/create-task-modal.tsx` (`handleCriar`). Inserir passo intermediário: check → se candidatos, `duplicate-warning-step.tsx` (espelhar TakeoverConfirmDialog/#795) com "Criar mesmo assim"; se vazio, cria direto (zero atrito). Hook novo `use-check-duplicates.ts` (padrão de `use-search.ts`). `useCreateTask` em `src/hooks/use-tasks.ts` inalterado.

**Decisões p/ Roberio:** (1) limiar=AND-flexível #791 sobre título, exact vs similar; (2) escopo default=mesma lista (org opcional); (3) top N=5; (4) incluir DONE/arquivadas? recomendo incluir exibindo status; (5) outras superfícies de criação (quick-add inline) fora de escopo agora; (6) self-match em edição já coberto por excludeTaskId + busca-antes.

Ver também [[mcp-tools-extension-facts]].

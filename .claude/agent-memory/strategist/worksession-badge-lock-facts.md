---
name: worksession-badge-lock-facts
description: Task #794 — badge "em trabalho" + trava concorrência MCP via dados.telemetry.workSessions; onde workSession abre/fecha, identidade do lock, esqueleto dos tools de escrita.
metadata:
  type: project
---

Task #794 (DEV-123): badge visual + trava MCP sobre `DTask.dados.telemetry.workSessions[]`. Plano: `workspace/plans/plan-794-badge-mcp-lock.md`.

**Fonte workSession (verificado 2026-07-10):**
- `WorkSession = { startedAt, endedAt?, agentId? }` em `src/tasks/schemas/task-dados.schema.ts`. SEPARADO de `manualTimers[]` (ADR-V2-057 — não confundir).
- Escrito SÓ por `TasksService.updateStatus` (`tasks.service.ts:1293-1308`): EXECUTING → push `{startedAt, agentId: dto.movedBy ?? null}`; DONE → fecha última aberta. **FAILED/CANCELLED NÃO fecham** (sessão fica aberta, mas status sai de EXECUTING → status é o gate real).
- `agentId = dto.movedBy`. No MCP, `movedBy = ctx.dEntidadeId.toString()`. Logo **identidade do lock = open-session.agentId (DEntidade.chave string) vs ctx.dEntidadeId**. Mesmo → passa; outro → bloqueia.

**Trava é MCP-only (decisão de design):** requisito diz "o MCP JAMAIS pode". Colocar em TasksService bloquearia UI humana → indesejado. Guard vive na camada MCP; roda ENTRE `projectsService.findOne` e a mutação. Opera sobre o `TaskResponseDto` que o tool JÁ carregou (`findOne`) → ZERO query extra no caminho feliz; nome do dono hidratado só no bloqueio (frio).

**5 tools de escrita a travar** (todos mesmo esqueleto `requireScope → findOne → projectsService.findOne(projectId, dEntidadeId) → mutar`): `update_task`, `update_status`, `update_timer`, `execute_task`, `delete_task`. Tools de create/notification/project ficam de fora. Contagem MCP 24→24 (NÃO tocar tools.schema.json / specs de contagem).

**Badge (read-path):** `TaskResponseDto` já expõe `dados` cru (front tem workSessions), mas SÓ `agentId` — sem nome. Add campo `activeWorkSession {agentId, agentName, startedAt}` em `buildResponse`; hidratar nome em batch (padrão `TaskTimerService.hydrateUserNames`/`buildTimerStateMap`, ZERO N+1). Alt sem backend: front casa agentId com `useProjectMembers`.

**Pilares:** Engine NÃO se aplica (DTask estrutural, dados JSON) — proibido usar Engine. Endpoint reuso total (badge em GET /tasks[/:id]; lock dentro dos tools). Zero DClasse/tabela nova.

**Edge cases (decisões p/ CEO):** (1) sessão órfã → TTL staleness (default ~2h); (2) agentId null → bloquear conservador vs permitir; (3) update_timer travar ou isentar (é humano); (4) erro MCP: reusar `INVALID_PARAMS reason='task_locked'` (precedente `timer_conflict`) vs novo `-32004 TASK_LOCKED`; (5) TOCTOU race aceito como residual.

**Frontend (Scrumbam-Frontend-V2):** tipo em `src/lib/types/api.ts` (TaskResponseDto mirror); card kanban `src/components/tasks/kanban-board.tsx`; linha lista `src/app/(app)/lists/[id]/_components/task-row-backend.tsx`; abertura `src/components/tasks/task-sheet.tsx`. Next16/React19, dnd-kit, tanstack-query.

Ver também [[mcp-tools-extension-facts]], [[mcp-camada-a-rbac-facts]].

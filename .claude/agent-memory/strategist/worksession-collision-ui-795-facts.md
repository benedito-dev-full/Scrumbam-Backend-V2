---
name: worksession-collision-ui-795-facts
description: Task #795 — guard de UI (confirm dialog) ao mover→EXECUTING/reatribuir task com activeWorkSession de outro; superfícies de interceptação no Scrumbam-Frontend-V2 e por que o guard de move quase nunca dispara.
metadata:
  type: project
---

Task #795 (DEV-124): diálogo de confirmação humano na UI, irmã da #794. Plano: `workspace/plans/plan-795-confirm-dialog-executing.md`. **Frontend-only, ZERO backend** — `activeWorkSession {agentId,agentName,startedAt}` já chega da #794 em `GET /tasks` (list) e `GET /tasks/:id`; TTL órfã já resolvido server-side (sessão velha chega `null`).

**Predicado colisão:** `activeWorkSession && agentId && agentId !== useAuthStore(s=>s.user?.entidadeId)`. `activeWorkSession != null` já implica status EXECUTING. Identidades (agentId/assigneeId/member.userId/entidadeId) = DEntidade.chave string, comparação direta.

**Superfícies de interceptação (Scrumbam-Frontend-V2, verificado 2026-07-10):**
- Move→EXECUTING (via `useUpdateTaskStatus`, `PUT /tasks/:id/status`): `src/components/tasks/kanban-board.tsx` (`handleDragEnd`, drag p/ coluna em-progresso); `task-sheet.tsx` (`handleStatusChange`, StatusSelect); `task-detail-drawer.tsx` (`StatusPicker.onChange`); `src/app/(app)/lists/[id]/_components/task-row-backend.tsx` (`handleStatusChange`, TaskStatusCell).
- Reatribuir (via `useUpdateTask`, `PUT /tasks/:id`): `task-row-backend.tsx` (`handleAssigneeChange`+`handleTeamChange`); `task-detail-drawer.tsx` (`AssigneePicker` onChange/onTeamChange); `task-sheet.tsx` (`handleAssigneeTeamChange` — **só time**, sheet não reatribui usuário).

**Dois drawers de detalhe coexistem:** `TaskSheet` (lista via onOpenTask) e `TaskDetailDrawer` (kanban não-controlado) — ambos precisam do guard. Picker de assignee-USUÁRIO só em task-row-backend e task-detail-drawer.

**Insight-chave:** guard de **reatribuir** é load-bearing (task já EXECUTING → sessão no cache → dispara). Guard de **move→EXECUTING** quase nunca dispara com dado cacheado (ao mover, origem ≠ EXECUTING → activeWorkSession null); só dispara ao **re-selecionar EXECUTING via dropdown** numa task já executando. Corrida "2 iniciam do READY juntos" NÃO é pegável sem refetch (staleness) — autoridade real = backend/MCP #794; diálogo é cortesia. Kanban-drag guard é defensivo.

**Reuso:** `@/components/ui/dialog` (shadcn) + espelhar `DeleteTaskDialog`. Propor hook `useWorkCollisionGuard` + `TakeoverConfirmDialog` + extrair `formatSince` de work-session-badge.tsx.

Ver também [[worksession-badge-lock-facts]].

---
name: collision-guard-frontend-task795
description: Frontend-only takeover confirm dialog on move→EXECUTING / reassign (repo Scrumbam-Frontend-V2), sister of #794 badge; plus eslint-per-edit hook gotcha
metadata:
  type: project
---

Task #795 (DEV-124) — diálogo de confirmação de "takeover" quando um HUMANO move uma task para EXECUTING ou reatribui responsável de uma task já em sessão de trabalho de OUTRO. **100% frontend**, repo `Scrumbam-Frontend-V2` (NÃO o backend, NÃO o legado `Scrumbam-FrontEnd`). Irmã da #794 (badge `WorkSessionBadge` + trava MCP). Zero backend: `activeWorkSession {agentId, agentName, startedAt}` já chega em `GET /tasks` e `GET /tasks/:id`.

**Why:** incidente 2026-07-07 (dois membros quase colidiram na mesma task). A trava dura é MCP-only por design (#794); a UI humana NÃO é bloqueada server-side → #795 é guard de cortesia no cliente.

**How to apply (padrão reusável para colisão de trabalho no front):**
- Fonte única do predicado + estado: hook `src/hooks/use-work-collision-guard.ts` → `run(task, proceed)` + `dialogProps`. Colisão = `activeWorkSession && agentId && agentId !== me`, com `me = useAuthStore(s => s.user?.entidadeId ?? null)`. Sem colisão → `proceed()` imediato. `agentId===null` e sessão órfã (backend manda `null`) passam em silêncio.
- Dialog `src/components/tasks/takeover-confirm-dialog.tsx` espelha `DeleteTaskDialog` sobre `@/components/ui/dialog` (shadcn) — paleta âmbar p/ casar com o badge. Prop `actionLabel: "assumir" | "mover"`. Portaliza para body → seguro renderizar dentro de `<tbody>`/fragment de `<tr>`.
- `formatSince` extraído de `work-session-badge.tsx` para `src/lib/format-since.ts` (reuso badge+dialog, "há X" idêntico).
- 7 handlers em 4 arquivos: `kanban-board.tsx handleDragEnd`, `task-sheet.tsx` (handleStatusChange + handleAssigneeTeamChange), `task-detail-drawer.tsx` (StatusPicker + AssigneePicker onChange/onTeamChange), `task-row-backend.tsx` (handleStatusChange + handleAssigneeChange/handleTeamChange). Regra: mover→EXECUTING guarda **só quando o alvo é EXECUTING** (sair p/ DONE/FAILED não pergunta); reatribuições sempre `run(task, doIt)`.
- **Otimista dentro do proceed**: kanban `setQueryData` + sheet `setStatusVisual` movidos para dentro do `proceed`, senão o Cancelar deixaria a UI adiantada. StatusPicker do drawer entrega V3Intention direto (`onChange(intention)`, "em-progresso"→"EXECUTING" via COLUMN_TO_INTENTION). Sheet/row usam `VISUAL_TO_INTENTION`/`VISUAL_TO_INTENTION_ROW["em-progresso"]="EXECUTING"`.

**GOTCHA harness (Scrumbam-Frontend-V2):** existe um PostToolUse hook de ESLint com `--max-warnings 0` que roda a CADA Edit/Write no arquivo salvo. Import adicionado mas ainda não usado → hook BLOQUEIA (exit 2) com "defined but never used". O arquivo É gravado mesmo assim; a solução é só completar o wiring (import→uso→render) e terminar cada arquivo em estado lint-clean. Não há como evitar os avisos intermediários com Edits sequenciais. Um formatter (Prettier) também reescreve o arquivo no PostToolUse:Write.

**Verificação:** NÃO existe script `typecheck` no package.json — usar `npx tsc --noEmit` (exit 0). `npm run build` = `next build` (exit 0, "Compiled successfully"); `next build` NÃO roda eslint como gate, então validar lint à parte com `npx eslint --max-warnings 0 <arquivos>`. Repo do front é git SEPARADO do backend.

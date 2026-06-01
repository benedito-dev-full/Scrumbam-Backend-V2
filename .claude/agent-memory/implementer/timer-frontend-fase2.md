---
name: timer-frontend-fase2
description: Fase 2 (frontend) do Timer de Tempo por Tarefa (ADR-V2-057) — hook + painel no drawer, repo Scrumbam-Frontend-V2
metadata:
  type: project
---

# Timer de Tempo por Tarefa — Fase 2 FRONTEND (ADR-V2-057, 2026-06-01)

Repo: `Scrumbam-Frontend-V2`, branch `feature/integracao-frontend-v2-hierarquia`. Plano: `workspace/plans/plan-tasks-timer-tempo-por-tarefa-task57.md` (seção 5 Fase 2). Backend Fase 1 já mergeada (commit f34bebe): 4 endpoints `POST /tasks/:id/timer/{start,pause,resume,stop}` (body vazio, userId do JWT, 409 em conflito) e `TaskResponseDto.timer: TaskTimerStateDto | null`.

**4 arquivos (2 novos, 2 modificados — só ADITIVO):**
1. `src/lib/types/api.ts`: `TaskTimerUserTotal {userId, userName|null, totalMs}` + `TaskTimerState {running, runningUserId|null, runningStartedAt|null, totalsByUser[]}` (bloco antes de `TaskResponseDto`); campo `timer?: TaskTimerState | null` em `TaskResponseDto` (entre `activeExecution` e `dados`).
2. `src/hooks/use-task-timer.ts` (NOVO): `useTaskTimer(taskId, projectId, timer)` — 1 `useMutation<TaskResponseDto, Error, TimerAction>` (action é start/pause/resume/stop), `onSuccess` invalida `qk.tasks.byId` + `qk.tasks.byProject`. Cronômetro visual: `useState(()=>Date.now())` + `setInterval(1000ms)` SÓ quando `isRunningMine`; `displayMs = myClosedTotalMs + (now - runningStartedAt)`. `myEntidadeId = useAuthStore(s=>s.user?.entidadeId)`. Helper exportado `formatDuration(ms)` → "Xh Ymin Zs" (omite unidades zero de ordem superior; "0s" p/ ≤0).
3. `src/components/tasks/task-timer-panel.tsx` (NOVO): espelha estilo do `AiExecutionPanel` (card `rounded-xl border bg .../5 p-3.5`) mas em SKY (azul) p/ distinguir do violet da IA. Ícones lucide `Clock/Play/Pause/Square/Loader2/User`. Botões: Iniciar (running=false), Pausar+Parar (isRunningMine), Retomar desabilitado (isRunningOther), Retomar extra (!running && displayMs>0). Aviso "Timer aberto por [nome] desde [hora]" quando `isRunningOther` (COULD HAVE do plano) — nome resolvido de `totalsByUser` primeiro, fallback `useProjectMembers`. Lista "Totais por usuário".
4. `src/components/tasks/task-detail-drawer.tsx`: import + `<Field label="Tempo de trabalho"><TaskTimerPanel .../></Field>` entre Responsável e o painel de IA. ZERO mudança de design existente.

**GOTCHA eslint `react-hooks/set-state-in-effect`** (regra ATIVA neste repo, é ERROR não warning): chamar `setState()` SÍNCRONO no corpo de um `useEffect` falha o lint. Solução: NÃO chamar `setNow(Date.now())` síncrono dentro do effect — deixar só o `setInterval` atualizar. O `useState(()=>Date.now())` inicial cobre o 1º render; primeiro tick em ≤1s é aceitável p/ cronômetro visual.

**Anti-fraude:** body sempre `{}`, nunca envia duração; total exibido = `totalMs` server-side do response; durante running soma só o offset visual `(now - runningStartedAt)`.

**Gates verdes:** `npx tsc --noEmit` 0 erros; `npx eslint <4 arquivos>` 0; `npm run build` (next build) "✓ Compiled successfully". NÃO comitado (CEO controla commits). `next build` NÃO roda eslint como gate — validar eslint separado. Confirmar persistência com `git diff --stat` (harness às vezes reporta success espúrio).

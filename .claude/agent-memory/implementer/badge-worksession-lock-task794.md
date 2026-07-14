---
name: badge-worksession-lock-task794
description: Badge "em trabalho por Fulano" (activeWorkSession no TaskResponseDto) + trava de concorrência MCP por workSession (task #794/DEV-123), cross-repo
metadata:
  type: project
---

# Task #794 (DEV-123) — Badge workSession + Trava concorrência MCP (2026-07-10)

Badge "em trabalho por Fulano" + trava MCP sobre `DTask.dados.telemetry.workSessions[]` (ADR-V2-057, fluxo de IA — NÃO confundir com `manualTimers`/`timer` humano).

**Why:** incidente 2026-07-07 (2 pessoas na mesma task). Decisões travadas do Roberio: #1 TTL 2h de sessão órfã; #2 agentId nulo→bloquear; #3 `update_timer` ISENTO; #4 `INVALID_PARAMS reason='task_locked'` c/ `{lockedBy:{agentId,agentName},since}`; #5 backend hidrata agentName.

**How to apply:**
- Fonte ÚNICA `src/tasks/work-session.util.ts::resolveActiveWorkSession(telemetry,status,nowMs?)` — pura, aplica TTL 2h (`WORK_SESSION_STALE_MS`), retorna sessão aberta SÓ se status==='EXECUTING'. Compartilhada por badge E trava. `status` deriva de `dados.v3.state` (mesma derivação de buildResponse).
- Badge: `ActiveWorkSessionDto{agentId,agentName,startedAt}` em task-response.dto; `buildResponse` ganhou 6º param `workSessionMap` + fallback síncrono (agentName null em mutações, igual padrão do `timer`); `TasksService.buildWorkSessionMap` (batch de nomes 1 query, ZERO N+1) wired em findMany/findOne. Front espelha em `Scrumbam-Frontend-V2/src/lib/types/api.ts` (`ActiveWorkSession`).
- Trava: `src/mcp/tools/task-concurrency.guard.ts::assertTaskNotLockedByOther(task, callerId)` — FUNÇÃO PURA (não @Injectable → zero DI/módulo/router, mantém 24→24). Decisão via `resolveActiveWorkSession` (robusto); nome no erro reusa `task.activeWorkSession.agentName` já hidratado pelo findOne (ZERO query extra até no bloqueio). Mesmo dono passa; agentId null→bloqueia.
- Plugado em 4 tools APÓS `projectsService.findOne`, ANTES da mutação: update-status/execute-task/delete-task (já tinham `task=findOne(taskId)`). **update_task NÃO fazia findOne antes** — adicionei `findOne(taskId, accessibleProjectIds)` no início (também vira gate de tenant); efeito colateral: findOne 2x → spec `mcp-tools.update-task.spec.ts` precisou ajuste (times 1→2; ordem `findOne→update→updateStatus→findOne`; testes de tenant (j)/(aa) agora esperam NotFound do findOne inicial, não do update).

**Gotchas:**
- `nest build`/`npm run build` PASSA (exit 0) neste repo agora (deps realtime/ai presentes — a nota antiga de build quebrado está desatualizada). `make build` = `npm run build`. `timeout` não existe no macOS shell.
- Fixtures Telegram (`create-task.handler.spec`, `status.handler.spec`) JÁ eram vermelhas no baseline tsc por faltar `hasChildren`/`timeSpentIsRollup`; adicionar `activeWorkSession` (required via `!`) só soma à lista — NÃO é regressão nova (confirmar via `git stash`). Gate real = build (nest build exclui specs) + `tsc --noEmit | grep -v spec`.
- `src/mcp` baseline: 4 suites SEMPRE falham (update-timer.tool ×2, update-timer.integration TS2352, execute-task.integration TS, mcp-block-d fake-timer). `execute-task.integration` falha idêntico com/sem guard (compile error próprio).
- Front: repo é `Scrumbam-Frontend-V2` (NÃO o legado). Sem script `typecheck` — usar `npx tsc --noEmit`. `next build` roda eslint como gate (max-warnings 0). task-row-backend usa inline styles mas badge Tailwind convive ok. Hook eslint bloqueia import não usado JÁ no edit do import (adicionar uso na sequência).

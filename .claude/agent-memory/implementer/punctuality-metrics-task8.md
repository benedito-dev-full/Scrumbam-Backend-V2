---
name: punctuality-metrics-task8
description: Task 8 Pontualidade/margem-de-atraso — service SQL AVG por projeto + useMemo client-side; completedAt=dados.telemetry.doneAt (JSON, não coluna)
metadata:
  type: project
---

# Task 8 — Pontualidade / Margem de Atraso (Fases 1-3)

Feature híbrida: recorte "por projeto" = endpoint backend agregado; recorte
"por usuário logado" = useMemo client-side (padrão do KPI Ritmo). Fases 1-3
concluídas (Fase 4 visual `KpiPontualidade` = fora de escopo, aguarda CEO).

**Why:** CEO quer KPI de `dias = completedAt - dueDate` (positivo=atraso). Recorte
por projeto pode exceder o teto `@Max(100)` do ListTasksQueryDto → precisa AVG no
banco. Recorte por usuário reusa `tasks` já carregado.

**How to apply:** ao mexer nessa métrica, lembrar dos achados de armazenamento abaixo.

## Achado crítico de armazenamento (confirmado por leitura)

- **status** NÃO é coluna string: é `DTask.idStatus` (FK) → JOIN `DTabela` →
  `DTabela.idClasse`. Terminais: DONE=-444, VALIDATED=-449 (mesmas constantes de
  `PhaseMetricsService` / `STATUS_TO_TABELA_CLASSE`).
- **dueDate** É coluna tipada real (`DTask.dueDate` DateTime?).
- **completedAt** NÃO é coluna: é derivado de `dados.telemetry.doneAt` (JSON path),
  setado SÓ na transição para DONE (`tasks.service.ts` ~L1302). `buildResponse`
  mapeia `completedAt = telemetry?.doneAt ?? null` (~L2097). Task sem doneAt →
  excluída naturalmente pelo filtro `IS NOT NULL`.

## Backend (arquivos)

- `src/tasks/dto/punctuality-metrics-response.dto.ts` — `{ averageDelayDays: number|null, sampleSize, computedAt }`.
- `src/tasks/services/punctuality-metrics.service.ts` — `computeForProject(projectId)`
  (SQL raw `AVG(EXTRACT(EPOCH FROM ((dados->'telemetry'->>'doneAt')::timestamptz - dueDate))/86400)`);
  `computeForUser(assigneeId, scopeProjectIds?)` reservado (SEM rota).
  Guard anti-500: `AND (dados->'telemetry'->>'doneAt') ~ '^\d{4}-\d{2}-\d{2}'` antes do cast.
  Filtros compostos via `Prisma.sql`/`Prisma.join(fragments,' AND ',' AND ','')`.
- `src/tasks/tasks.controller.ts` — `GET /tasks/projects/:projectId/punctuality`
  declarada ANTES de `@Get(':id')`; tenant gate por `resolveScopedProjectIds` (404 anti-enum).
- `src/tasks/tasks.module.ts` — registrado em providers.
- `src/tasks/__tests__/punctuality-metrics.service.spec.ts` — 9 specs (null/0, sinal, negativo não-clampado, filtros na query). PASS.

## Route-order verificado SEM DB

DB não sobe neste ambiente (pg 5433 fechado). Colisão de rota validada com
`path-to-regexp` (v3.3.0 instalado, API `match`) simulando ordem de declaração:
`GET /tasks/projects/5/punctuality` → resolve p/ nova rota (projectId=5), NÃO p/
`findOne` (id="projects"). Motivo estrutural: `/tasks/:id` = 2 segmentos, nunca
casa URL de 4 segmentos. Declaração antes de findOne é defensiva.
**Padrão reutilizável:** quando não há DB, provar ordem de rota via path-to-regexp.

## Frontend

- `Scrumbam-Frontend-V2/src/app/(app)/assigned/page.tsx` — `useMemo`
  `pontualidadeMetrics` (`{ mediaDias: number|null, amostras }`) logo após
  `ritmoMetrics`. Reusa `DONE_STATUSES`, `parseCompletedAt` (já existentes).
  **DECLARADO MAS NÃO USADO** em nenhum JSX (Fase 4 = KpiPontualidade fora de escopo).
  tsc passa pois projeto não tem `noUnusedLocals`.

## Build/lint/test

- Backend: `npm run build` (nest build, exclui specs) PASS; eslint 0; jest 9/9 PASS.
  `tsc --noEmit` do backend mostra MUITOS erros PRÉ-EXISTENTES em specs não tocados
  (tenant-isolation, agents, telegram — mocks stale de TaskResponseDto sem
  hasChildren/timeSpentIsRollup). Meus arquivos: 0 erros. Não são regressão minha.
- Frontend: `npx tsc --noEmit` PASS (0 erros).

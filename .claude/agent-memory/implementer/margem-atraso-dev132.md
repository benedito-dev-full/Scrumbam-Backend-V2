---
name: margem-atraso-dev132
description: DEV-132 Margem de atraso — métrica irmã de Pontualidade (Task 8), agrega SÓ atraso estrito (diffDays > 0)
metadata:
  type: project
---

# Margem de Atraso (DEV-132) — irmã de Pontualidade (Task 8)

Estende a feature Pontualidade já existente (ver [[punctuality-metrics-task8]])
com uma métrica irmã: em vez de agregar TODAS as tasks concluídas com prazo
(atraso e adiantamento juntos, que se cancelam na média), agrega SÓ o
subconjunto que atrasou de fato.

**Why:** Pontualidade responde "no saldo geral, o projeto está adiantado ou
atrasado?". Margem de Atraso responde "quando atrasa, de quanto costuma ser
esse atraso?" — pergunta diferente, útil quando a média líquida esconde
atrasos grandes cancelados por adiantamentos.

**Regra de negócio fechada com o CEO:** só `diffDays > 0` entra (atraso
ESTRITO). `diffDays === 0` (entregue exatamente no prazo) é EXCLUÍDO — não
conta como "0 dias de atraso". `diffDays < 0` (adiantada) também excluída.
Mesmas exclusões-base de Pontualidade (sem `dueDate`, sem `doneAt`, fora de
status terminal DONE/VALIDATED).

## Backend

- `src/tasks/services/punctuality-metrics.service.ts` —
  `computeStrictDelayForProject(projectId)`: reaproveita o `aggregate()`
  privado já existente, adicionando 1 filtro extra ao array de fragmentos:
  `(doneAt - dueDate) > interval '0'` (atraso estrito, exclui `= 0` e `< 0`).
  ZERO duplicação de SQL — mesmo método `aggregate` que `computeForProject` usa.
- `src/tasks/tasks.controller.ts` — nova sub-rota
  `GET /tasks/projects/:projectId/delay-margin`, MESMO padrão exato da rota
  de pontualidade (`GET .../punctuality`): declarada antes de `@Get(':id')`,
  tenant gate via `resolveScopedProjectIds` (404 anti-enumeration idêntico).
  **Decisão de nomenclatura:** sub-rota nova (não query param `?strict=true`
  na rota existente) — mantém cada endpoint com 1 responsabilidade e path
  HTTP auto-descritivo; consistente com o padrão já estabelecido de uma
  sub-rota por métrica (`/metrics`, `/punctuality`).
- DTO reaproveitado 100% (`PunctualityMetricsResponseDto`) — mesmo shape
  `{ averageDelayDays, sampleSize, computedAt }`. Não criou DTO novo.
- `src/tasks/__tests__/punctuality-metrics.service.spec.ts` — 5 specs novos
  (describe `computeStrictDelayForProject`): filtro SQL de atraso estrito
  presente; filtro por `idProject`; média correta sobre subset atrasado;
  sem amostras → null/0; array vazio defensivo. 14/14 specs PASS (9 antigos +
  5 novos).

## Frontend

- `Scrumbam-Frontend-V2/src/app/(app)/assigned/page.tsx` — novo `useMemo`
  `margemAtrasoMetrics`, MESMO padrão de `pontualidadeMetrics` mas com
  `if (diffDays <= 0) continue;` logo após o parse (exclui `=0` e `<0`).
  `PanelEmAtraso` ganhou 3ª aba "Margem de atraso" (reusa `PanelTabButton`,
  ícone `AlertTriangle` + paleta `KPI.red` — sempre atraso, nunca adiantamento).
  `PontualidadeReadout` ganhou prop opcional `legendaOverride` (evita
  duplicar o componente) — aba nova passa
  `legendaOverride="de atraso médio, quando atrasa"` porque a legenda padrão
  "de atraso médio" ficaria ambígua nesse contexto (valor sempre positivo).

## Build/lint/test

- Backend: `npm run build` PASS; `npx eslint` nos 3 arquivos tocados = 0
  errors/warnings; jest 14/14 PASS.
- Frontend: `npx tsc --noEmit` PASS (0 erros).
- Nenhum Reviewer/Documenter chamado nesta rodada — cadência definida pelo
  CEO (fase a fase, gate final manual). Ver [[feedback-cadencia-documenter-no-final]].

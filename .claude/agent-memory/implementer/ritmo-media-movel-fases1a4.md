---
name: ritmo-media-movel-fases1a4
description: KPI "Ritmo" (assigned/page.tsx, Frontend-V2) refeito como média móvel de 28 dias fixos; TODAS as fases (1-5) do plano-ritmo-media-movel-task6 concluídas, incluindo redesenho do PanelRitmo em 4 barras semanais (aval CEO 2026-07-09).
metadata:
  type: project
---

Task 6 do plano `Scrumbam-Frontend-V2/workspace/plans/plan-ritmo-media-movel-task6.md`
(repositório Frontend-V2, não Backend-V2) — TODAS as fases (1-5, MUST HAVE +
SHOULD HAVE) implementadas em `src/app/(app)/assigned/page.tsx` +
`src/hooks/use-tasks.ts`.

**Fases 1-4 (rodada 1):**
- 3 helpers puros novos (`countBusinessDays`, `countBusinessDaysInMonth`,
  `last4WeeksRange`) logo após `parseCompletedAt`.
- Novo `useMemo` `ritmoMetrics` (janela FIXA de 28 dias corridos, independente
  do filtro Hoje/Semana/Mês da tela) retornando `{ mediaDiaria,
  doneUltimas4Semanas, diasUteisJanela, weekBuckets }` — `weekBuckets[0]` =
  semana mais recente.
- `KpiRitmo` reescrito: recebe `mediaDiaria` (não mais `total`), calcula fator
  de exibição internamente por `period` (Hoje=1, Semana=5, Mês=dias úteis
  reais via `countBusinessDaysInMonth`), `Math.round` só na exibição, tooltip
  com valor exato via `title`.
- **Mitigação de paginação (Ponto de Atenção A do plano) aplicada**: `limit`
  elevado de `100` para `250` em `useMyTasks`/`useTeamTasks`/`useUserTasks`
  (`src/hooks/use-tasks.ts`) — mitigação frontend-only preventiva, documentada
  em JSDoc acima de cada hook. Cursor pagination completa fica fora do escopo
  (WILL NOT HAVE).

**Fase 5 (rodada 2, aval CEO recebido 2026-07-09 — implementada EXATAMENTE
como proposto):**
- `PanelRitmo` reescrito: prop `series`+`period` trocada por
  `weekBuckets: number[]` (as 4 posições de `ritmoMetrics.weekBuckets`) +
  `loading`. `period` REMOVIDO da assinatura do componente (não só
  "desativado" — o plano permitia manter por conveniência, optei por remover
  já que não sobrava nenhum uso).
- 4 barras fixas (não mais série diária com `denseLabels`/`month` branch —
  todo esse ramo foi eliminado). Rótulos fixos via const top-level
  `WEEK_BUCKET_LABELS = ["Esta sem.", "-1 sem.", "-2 sem.", "-3 sem."]`
  (index-aligned com `weekBuckets`).
  index 0 (semana mais recente/atual) em cor cheia `KPI.violet.c`; demais em
  `rgba(139,123,247,0.32)` — mesmo padrão visual que já existia para "hoje".
  Empty state ("Sem conclusões nas últimas 4 semanas") quando soma das 4
  posições é 0.
- `PanelShell.meta` mudou de `"concluídas / dia"` para `"últimas 4 semanas"`.
- Chamada no JSX principal: `<PanelRitmo weekBuckets={ritmoMetrics.weekBuckets}
  loading={isLoading} />` (sem `period`).
- `periodMetrics.series` continua calculado dentro de `periodMetrics`
  (usado por "Concluídas"/pct/`emJogoNoPeriodo`) mas NENHUM componente lê
  mais o campo `.series` do objeto — código inofensivo, não removido por
  respeito à instrução do CEO de "não mexer em mais nada além do necessário".

**Por que:** duas rodadas — CEO pediu pausa antes da Fase 5 na rodada 1 para
aval visual explícito (regra `feedback-frontend-design-intocavel`); aprovou a
proposta tal como descrita na rodada 2, sem alterações.

Verificação (ambas as rodadas): `npx tsc --noEmit` (0 erros) + `npm run lint`
restrito aos 2 arquivos tocados (0 erros) + `npm run build` (passa, gera
`/assigned`). `npm run lint` full-repo = 18 problems (13 errors/5 warnings)
idêntico ao baseline pré-task (confirmado via `git stash` na rodada 1; mesma
contagem exata na rodada 2 sem novo stash, já que os 2 arquivos tocados
seguem 0-erro isoladamente).

**Task 6 completa** — todos os MUST HAVE + SHOULD HAVE do plano atendidos.
Não chamei Reviewer nem Documenter por instrução explícita do CEO (gate final
feito por ele na conversa principal).

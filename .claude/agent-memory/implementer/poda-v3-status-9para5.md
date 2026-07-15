---
name: poda-v3-status-9para5
description: "Poda dos status V3 de 9 para 5 (cross-repo back+front): fonte única task-status.const, causa raiz no enum do MCP, re-baseline do golden, split coluna-de-board vs pílula-de-grade."
metadata:
  type: project
---

# Poda V3 9 → 5 (2026-07-14, cross-repo)

MANTIDOS: INBOX, READY, EXECUTING, DONE, FAILED.
REMOVIDOS: VALIDATING (-448), VALIDATED (-449), CANCELLED (-446), DISCARDED (-447).

**Why:** os 4 removidos vieram de um PRD legado nunca implementado (ZERO produtores,
ZERO ADR). O dano NÃO era cosmético: **o MCP expunha os 9 no enum de `update_status`**,
e IAs (Nexus/Claude) escolhiam o que "soava certo", prendendo tasks HUMANAS em
VALIDATING — estado sem produtor nem consumidor. Apertar o enum do MCP/Capabilities
É a correção da causa raiz; podar só seed/métricas deixaria o bug vivo.

**How to apply:** ao mexer em status V3, importe SEMPRE de
`src/tasks/constants/task-status.const.ts` (V3_STATUS_CODES, TaskStatus,
STATUS_TO_TABELA_CLASSE, STATUS_V3_DEFAULTS, DONE_STATUS_IDS, REMOVED_V3_STATUS_CODES,
isV3StatusCode). Antes existiam ~8 cópias divergentes.

## Gotchas que custaram tempo

- **Divergência real corrigida de quebra:** VALIDATING/VALIDATED contavam como
  CONCLUÍDO em `delay-justifications/overdue.util.ts` e como PENDENTE em
  `tasks/services/phase-metrics.service.ts` — a MESMA task dava dois números.
  Hoje ambos convergem em DONE (-444). `DONE_STATUS_IDS` é o único lugar a mudar
  se um dia nascer outro estado terminal.
- **`STATUS_TO_TABELA_CLASSE` virou `Record<TaskStatus, bigint>`** → indexar com
  `string` quebra tsc (TS7053). Em `tasks.service.findMany` o filtro vem de query
  string: use `.filter(isV3StatusCode).map(...)`, não cast.
- **`npx tsc --noEmit` no backend tem ~40 erros de spec PRÉ-EXISTENTES** (arity de
  construtores, TaskResponseDto sem campos novos). O gate real é `npm run build`
  (nest build usa tsconfig.build.json, que exclui specs).
- **Golden MCP re-baselinado de propósito** (`mcp-wire.golden.spec.ts`):
  `FROZEN_TOOLS_LIST_HASH` mudou porque o enum encolheu em 4 tools. Count (26) e
  names hash INALTERADOS — é assim que se prova que só o enum mudou. O
  `tools-list.baseline.json` também é editado à mão.
- **`update-task.tool.ts` tem a string dos 9 status na `description`** (além do
  enum) — o `schema-consistency.spec` faz deep-equal classe↔JSON e pega isso.
- **Baseline de testes (backend):** 13 suites / 87 tests falhando ANTES da poda.
  Depois: 13 suites / 63 tests (−24 — meu rewrite de `validTransitions` consertou
  falhas pré-existentes do state machine). Sempre medir baseline com
  `git stash push -u` antes de julgar regressão.

## Frontend (`Scrumbam-Frontend-V2` — NÃO o legado)

- **CEO: FAILED é BADGE, não coluna do board.** Board = 4 colunas (Backlog / A fazer /
  Em progresso / Concluída); `intentionToColumn('FAILED')` cai em `backlog` de
  propósito. Isso remove a possibilidade de arrastar/escolher FAILED (só automação
  escreve) — que é a intenção.
- **Coluna-de-board ≠ pílula-de-grade.** Colapsar FAILED em "Backlog" na GRADE
  apagaria o sinal de falha (a célula mostra UMA pílula). Por isso criei
  `intentionToPill` / `STATUS_PILL_OPTIONS` (4 colunas + `falhou` vermelha) para a
  grade, mantendo `intentionToColumn` só para o board.
- **Morreu a trava "VALIDATED = estado final"** (`V3_TERMINAL_VALIDATED`,
  `statusLocked`, prop `statusV3` de `FieldCell`): nenhum status é terminal agora —
  DONE pode voltar a EXECUTING (reabertura).
- Baseline eslint do front: 13 errors + 5 warnings PRÉ-EXISTENTES (files que não
  toquei) — `--max-warnings 0` sempre falha; medir por arquivo tocado.

## Migração de dados (NÃO rodada — é do CEO)

`prisma/scripts/count-v3-removed-statuses.sql` (read-only) e
`prisma/scripts/migrate-v3-statuses-9to5.sql`. **DUAS fontes de verdade** precisam
migrar juntas: `DTask.idStatus` (→ DTabela do MESMO projeto) e `dados.v3.state`.
Estado anterior preservado em `dados.v3.migratedFrom`. CANCELLED/DISCARDED ficaram
COMENTADOS aguardando decisão (mandá-los para DONE INFLA métricas de entrega).

Ver [[mcp_key_empty_identity_workaround]] — a contagem em produção foi feita via
curl no MCP com a chave do dir `rizar` (a deste dir é identidade vazia).

---
name: templates-feature-hardening-m1m2m3
description: Rodada de hardening Templates (M1 analytics blindagem, M2 folders write-guard, M3 const única TEMPLATE_CLASSES) — ADR-V2-061
metadata:
  type: project
---

# Templates feature — hardening M1/M2/M3 (ADR-V2-061, 2026-06-03)

Fecha 3 achados do Reviewer pós Sub-fase 5. Escopo cirúrgico.

**Why:** templates -401/-402 vazavam para a visão de "trabalho" do analytics
(capacity-forecast) e podiam ser movidos para pasta; `TEMPLATE_CLASSES` estava
triplicado (drift risk).

**How to apply:** ao tocar visões de DProject "como trabalho", sempre
`idClasse: { notIn: TEMPLATE_CLASSES }` importado da fonte única.

## M3 — Fonte única `TEMPLATE_CLASSES`
- Novo arquivo FOLHA `src/projects/constants/template-classes.const.ts` — só
  `bigint` literais, ZERO import de service (evita ciclo). Exporta
  `ID_CLASSE_TEMPLATE_LIST(-401)`, `ID_CLASSE_TEMPLATE_SPACE(-402)`, `TEMPLATE_CLASSES`.
- Importado em 4 arquivos (removendo defs locais duplicadas): `projects.service`
  (reaponta `TEMPLATE_CLASS_REMAP`/`isTemplateClasseFilter`/2 `notIn` — comportamento
  IDÊNTICO, mesmos valores), `search.service`, `folders.service`, `analytics.service`.
- `TEMPLATE_CLASSES` é `bigint[]` (NÃO readonly) → Prisma `notIn` aceita sem cast.

## M1 — Blindar analytics capacity-forecast
- `analytics.service.ts` ~l.141 `dProject.findMany` (ÚNICA listagem de DProject
  "como trabalho" no service) ganhou `idClasse: { notIn: TEMPLATE_CLASSES }`.
- GOTCHA TESTE: havia 1 teste PRÉ-EXISTENTE que assertava o `where` EXATO
  (`{idEstab,excluido}`) — meu `notIn` o quebrou (1 fail). Atualizei a asserção
  p/ incluir `idClasse:{notIn:[-401n,-402n]}` + adicionei teste M1 dedicado
  (mock retorna só projeto real, assert `callArg.where.idClasse`). Analytics 9→11 passed.

## M2 — Guarda write-path em folders
- Método real é `folders.service.moveProject` (mandato chamou "assignToFolder";
  é o que cria o DVincula -183 PROJECT_LINK). NÃO existe `assignToFolder`.
- Reaproveitei o `findFirst` de existência já presente (~l.435) só adicionando
  `idClasse: true` ao `select` (sem N+1 novo). Guard `if (TEMPLATE_CLASSES.includes(project.idClasse))
  throw new BadRequestException('Templates não podem ser movidos para pastas')`
  ANTES do tenant-check e da transação. `BadRequestException` precisou ser
  adicionado ao import de `@nestjs/common`.
- `DProject.idClasse` é `BigInt` non-null no schema → `includes(project.idClasse)` typa OK.

## Baseline de testes (antes → depois)
- `projects.service.spec`: 8 failed / 73 passed (IDÊNTICO; os 8 são
  findMany/cursor/teamId/privado pré-existentes — commit 7c23cd4, `doneStatusChaves`).
- `analytics`: 9 passed +1 fail (meu) → 11 passed (assert corrigida + teste M1 novo).
- `folders.service.spec`: 24 failed → **25 passed**. ERA DI quebrado
  (`Nest can't resolve ProjectRefService at index [2]` — spec nunca atualizada
  pós ADR-V2-058). Adicionei provider mock `ProjectRefService` (`ensureEntidadeRefById`,
  `resolveEntidadeRef`, `refsToProjectIds`, `resolveEntidadeRefs` — passthrough E==P)
  → destravou 21 testes pré-existentes + meu M2. Improvement, não regressão.
- `folders.integration.spec`: 6 failed → 6 failed (IDÊNTICO; MESMO DI quebrado,
  fora do escopo cirúrgico — NÃO toquei).
- `search`: 15 passed (intacto).

## GOTCHA stash de baseline com Sub-fase 5 NÃO commitada
- Last commit = 4f160c8 (Sub-fase 4b). Sub-fase 5 está UNCOMMITTED no working
  tree (`projects.service.ts`, `analytics`, `search`, dtos, controller, specs).
- `git stash push -- <meus 4 services>` reverte ALÉM das minhas edições (volta
  pré-Sub-fase 5) → `projects.service.spec` nem compila (`categoria` não existe
  em `FindManyProjectsOptions`). NÃO confie em stash p/ baseline aqui; rode o
  estado ATUAL e compare contadores com os documentados (8 fails projects, etc.).

## Gates finais
- tsc: 0 non-spec, 25 total (baseline só *.spec). `make build` (nest build +
  copy:dvfs-assets) EXIT 0. eslint: 5 production files + folders spec = 0
  problemas. analytics spec tem 7 `any` warnings PRÉ-EXISTENTES (mock decls
  l.12-18, em HEAD, não toquei) — o hook PostToolUse roda `--max-warnings 0`
  e os sinaliza, mas não são meus.
- N+1 zero: M1 = where extra; M2 = reaproveita findFirst.

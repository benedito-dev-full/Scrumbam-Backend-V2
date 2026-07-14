---
name: templates-feature-subfase1-seed
description: Sub-fase 1 da feature Templates — 2 DClasses (-401/-402) no seed; gotcha do contador stale e da contagem real via seed-runner
metadata:
  type: project
---

# Feature Templates — Sub-fase 1 (SEED only) — ADR-V2-061 (proposto), 2026-06-03

Adicionadas 2 DClasses em `prisma/seeds/classes.seed.ts`, seção "DProject — hierarquia Space/Folder/List", logo após `esp(-352,'LIST',...)`:
`esp(-401,'TEMPLATE_LIST',...,-37)` e `esp(-402,'TEMPLATE_SPACE',...,-37)`. Helper `esp` SEM 5º arg (folhas, igual -350/-351/-352). Range -401..-419 livre por ADR-V2-060 (SPRINT removido). Zero `src/`.

**Why:** Template = DProject marcado por idClasse dedicado (não flag). cloneTree (sub-fase futura) remapeia -401→-352 / -402→-350 ao materializar via `POST /projects/:id/from-template`. Plano: `workspace/plans/plan-templates-feature.md`.

**How to apply (futuras sub-fases):** motor cloneTree/copyTasks, rota from-template, catálogo `GET /projects?idClasse=-401&categoria=X` e DTO `CreateFromTemplateDto` são sub-fases 2+. NÃO tocados nesta rodada.

## GOTCHA — contadores do cabeçalho estavam STALE (drift de 1)
Os comentários do cabeçalho diziam "108 especificas / 153 total", mas a contagem REAL do array (via `npm run seed:classes:dry` → "45 fixas + N especificas") era 107/152 na baseline. Sempre confirmar a contagem real com `git stash` + dry-run ANTES de assumir o número do comentário. Atualizei para o runtime real: 109 especificas / 154 total (107+2). Item 4 do breakdown DProject foi 3→5; bloco "Soma" `1 + 3` → `1 + 5`. Frente B Nexus IA (GEMINI_API_KEY/AI_CHAT_MESSAGE) já estava contabilizada nos itens 6/8 — a linha antiga "+2 = 107" era a fonte da confusão; removida e substituída por nota.

## Validação (gates)
- `npm run seed:classes:dry` → valida `validateHierarchy` em time de import (ciclo, idPai inexistente, sequestro -47/-49/-50/-45/-40, dup, positiva) + imprime contagem. -37 ENTIDADES existe.
- `npm run build:seeds` (tsc `tsconfig.seeds.json`) = gate de build do seed (NÃO `nest build`, que falha por gemini dep no dev). PASS.
- `npx jest prisma/seeds/__tests__/validate-hierarchy.spec.ts` (12 testes) — testa validador puro, NÃO o array do seed; não precisou ajuste. `src/classes/classes.service.spec.ts` usa mocks próprios; idem.
- Nenhum spec/snapshot asserta contagem/chaves do array `classesEspecificas`.

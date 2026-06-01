---
name: bug-reorder-colunas-tres-camadas
description: "Bug 'coluna reordenada volta a posicao original' apareceu 3x na mesma feature; causa-raiz sempre = re-sort por order ANTIGO ou forcar ordem fixa. Checklist de onde olhar."
metadata:
  node_type: memory
  type: project
  originSessionId: 7518dae0-2c40-47b7-b88a-b5fb3e903512
---

Na feature Colunas Customizaveis (aba Blocos / Abordagem B = fixas materializadas em tableFields), o bug "arrasto a coluna, solto, e ela volta pra posicao original" reapareceu TRES vezes, sempre pela MESMA classe de causa: alguma funcao re-ordena por `column.order` ANTIGO (ou forca uma ordem fixa) DEPOIS que o reorder ja foi aplicado, desfazendo-o.

As 3 ocorrencias (todas corrigidas):
1. **Frontend, fim de `applyReorderColumns`** (schema-ops.ts): `normalizeSchema` final re-sortava por order antigo. Fix commit `1bb8459` (removeu normalizeSchema do fim).
2. **Frontend, inicio de `applyReorderColumns`** (schema-ops.ts): `const schema = toSchema(tableFields)` no comeco — `toSchema`->`normalizeSchema` re-sortava por order antigo ANTES de aplicar a nova ordem. Fix: trocar por `tableFields ?? {version:1,columns:[]}` (commit `37d592d` wip; limpeza do residuo prototipo em `c4cb57d`).
3. **Backend, `mergeBuiltinColumns`** (src/tasks/table-fields/builtin-columns.ts): merge-on-read FORCAVA as 6 builtin sempre ao inicio na ordem do BUILTIN_COLUMNS_TEMPLATE, descartando a `order` gravada. Fix commit `f9b431d`: preserva `order` das builtin ja armazenadas; injeta ausentes ao FINAL; ordena conjunto inteiro por order e renumera contiguo.

**Why:** com a fonte unica (Abordagem B), a ORDEM e dado (campo `order` no tableFields), nao codigo. Qualquer ponto que re-derive ordem por regra fixa (template, normalize por order stale) quebra o reorder. O reorder do front grava `order` por POSICAO; o backend (GET via buildResponse e PATCH via update — AMBOS chamam mergeBuiltinColumns) e o front (schema-ops) tem que RESPEITAR esse `order`, nunca recalcular por outra regra.

**How to apply:** se o usuario reportar de novo "coluna volta a posicao original", checar NESTA ordem: (1) schema-ops.ts applyReorderColumns nao chama toSchema/normalizeSchema; (2) backend mergeBuiltinColumns preserva order armazenada (nao forca template); (3) groups-view.tsx handleReorderColumn manda orderedKeys do conjunto INTEIRO. Testes-guarda existem: builtin-columns.spec "PRESERVA a ordem reordenada das builtin". Relacionado: [[decisao-colunas-fonte-unica-abordagem-b]], [[frontend-colunas-custom-fases3a5-codex]], [[feedback-frontend-design-intocavel]]. NOTA: projects.service.spec tem 2 testes de paginacao por cursor (idLocEscritu/lt) FALHANDO de forma pre-existente — nao tem relacao com tableFields.

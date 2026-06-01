---
name: tablefields-frontend-fase2-edit
description: Fase2 frontend — tornar valores de colunas custom EDITAVEIS na aba Blocos (PUT /tasks/:id { dados.fields }); 3 edits em groups-view.tsx
metadata:
  type: project
---

tableFields FRONTEND Fase2 (edicao de valores de celulas custom — repo `Scrumbam-Frontend-V2` — 2026-05-31). Fase1 (read-only) ja mergeada commit `af1c1ce`. Task puramente "encanamento": ligar a celula editavel ja existente ao backend. Ver [[tablefields-coluna-dproject-fase1]] (backend) e [[tablefields-fase6-spec-coverage]].

**Why:** valores de celulas custom precisavam persistir via `PUT /tasks/:id { dados: { fields: { [key]: value } } }`. Backend (Fase4 backend) valida por tipo + MERGE por chave (`null` limpa, valor invalido → 400).

**How to apply (3 edits, arquivo unico `src/components/lists/groups-view.tsx`):**
1. Import `import { toast } from "sonner";` (l.65, depois de useQueryClient). sonner ja e dep do projeto.
2. `handleEditField` (dentro de `BackendGroupsView`, ~l.753): o `else { return; }` final que DESCARTAVA colunas custom virou ramo que dispara `updateTask.mutate({ id, projectId, dto: { dados: { fields: { [columnKey]: value } } } }, { onError: () => toast.error(...), onSettled: () => setSavingTaskId(null) })` com `setSavingTaskId(taskId)` antes. Rollback do valor invalido (400) e automatico: onSettled invalida queries → refetch restaura valor anterior (feedback conservador, NAO ha optimistic update no BackendGroupsView). `value` passado como veio (`FieldValue = string|number|boolean|null`).
3. `backendEditable` (em `TaskRow`, ~l.1914): era `!!onEditField && BACKEND_EDITABLE_KEYS.has(c.key)`; virou `!!onEditField && (BACKEND_EDITABLE_KEYS.has(c.key) || c.builtin === false)`. CRITICO usar `c.builtin === false` (NAO `!c.builtin`): `identifier` builtin tem `builtin` INDEFINIDO (so `__nome` tem `builtin:true` em BACKEND_COLUMNS) — `!c.builtin` o tornaria editavel erroneamente; `=== false` so pega colunas custom que o mapper marca explicitamente `builtin:false` via `tableColumnToColumnDef`.

**Contratos relevantes:** `useUpdateTask()` (src/hooks/use-tasks.ts) ja aceita `dto.dados?: Record<string, unknown>` (merge superficial); o mutationFn faz PUT /tasks/:id. `ColumnDef.builtin?: boolean` (groups-store.ts). BACKEND_COLUMNS (groups-from-tasks.ts l.110): so `__nome` tem builtin:true; `status/responsavel/prioridade/dueDate` estao em `BACKEND_EDITABLE_KEYS` (set, groups-view.tsx l.861) e NAO tem builtin flag; `identifier` nao esta em nenhum dos dois (fica read-only correto). Colunas custom rotuladas builtin:false pelo mapper.

**ZERO design alterado:** nenhuma linha de style/className/JSX visual tocada. So logica em handleEditField + flag backendEditable. A celula/editores por tipo (FieldCell) intactos — so a flag cellReadOnly e o destino do cellOnChange (que ja roteava p/ onEditField quando backendEditable) mudaram de comportamento sem mudar codigo (cellOnChange ja era `onEditField` quando backendEditable=true).

**Validacao:** `npm run build` (next build + Turbopack) EXITCODE=0, roda TypeScript inline (Finished TypeScript, 0 erros) — diferente do baseline da Fase1 onde `next build` NAO rodava eslint; aqui o TS gate passou limpo. `npx tsc --noEmit` 0 erros. NAO commitado (CEO revisa visual em prod antes).

**GOTCHA harness (de novo nesta sessao):** Edit/Read/Bash retornaram outputs SPURIOS/agregados e algumas calls paralelas foram canceladas em cascata. Confirmei CADA edit com `git diff` real apos cada Edit — os 3 edits persistiram corretos. Tambem: arquivo temp `build-out.txt` escrito por engano com encoding UTF-16 (PowerShell `*>`), removido; `prototipo-inicio.html` untracked e PRE-EXISTENTE (nao criei). Lê build com `Read` da UTF-16 ilegivel — usar a saida direta do PowerShell `npm run build` (sem redirect a arquivo).

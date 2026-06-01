---
name: tablefields-timespent-fase3
description: Fase 3 do timer — 7ª coluna builtin read-only "Tempo gasto" (timeSpent) na grade Blocos, backend + frontend
metadata:
  type: project
---

# Timer Fase 3 — coluna builtin read-only "Tempo gasto" (timeSpent)

**Fato:** ADR-V2-057, plan `plan-tasks-timer-tempo-por-tarefa-task57.md`. Adicionada 7ª coluna builtin `timeSpent` (label "Tempo gasto"), read-only, exibindo total de tempo manual agregado server-side. NÃO criou 9º ColumnType — usou `type:'text'` + `builtin:true` + flag novo `readOnly?:boolean`.

**Why:** CEO quis o total visível também na grade (não só no sidebar Fase 2). Camada DADO continua em `dados.telemetry.manualTimers[]` (ZERO tabela nova). Camada VISUAL via tableFields builtin.

**How to apply (BACKEND — repo Scrumbam-Backend-V2):**
- `builtin-columns.ts`: `'timeSpent'` adicionado a `BUILTIN_COLUMN_ORDER` (7º) + template `{ key:'timeSpent', type:'text', label:'Tempo gasto', order:6, builtin:true, readOnly:true }`. `BUILTIN_COLUMN_KEYS` deriva do ORDER → o validator (`table-fields.validator.ts`) reconhece a key automaticamente, SEM mudança.
- **Reorder/merge NÃO mudou de algoritmo** (regra de ouro — bug apareceu 3x). Só os DADOS (template). `mergeBuiltinColumns`/`projects.service.ts` são genéricos sobre o template. ÚNICA mudança de lógica em `mergeBuiltinColumn`: forço `readOnly` do TEMPLATE no merge (`...(template.readOnly !== undefined ? { readOnly: template.readOnly } : {})`) para que um legado que persistiu timeSpent sem o flag não vire editável.
- `column-def.dto.ts`: campo `readOnly?: boolean` (`@IsOptional() @IsBoolean()`).
- `tasks.service.ts buildResponse`: novo campo `timeSpentLabel: string` via `taskTimerService.formatTotalLabel(taskTimerService.totalMs(manualTimers))`. Reaproveita os manualTimers já extraídos para o `timer` field (ZERO query extra, ZERO N+1).
- `task-timer.service.ts`: novo método `formatTotalLabel(ms)` — "Xh Ymin" / "Ymin" / "Xh" / "<1min" / "—" (zero). Fonte ÚNICA de formatação.
- `task-response.dto.ts`: `timeSpentLabel!: string` (obrigatório → quebra mocks Telegram).

**How to apply (FRONTEND — repo Scrumbam-Frontend-V2):**
- Mapper é `src/lib/mappers/groups-from-tasks.ts` (NÃO `src/lib/prototype/...` como diz o plano).
- `taskToRow`: `fields.timeSpent = task.timeSpentLabel ?? "—"` no BLOCO BUILTIN explícito (prevalece sobre `...customFields`). Front NUNCA soma — só exibe.
- `tableColumnToColumnDef`: propaga `...(col.readOnly === true ? { readOnly: true } : {})`.
- `api.ts`: `readOnly?` em `TableColumnDto`, `timeSpentLabel?: string` em `TaskResponseDto`. `table-fields.ts`: `readOnly?` em `ColumnDef`.
- `groups-view.tsx`: a coluna timeSpent já caía no caminho read-only correto (igual `identifier`): não é `__nome` (não vira branch de título), não está em `BACKEND_EDITABLE_KEYS`, e `builtin` fica undefined (o mapper só seta builtin:true para `__nome`). Mesmo assim ADICIONEI defense-in-depth: `backendEditable` agora exige `c.readOnly !== true`. FieldCell text + readOnly=true renderiza `<span>` estático (sem editor, sem onClick) → clicar não faz nada.
- DESIGN INTOCÁVEL respeitado: ZERO mudança de CSS/layout. Coluna entra pelo mesmo pipeline das builtin via tableFields.

**GOTCHA — testes que QUEBRAM com 7ª builtin (fixtures, não regressão real):**
- `projects.service.spec.ts`: teste "deve devolver builtin mais custom..." asserta `toHaveLength(7)` → vira 8. ARMADILHA: o total agregado tasks+projects era 24/77 com E sem minha mudança, mascarando que ESTE teste flipou (outro flipou ao contrário). Verifiquei isoladamente com `git stash`: baseline PASSAVA, com mudança FALHAVA → era regressão de fixture legítima. SEMPRE valide o teste específico via `npx jest <spec> -t "<nome>"` + `git stash`, não confie no total agregado. Atualizei para `toHaveLength(8)` e título "as 7 builtin".
- `table-fields.validator.spec.ts`: teste "nao lanca para schema misturando builtin e custom" espalha `BUILTIN_COLUMNS_TEMPLATE` (agora com timeSpent order 6) + custom em order 6 → colisão. Movi custom para order 7.
- `builtin-columns.spec.ts`: atualizei TODAS as contagens (6→7, 8→9) e orders; adicionei 2 testes novos (timeSpent materializa read-only; força readOnly:true em legado sem flag). `it.each(BUILTIN_COLUMN_ORDER)` no validator spec cobre timeSpent automaticamente.
- Mocks Telegram (`tasks.handler.spec`, `status.handler.spec`, `create-task.handler.spec`): novo `timeSpentLabel!: string` obrigatório no DTO quebra os 3 makeTask inline → adicionei `timeSpentLabel: '—'`. O `create-task-from-text.intent.spec` usa `as jest.Mock` (apaga tipo) → não precisou tocar.

**Baseline (gates):**
- Backend: tsc 7 erros pré-existentes (agents/tenant-isolation arity, ttl-cache spec, execution-run.processor spec) — ZERO nos meus arquivos. `npx jest src/tasks/table-fields task-timer` = 77 passed. tasks.service.spec mantém 24 failed pré-existentes; projects.service.spec 2 failed pré-existentes (cursor pagination, confirmados via stash — NADA a ver com tableFields). `nest build` falha por gemini dep ausente no dev Win → tsc é o gate.
- Frontend: `npx tsc --noEmit` EXIT=0; `npx eslint <4 arquivos>` EXIT=0; `npm run build` (next) EXIT=0.

**Como o CEO testa:** abrir uma Lista → aba Blocos → coluna "Tempo gasto" aparece read-only (texto tipo "2h 45min" ou "—"); clicar na célula NÃO abre editor; nada grava em dados.fields; valor bate com o painel do sidebar (mesma fonte server-side). NÃO comitei (CEO controla commits).

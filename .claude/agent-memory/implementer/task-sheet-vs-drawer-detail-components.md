---
name: task-sheet-vs-drawer-detail-components
description: Frontend V2 tem DOIS componentes de detalhe de task divergentes; o usado em /lists/[id] é o TaskSheet (salvamento por campo via updateTask.mutate no onBlur/onChange), NÃO o EditableTextarea do drawer.
metadata:
  type: project
---

Repo `Scrumbam-Frontend-V2` tem DOIS componentes de detalhe de task, com mecânicas de salvamento DIFERENTES — cuidado ao corrigir bugs de persistência de campo:

- `src/components/tasks/task-sheet.tsx` (**o usado na rota `/lists/[id]`** via `page.tsx` → `<TaskSheet>`; também Lista/Quadro/Calendário/Gantt). Cada campo tem estado local (`useState`) + um handler que chama `updateTask.mutate({ id, projectId, dto: {...} })` (hook `useUpdateTask`, PATCH /tasks/:id). Título salva no `confirmarNome` (onBlur do input), prioridade/dueDate/assignee salvam no onChange do seu control. Placeholder da descrição: "Adicione uma descrição...".
- `src/components/tasks/task-detail-drawer.tsx` (usa `EditableTextarea`/`EditableText` de `task-detail-drawer-fields.tsx`; salva no onBlur `if (draft !== value) onSave(draft)`). Placeholder: "Adicionar descrição...".

**Why:** Task #793/DEV-122 — descrição não persistia na tela de detalhe. Causa: no `task-sheet.tsx` o `<textarea>` de descrição só tinha `onChange={setDescricao}` e um `onBlur` que apenas resetava a cor da borda — NUNCA chamava `updateTask.mutate`. Era o único campo do sheet sem persistência (título/status/prioridade/dueDate/assignee já salvavam). O drawer já estava correto (EditableTextarea salva no blur).

**How to apply:** Ao corrigir persistência de campo na tela de detalhe, confirme PRIMEIRO qual componente a rota usa (a repro do usuário pode ser do sheet, não do drawer — o placeholder distingue: "Adicione" = sheet, "Adicionar" = drawer). No sheet, siga o padrão dos demais campos: `updateTask.mutate({ id: task.id, projectId: task.projectId, dto: { campo } })`, salvando no onBlur e só se `valor !== (task.campo ?? "")`. `useUpdateTask` aceita `descricao?: string` no dto (`descricao !== undefined ? { descricao }`), então "" limpa a descrição.

GOTCHA hook: PostToolUse eslint (`--max-warnings 0`) roda por Edit. Se você declara o callback num Edit e o usa em outro Edit, o 1º dispara `no-unused-vars` (bloqueante). Ordene os edits ou aceite que o gate final (`npx eslint <arquivo>`) confirma limpo. `npm run build` (next build) NÃO gateia eslint; validar com tsc+eslint separados.

---
name: cascade-delete-orfas-task1
description: Cascade soft-delete de TASKs normais (DTask -154) + audit task.deleted + script saneamento órfãs (ADR-V2-047 Q6)
metadata:
  type: project
---

Task 1 cascade-delete-órfãs (2026-05-30) — `TasksService.delete()` em `src/tasks/tasks.service.ts`.

**Mudança central:** default de cascade passou de `isPhase` para `true` (linha ~1308: `options?.cascade !== undefined ? options.cascade : true`). Agora TASK normal (-154) e PHASE (-200) cascateiam por padrão; `?cascade=false` é o escape (desvincular). `isPhase` permanece só para decidir QUAL evento de audit emitir.

**Audit `task.deleted`:** já totalmente cabeado no projeto — `EVENT_TYPES.TASK_DELETED='task.deleted'` (event-types.ts:22), `SUPPORTED_EVENTS` (supported-events.ts:5), `TYPE_TO_CLASSE['task.deleted']=BigInt(-498)` (audit-log.consumer.ts:30). NÃO criar entrada nova em nenhum desses 3. Emitir nos DOIS ramos do delete quando `!isPhase`, simétrico ao `phase.deleted` que já existia: payload `{ taskId, projectId, cascade, affected }` (affected=result.affected no cascade, 1 no desvincular), via `eventProducer.addInternalEvent(..., correlationIdService.getOrGenerate(), { source: TasksService.name })`, APÓS persistência.

**Controller** `tasks.controller.ts` delete: `@Query('cascade') cascade: string | undefined` → `const cascadeBool = cascade === undefined ? undefined : cascade === 'true';` → `delete(id, allowed, { cascade: cascadeBool })`. `@ApiQuery` boolean. `Query` e `ApiQuery` já importados no arquivo.

**Script saneamento** `scripts/fix-orphan-tasks.sql` (NÃO prisma/migrations/) — CTE recursiva idempotente BEGIN/COMMIT. Colunas DTask conferidas: `"DTask"`, `chave`, `"idPai"`, `excluido`, `"atualizadoEm"` (PascalCase quoted; chave/excluido lowercase). EXECUÇÃO é ação manual exclusiva do CEO — fluxo só entrega + valida sintaxe. `psql` NÃO disponível no Win dev (validação foi estrutural).

**Spec gotcha:** `phaseHierarchyMock` no `tasks.service.spec.ts` é local ao beforeEach; para asserir `softDeleteCascade` chamado, extrair `phaseHierarchy = module.get(PhaseHierarchyService)` numa let no topo (adicionei `let phaseHierarchy`). `softDeleteCascade` default mock retorna `{affected:1}`; sobrescrever por teste com `.mockResolvedValue({affected:N})`. No ramo cascade, `prisma.dTask.update` NÃO é chamado (asserir `.not.toHaveBeenCalled()`).

**Baseline pré-existente (confirmado via git stash):** `nest build` JÁ FALHA por `src/ai/providers/gemini.provider.ts:17` (módulo `@google/generative-ai` ausente) — NÃO relacionado a tasks. `npx tsc --noEmit` = 14 erros totais na baseline (memória antiga dizia 13; agora 14). `tasks.service.spec.ts` = 24 failed pré-existentes (State Machine V3 — 50 cenários: validateTransition/validTransitions divergem do código atual), 65 passed na baseline. Meus 6 casos novos de delete passam → 76 passed.

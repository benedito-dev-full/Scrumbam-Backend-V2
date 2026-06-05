---
name: realtime-websocket-fase2
description: Task6 Fase2 — RealtimeConsumer + wiring no EventRouter + import em app.module (tempo real ponta-a-ponta no backend)
metadata:
  type: project
---

# Realtime WebSocket Task6 Fase2 (2026-06-04)

Consumer + Module wiring + app.module. Completa o tempo real ponta-a-ponta no backend (Fases 0 e 1 já aprovadas).

**Arquivos:**
- CRIADO `src/realtime/realtime.consumer.ts` — `RealtimeConsumer implements IEventConsumer, OnModuleInit`. `name='realtime'`. Construtor injeta `RealtimeGateway` + `EventRouterService`.
- ALTERADO `src/realtime/realtime.module.ts` — `RealtimeConsumer` em providers; doc atualizada (wiring deixou de ser "Fase 2 pendente").
- ALTERADO `src/app.module.ts` — import + `RealtimeModule` no fim do array imports (após AiModule).
- CRIADO `src/realtime/__tests__/realtime.consumer.spec.ts` — 17 specs.

**Registro no EventRouter (precedente espelhado):** EXATAMENTE o padrão `TelegramNotificationConsumer` (ADR-V2-049) — o PRÓPRIO consumer implementa `OnModuleInit` e se auto-registra via `this.eventRouter.registerConsumer(match, this)`. NÃO coloquei o `OnModuleInit` no módulo (o brief permitia módulo OU provider; o precedente Telegram usa o provider, então segui ele — mantém o módulo "burro"). Match: `(type) => type.startsWith('task.') || type.startsWith('phase.')`.

**Anti-circular:** EventosModule é `@Global` e NÃO importa RealtimeModule. RealtimeConsumer injeta EventRouterService sem import explícito (vem do @Global). Consumer NÃO entra no construtor do EventRouterService (registro dinâmico). `nest build` compila limpo → sem ciclo estático; 27/27 specs realtime verdes (gateway/guard Fase1 + consumer Fase2) → DI resolve.

**Mapa trigger→wsEvent (const `TYPE_TO_WS_EVENT`, Object.freeze, estilo TYPE_TO_CLASSE do audit-log):** phase.created→block.created, phase.updated→block.updated, phase.deleted→block.deleted, task.created→task.created, task.updated→task.updated, task.status.changed→task.status.changed, task.deleted→task.deleted. Qualquer outro (task.assigned, phase.completed, task.comment.created) → return (skip, log debug). Derivação por TYPE, NÃO por idClasse (fases já emitem phase.* próprios).

**handle():** wsEvent=map[type] (skip se não mapeado) → listId=asString(payload.projectId) (skip se '') → entityId=asString(payload.taskId ?? payload.phaseId) (skip se '') → actorId=asString(payload.actorId ?? payload.userId ?? payload.movedBy) (pode ser '') → `gateway.broadcast('list:'+listId, wsEvent, { listId, entityId, actorId })`. Helper `asString(unknown)` cobre string/number/bigint→string, resto→''. ZERO query, ZERO throw por dado faltando (skip silencioso log debug).

**Export de teste:** `__REALTIME_TYPE_TO_WS_EVENT` (paridade com `__AUDIT_TYPE_TO_CLASSE`).

**Gateway.broadcast (Fase1, NÃO toquei):** `this.server.to(room).emit('list:event', { event, ...payload })` — canal único `list:event` com envelope no corpo.

**Gates:** `npm run build` (nest build) PASS — o erro histórico de `@google/generative-ai` ausente NÃO ocorre mais nesta máquina (build limpo). eslint dos 4 arquivos = 0. `npx tsc --noEmit | grep realtime` = 0 erros nos arquivos novos. 17/17 consumer specs + 27/27 suite realtime.

**Desvios vs brief:** nenhum material. O brief deu opção "OnModuleInit no módulo OU num provider dedicado" — escolhi o provider (consumer self-register), espelhando 1:1 o precedente Telegram. NÃO mexi em Fase 0/1, NÃO escrevi ADR/README (Fase 3). NÃO commitei.

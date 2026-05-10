# `src/eventos/` - Eventos Canonicos V2

**Fase:** F7 - Producer + Router + Audit + Notification/Webhook consumers.
**Decisao:** ADR-V2-008 (DEvento substitui DNotification/DWebhook), ADR-V2-019
(sync-mode MVP), ADR-V2-026/027 (audit generic e lifecycle).

## TL;DR

- Unico ponto de emissao: `EventProducerService.addInternalEvent(type, payload, correlationId)`.
- `EventRouterService` decide consumers; services nao decidem fila/consumer.
- `AuditLogConsumer` e catch-all e persiste audit trail em `DEvento`.
- `NotificationConsumer` cria notificacoes in-app como `DEvento -490`.
- Endpoints de leitura/mutacao de notificacoes vivem em `src/notifications`
  e operam exclusivamente sobre `DEvento -490`.
- `WebhookConsumer` le configs `DTabela -470` e chama `WebhookDispatcherStub`.
- Consumers sao destinos finais do pipeline: nao chamam `EventProducerService`.
- Zero Engine em `src/eventos`; `DEvento` e `DTabela` sao estruturais.

## Fluxo

```text
Service caller (apos persistencia)
  -> EventProducerService
  -> EventRouterService
       - audit-log sempre
       - notification por trigger
       - webhook por trigger permitido
  -> CircuitBreakerService
  -> consumer.handle()
       - sucesso: telemetry + CB success
       - falha: telemetry + CB failure + IntelligentRetryService
```

## Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `eventos.module.ts` | Modulo global; registra producer, router, consumers, resiliencia e health. |
| `interfaces/event.interface.ts` | Contrato `IEvent<TPayload>`. |
| `interfaces/event-producer.interface.ts` | Contrato `IEventProducer`. |
| `interfaces/consumer.interface.ts` | Contrato `IEventConsumer`. |
| `interfaces/webhook-dispatcher.interface.ts` | Token e contrato do dispatcher outbound. |
| `core/event-types.ts` | Tipos canonicos e `ALL_EVENT_TYPES_SET`. |
| `core/event-producer.service.ts` | Single entry point de emissao. |
| `core/event-router.service.ts` | Roteia audit sempre; notification/webhook por trigger. |
| `core/circuit-breaker.service.ts` | Half-open circuit breaker. |
| `core/intelligent-retry.service.ts` | Backoff em memoria. |
| `consumers/audit-log.consumer.ts` | INSERT em `DEvento` com `idClasse` mapeado. |
| `consumers/notification.consumer.ts` | INSERT em `DEvento -490` para destinatarios resolvidos. |
| `consumers/notification-triggers.const.ts` | Set de triggers de notificacao. |
| `consumers/webhook.consumer.ts` | Resolve org, busca `DTabela -470`, delega ao dispatcher. |
| `consumers/webhook-triggers.const.ts` | Whitelist/blacklist e matching de eventos. |
| `dispatchers/webhook-dispatcher.stub.ts` | Stub sem entrega externa real; mascara endpoint em log. |
| `monitoring/telemetry.service.ts` | Contadores em memoria. |
| `monitoring/event-health.controller.ts` | `GET /events/health`. |

## Como Emitir

```typescript
await this.eventProducer.addInternalEvent(
  'task.status.changed',
  { taskId: task.chave.toString(), projectId: task.idProject?.toString() },
  this.correlationIdService.getOrGenerate(),
  { source: TasksService.name },
);
```

Regras:

1. Emitir sempre apos persistencia bem-sucedida.
2. Adicionar tipos novos em `core/event-types.ts` antes de emitir.
3. Services emissores nao fazem `prisma.dEvento.create` direto.
4. Consumers em `src/eventos/consumers` nao chamam `EventProducerService.addInternalEvent()`.

## Tipos Canonicos

| Categoria | Tipos | idClasse DEvento |
|---|---|---|
| Tasks | `task.created` | `-497` TASK_CREATED |
| Tasks | `task.status.changed`, `task.assigned`, `task.deleted` | `-498` TASK_STATUS_CHANGED |
| Projects | `project.created`, `project.updated`, `project.deleted` | `-499` PROJECT_LIFECYCLE |
| Orgs | `org.created`, `org.updated`, `org.deleted` | `-500` ORG_LIFECYCLE |
| Teams | `team.created`, `team.deleted` | `-489` AUDIT_GENERIC |
| Entidades | `entity.created`, `entity.updated`, `entity.deleted` | `-489` AUDIT_GENERIC |
| Executions | `execution.*` canonicos de F6 | `-496` EXECUTION_LOG |
| Email | `email.sent`, `email.failed` | `-489` AUDIT_GENERIC |
| Auth | `user.login.succeeded`, `user.login.failed` | `-501` USER_LOGIN |
| Sistema | `system.health.check`, `system.audit.log` | `-489` AUDIT_GENERIC |
| Integracoes | `agent.heartbeat`, `webhook.attempted`, `mcp.call`, `telegram.message.in/out` | `-492`/`-491`/`-495`/`-493`/`-494` |

## NotificationConsumer

`NotificationConsumer` grava notificacoes in-app em `DEvento.idClasse=-490`.
Leitura, contagem, marcar como lida e soft delete sao expostos por
`/notifications/*` no modulo `src/notifications`.

Campos principais:

```json
{
  "idClasse": "-490",
  "idEntidade": "<DEntidade.chave do destinatario>",
  "identificadorExterno": "<correlationId>:notification:<eventType>:<recipientId>",
  "descricao": "mensagem curta",
  "metaDados": {
    "eventType": "task.status.changed",
    "title": "Task atualizada",
    "message": "Status da task alterado.",
    "read": false,
    "_meta": {
      "sourceEventCorrelationId": "<correlationId>",
      "createdBy": "NotificationConsumer"
    }
  }
}
```

Triggers:

| Trigger | Destinatarios |
|---|---|
| `task.status.changed` | `DTask.idCreator` + `DTask.idAssignee`, deduplicados |
| `task.assigned` | `DTask.idAssignee` + `DTask.idCreator`, deduplicados |
| `execution.awaiting_approval` | managers do projeto (`DVincula -171`) + admins da org (`DVincula -161`) |
| `execution.completed`, `execution.failed` | `payload.userId`/`entidadeId` + managers quando houver `projectId` |

Idempotencia: lookup em lote por `identificadorExterno` antes do insert. Sem
unique index nesta task. A partir da F7 Task #3, o lookup filtra
`excluido=false`, permitindo recriar uma notificacao equivalente se a anterior
foi excluida logicamente.

Estado de leitura:

- `metaDados.read = false | true`
- `metaDados.readAt = ISO string` quando marcada como lida
- ausencia de `metaDados.read` e tratada como nao lida pelos endpoints

Soft delete:

- campo autorizado pontualmente: `DEvento.excluido Boolean @default(false)`
- `DELETE /notifications/:id` seta `excluido=true`
- filtros de list/count/read/read-all/delete usam `excluido=false`
- a excecao e limitada a esta coluna e foi formalizada em ADR-V2-032

## WebhookConsumer

`WebhookConsumer` e acionado para `task.*`, `project.*`, `org.*` e
`execution.*`. A blacklist evita loops e eventos internos: `system.*`,
`webhook.*`, `agent.*`, `mcp.*`, `telegram.*`, `email.*`, `user.login.*`.

Resolucao de org:

1. `payload.orgId` / `organizationId` / `idOrg`.
2. `payload.projectId` -> `DProject.idEstab`.
3. `payload.taskId` -> `DTask.project.idEstab`.

Configs:

- Tabela: `DTabela`.
- Classe: `-470 WEBHOOK`.
- Escopo: `idLocEscrituracao=<orgId>`.
- Filtros: `excluido=false`, `inativo=false`.

Exemplo de `metaDados`:

```json
{
  "url": "https://example.test/webhook",
  "events": ["*", "task.*", "execution.completed"],
  "active": true
}
```

Matching:

| Padrao | Comportamento |
|---|---|
| `*` | qualquer evento permitido |
| `task.*` | qualquer evento com prefixo `task.` |
| `task.created` | evento exato |

Nesta task, o provider registrado e `WebhookDispatcherStub`. Ele nao entrega
evento fora do processo, nao calcula HMAC, nao faz retry de rede e nao cria
`DEvento -491`. Isso fica para F7 Task #4/F12.

## Sync Mode

O producer usa `Promise.allSettled` para aguardar consumers. Falha de um
consumer nao derruba os outros nem o caller; CircuitBreaker e Retry registram a
falha. Migracao para BullMQ/Redis fica para F14.

## Health

```text
GET /events/health
Authorization: Bearer <jwt>
```

Consumers esperados:

```json
{
  "audit-log": "up",
  "notification": "up",
  "webhook": "stub"
}
```

## Nao Objetivos Desta Etapa

- Webhook HTTP real, HMAC, retry de rede, auto-disable e `DEvento -491`.
- CRUD `/webhooks`.
- BullMQ/Redis.
- Seed ou nova DClasse.

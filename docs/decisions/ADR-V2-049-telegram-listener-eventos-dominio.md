# ADR-V2-049: Telegram listener para eventos de domínio (`phase.completed` v1)

**Status:** Proposed
**Data:** 2026-05-21
**Decisores:** CEO + Strategist Agent V2 + Implementer Agent V2 (F9c)
**Tags:** #V2 #pós-F8 #channels #telegram #eventos #ADR-V2-008 #ADR-V2-010 #ADR-V2-042 #ADR-V2-047

---

## Contexto e Problema

ADR-V2-047 F8 entregou o evento idempotente `phase.completed` (emitido por `TasksService.detectPhaseCompletion` quando uma fase agregada cruza 100%, snapshot anti-reemissão em `dados._meta.phaseSnapshotPercent`). Para fechar a F9 do ADR-V2-047, falta um **listener de canal externo** que notifique destinatários no Telegram.

Hoje (`src/eventos/consumers/`) o pipeline de eventos tem 3 consumers fixos:

- `AuditLogConsumer` — catch-all, persiste em DEvento por tipo (mapa `TYPE_TO_CLASSE`).
- `NotificationConsumer` — in-app (DEvento -490), aceita 5 triggers (`task.status.changed`, `task.assigned`, `execution.*`).
- `WebhookConsumer` — HTTP outbound HMAC, prefixos `task.|project.|org.|execution.|phase.` permitidos (F8).

`phase.completed` já dispara webhook outbound (entregue F8), mas falta canal direto (Telegram) para usuários pareados.

Adicionar Telegram dentro de `NotificationConsumer` mistura semântica (in-app DEvento -490 ≠ canal externo de saída) e impossibilita expansão para WhatsApp/Slack sem refactor. Precisamos de pattern dedicado.

## Decisão

**Criar `TelegramNotificationConsumer` em `src/channels/telegram/`**, implementando `IEventConsumer`, com:

1. **Trigger v1:** apenas `phase.completed`. Para incluir mais eventos (ex: `task.assigned`), basta alterar a função `match` registrada em `OnModuleInit`.
2. **Auto-registro via `EventRouterService.registerConsumer(match, consumer)`** — método novo introduzido junto, simétrico a `registerWebhookListener`. Evita import circular `EventosModule ↔ ChannelsModule` (EventosModule é `@Global()`; o consumer fica em Channels e injeta o router).
3. **Idempotência via DEvento -494** (`TELEGRAM_MSG_OUT`, reutilizada — ver §"Reuso da DClasse" abaixo): `identificadorExterno = "{correlationId}:{eventType}:{recipientId}"`. Antes de enviar, batch findMany; depois de cada envio, createMany por destinatário com `metaDados.success` + opcional `metaDados.error`.
4. **Destinatários v1:** `idCreator` da fase + assignees diretos das tasks-folha filhas (filhos direto via `idPai`, sem recursão por simplicidade). Dedup, intersect com membros da org via `DVincula`.
5. **Tenant scope (ADR-V2-042):** `idEstab` resolvido junto com idCreator no findUnique; recipients fora da mesma org filtrados via query `DVincula` org-membership.
6. **Timeout 3s no `telegram.sendMessage`** via `Promise.race`. Timeout NÃO propaga ao pipeline — vira DEvento com `metaDados.error='timeout'`. Mitiga risco RISCO#4 do plano (API Telegram lenta poderia travar `EventRouterService` em-process).
7. **Token ausente** (`TELEGRAM_BOT_TOKEN` undefined): skip sem error, igual `telegram-send.service.ts:49-52`. DEvento persistido com `metaDados.error='token_missing'` para auditoria.
8. **Mensagem markdown curta**, link opcional via `FRONTEND_BASE_URL` env.

### Reuso da DClasse `-494 TELEGRAM_MSG_OUT`

O plano original previa **criar nova DClasse `-494 TELEGRAM_NOTIFICATION_SENT`** em sub-fase 0 (bloqueante via seed). Durante a implementação, descobriu-se que **`-494 TELEGRAM_MSG_OUT`** já existe no seed (`prisma/seeds/classes.seed.ts:209`):

```ts
esp(-494, 'TELEGRAM_MSG_OUT', 'Mensagem Telegram enviada', -3)
```

E `audit-log.consumer.ts:107` já mapeia `'telegram.message.out' → BigInt(-494)`. Semanticamente IDÊNTICA ao que o plano queria. Reuso evita:

- Sequestro acidental de chave canônica (ADR-V2-001).
- Mudança em seed (Pilar 3 — Zero risco regressivo).
- Bump em `EXPECTED_TOTAL_COUNT` do seed-validate.
- Conflito com ADR-V2-008 (DEvento substitui DNotification — não criar nova DClasse se uma equivalente existe).

A idempotência funciona idêntica: a chave de unicidade é `identificadorExterno`, não o `idClasse`. Auditoria fica mais limpa (todos os outputs Telegram, sejam de chat command ou listener, ficam em `-494`).

### Alternativas Avaliadas

| Alternativa | Avaliação |
|-------------|-----------|
| Adicionar Telegram no `NotificationConsumer` existente | **Rejeitado.** Mistura in-app (DEvento -490) com canal externo. Impede pattern para Slack/WhatsApp futuros. |
| Acionar via `registerWebhookListener` | **Rejeitado.** Semântica errada ("webhook" ≠ "canal externo"). |
| BullMQ assíncrono | **Rejeitado para v1.** Em-process é mais simples; risco mitigado pelo timeout 3s. Migração para BullMQ planejada para F14 (junto com migração geral de consumers — ADR-V2-019 em redação). |
| Criar nova DClasse `-494 TELEGRAM_NOTIFICATION_SENT` | **Rejeitado.** Já existe `-494 TELEGRAM_MSG_OUT` semanticamente equivalente. Reuso evita pollution. |

## Conformidade com Pilares Devari-Core

- **Pilar 1 (Engine):** N/A — consumer puramente reativo, sem INSERT em DPedido transacional.
- **Pilar 2 (Endpoints genéricos):** N/A — sem endpoint REST novo.
- **Pilar 3 (Seed):** preservado — **zero seed mudou.** Reuso de `-494 TELEGRAM_MSG_OUT`.

## Pattern Replicável

Este ADR estabelece o pattern "**um consumer por canal externo de saída**":

```
src/channels/<canal>/<canal>-notification.consumer.ts
  - Implementa IEventConsumer (handle: process event)
  - OnModuleInit: eventRouter.registerConsumer(match, this)
  - Idempotência via DEvento -494/-495/-496/... (1 DClasse por canal)
  - Timeout configurável por canal
  - Token ausente → skip silencioso (ADR-V2-010)
```

Replicação para WhatsApp/Slack futuros:
1. Reusar DClasse próxima (`-495` se existir) OU criar nova no seed se necessário (ADR específico).
2. Implementar consumer espelhando este.
3. Adicionar ao módulo do canal.

## Tenant Scope (ADR-V2-042)

Defense-in-depth aplicado em 2 camadas:

1. **Resolução da fase:** `findUnique` carrega `project.idEstab`. Se a fase é cross-org, o resolver retorna `null` antes de qualquer query de destinatários.
2. **Filtro de destinatários:** intersect com `DVincula` org-membership (`idLocEscritu=idEstab AND idEntidade IN [recipients]`). Destinatário fora da org é silenciosamente removido (sem revelar existência).

## Limitações conhecidas (v1)

- **Recursividade dos descendentes:** consumer enumera APENAS filhos diretos (`idPai = phaseId`), não recursivo. Justificativa: limita custo de query; v2 pode reutilizar `PhaseDescendantsService` (F9b) se necessário.
- **Sem retry automático:** falha de API (não-timeout) gera DEvento com error. Operador faz retry manual via reprocessamento. v2: BullMQ com retry exponencial.
- **Filtro DVincula sem restrição idClasse de role:** v1 enumera assignees APENAS via `idPai` direto (tasks-folha), sem validar se o assignee tem um DVincula válido com idClasse de role na organização. v2: adicionar filter `DVincula WHERE idClasse IN (lista de roles válidos)` para conformidade rigorosa com RBAC duplo (ADR-V2-003). Deixado para v2 por simplicidade F9c.
- **Sem opt-out por usuário:** não há config "mute phase notifications". v2: DTabela `-470` ou similar.
- **Mensagem fixa em português:** sem i18n. v2: payload `metaDados.locale` define template.

## Cross-link

- **ADR-V2-001** — 17 tabelas canônicas (preservado).
- **ADR-V2-008** — DEvento substitui DNotification (este consumer NÃO cria nova tabela; reuso de `-494`).
- **ADR-V2-010** — Channels opcionais (`TELEGRAM_BOT_TOKEN` ausente = noop, mantido).
- **ADR-V2-042** — Tenant isolation defense-in-depth (aplicado em 2 camadas).
- **ADR-V2-047** — Fases via `DTask.idPai`; F9c fecha a fase 9 do roadmap.
- **ADR-V2-048** — Fases fora do board V3 (ratifica que `phase.completed` só nasce do agregado).

---

**Maintained by:** Devari Tecnologia
**Versão:** 1.0
**Última atualização:** 2026-05-21

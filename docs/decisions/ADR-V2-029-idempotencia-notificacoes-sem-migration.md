# ADR-V2-029 - Idempotencia de notificacoes sem migration nesta task

**Status:** Aceito
**Data:** 2026-05-10
**Decisores:** Strategist Agent V2; implementacao aprovada pelo Reviewer Agent V2
**Tags:** `#V2` `#fase-F7` `#eventos` `#notifications` `#pilar-3`

---

## Contexto e Problema

`NotificationConsumer` cria notificacoes in-app em `DEvento.idClasse=-490`. Como eventos podem ser reprocessados por retry/circuit breaker, a task precisava evitar duplicatas para o mesmo destinatario sem adicionar migration ou indice unico.

O plano da F7 Task #2 proibia migration e seed novo. Portanto, idempotencia forte por constraint de banco ficava fora do escopo.

## Alternativas Consideradas

### Opcao A - Lookup por `identificadorExterno` antes do insert (escolhida)

**Pros:** zero migration, simples de testar, reduz duplicatas no fluxo normal e respeita as 17 tabelas canonicas.

**Contras:** nao e idempotencia forte sob corrida simultanea sem unique index.

### Opcao B - Unique index em `DEvento.identificadorExterno`

**Pros:** idempotencia forte no banco.

**Contras:** exige migration, pode afetar outros tipos de evento e estava fora da task.

### Opcao C - Aceitar duplicatas ate F7 Task #3

**Pros:** menor codigo.

**Contras:** degrada UX e torna read/unread/delete mais ambiguos.

## Decisao

Escolhemos lookup pre-insert usando `identificadorExterno` no formato:

```text
<correlationId>:notification:<eventType>:<recipientId>
```

A implementacao usa `findMany` em lote e `createMany` para evitar N+1 por destinatario.

## Consequencias

**Positivas:** protege o caso comum de retry sem schema change.

**Negativas:** corrida simultanea ainda pode duplicar notificacao; hardening com unique index deve ser avaliado em F14 se o volume justificar.

**Melhoria futura registrada:** Reviewer apontou minor em `src/eventos/consumers/notification.consumer.ts:75`: o lookup atual nao filtra `excluido: false`. Ajustar em F7 Task #3 ao implementar read/delete de notifications.

## Implementacao

- Fase V2: F7 Task #2
- Codigo: `src/eventos/consumers/notification.consumer.ts`
- Plan vinculado: `workspace/plans/plan-eventos-consumers-f7-task2.md`
- Impl notes: `workspace/implementations/impl-eventos-consumers-f7-task2.md`
- Review: `workspace/reviews/review-eventos-consumers-f7-task2.md`
- Resultado: APPROVED 8.4/10

## Referencias

- ADR-V2-001 - 17 tabelas canonicas
- ADR-V2-008 - DEvento substitui DNotification/DWebhook

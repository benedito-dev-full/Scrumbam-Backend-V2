# ADR-V2-030 - Contrato de dispatcher stub

**Status:** Aceito
**Data:** 2026-05-10
**Decisores:** Strategist Agent V2; implementacao aprovada pelo Reviewer Agent V2
**Tags:** `#V2` `#fase-F7` `#eventos` `#webhooks`

---

## Contexto e Problema

F7 Task #2 precisava provar o roteamento de webhooks sem implementar entrega HTTP real. HMAC-SHA256, retry de rede, auto-disable e persistencia de tentativas pertencem a F7 Task #4/F12.

Sem um contrato agora, `WebhookConsumer` ficaria acoplado a uma implementacao futura ou o escopo vazaria para HTTP real.

## Alternativas Consideradas

### Opcao A - Interface + provider stub (escolhida)

**Pros:** fixa contrato, permite testes com mock, evita HTTP real e reduz acoplamento do consumer.

**Contras:** entrega externa ainda nao acontece nesta task.

### Opcao B - Implementar dispatcher HTTP real agora

**Pros:** feature mais completa.

**Contras:** mistura F7 Task #2 com F12, exige HMAC/retry/auto-disable e aumenta blast radius.

### Opcao C - Log inline dentro do `WebhookConsumer`

**Pros:** menos arquivos.

**Contras:** nao cria ponto de extensao limpo para dispatcher real.

## Decisao

Criar `IWebhookDispatcher`, `WEBHOOK_DISPATCHER_TOKEN` e `WebhookDispatcherStub`. O stub mascara endpoint em log e retorna:

```typescript
{ skipped: true, reason: 'stub' }
```

Ele nao usa `fetch`, `axios`, `http.request` nem persiste `DEvento -491`.

## Consequencias

**Positivas:** F12 pode trocar a implementacao por provider real sem alterar `WebhookConsumer`.

**Negativas:** consumidores de produto ainda nao recebem webhooks externos ate a task futura.

## Implementacao

- Fase V2: F7 Task #2
- Codigo: `src/eventos/interfaces/webhook-dispatcher.interface.ts`
- Codigo: `src/eventos/dispatchers/webhook-dispatcher.stub.ts`
- Plan vinculado: `workspace/plans/plan-eventos-consumers-f7-task2.md`
- Impl notes: `workspace/implementations/impl-eventos-consumers-f7-task2.md`
- Review: `workspace/reviews/review-eventos-consumers-f7-task2.md`
- Resultado: APPROVED 8.4/10

## Referencias

- ADR-V2-012 - Webhooks outbound HMAC/retry/auto-disable (fase futura)
- ADR-V2-028 - Webhook config em DTabela -470

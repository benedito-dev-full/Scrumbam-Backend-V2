---
# Path-specific: carrega quando trabalhando com eventos
paths:
  - "src/eventos/**/*.ts"
---

# Nomenclatura Padrao de Eventos - Devari Core

**Versao:** 1.0
**Data:** 2026-02-26
**Aplicavel a:** Services, Event Processors, EventRouter

---

## ARQUITETURA DE EVENTOS

O Devari Core usa **arquitetura event-driven** com **filas especializadas BullMQ** para processamento assincrono.

**Principio fundamental:** Services/Adapters emitem eventos padronizados, `EventRouterService` decide a fila baseado em **analise do payload**.

**REGRA CRITICA:** Services **NUNCA** implementam logica de roteamento. Apenas emitem evento, EventRouter faz decisao (prioridade, tipo, load balancing).

---

## FORMATO PADRAO

```
{dominio}.{acao}
{dominio}.{entidade}.{acao}
```

**Exemplos:**
- `order.created` (dominio.acao)
- `entity.status.changed` (dominio.entidade.acao)

---

## NOMENCLATURA POR DOMINIO

### 1. Pedidos/Transacoes (Order Events)

```typescript
// Eventos padrao de pedidos
'order.created'              // Pedido criado (via Engine/Operacao)
'order.approved'             // Pedido aprovado
'order.cancelled'            // Pedido cancelado
'order.completed'            // Pedido finalizado/concluido
'order.updated'              // Pedido atualizado (campos nao-criticos)
```

**Payload esperado:**
```typescript
{
  type: 'order.created',
  payload: {
    pedidoId: '123',
    idClasse: '-22',
    valor: 100.00,
    entidadeId: '456',
    metadata: {
      source: 'PedidoService',
      timestamp: '2026-01-31T...'
    }
  }
}
```

---

### 2. Entidades/Cadastros (Entity Events)

```typescript
// Eventos padrao de entidades
'entity.created'             // Entidade criada
'entity.updated'             // Entidade atualizada
'entity.deleted'             // Entidade excluida (soft delete)
'entity.status.changed'      // Status da entidade mudou
'entity.activated'           // Entidade ativada
'entity.deactivated'         // Entidade desativada
```

**Payload esperado:**
```typescript
{
  type: 'entity.created',
  payload: {
    entidadeId: '789',
    idClasse: '-45',
    nome: 'Marketplace ABC',
    metadata: {
      source: 'EntidadeService',
      timestamp: '2026-01-31T...'
    }
  }
}
```

---

### 3. Financeiro (Payment Events) -- quando aplicavel no SaaS gerado

```typescript
// Eventos financeiros (projetos com integracao de pagamento)
'payment.authorized'         // Pagamento autorizado
'payment.confirmed'          // Pagamento confirmado
'payment.failed'             // Pagamento falhou
'payment.refunded'           // Pagamento estornado
'payment.cancelled'          // Pagamento cancelado
```

---

### 4. Settlement/Liquidacao (Internal Events)

```typescript
// Eventos internos de processamento
'settlement.processing'      // Processamento de liquidacao iniciado
'taxation.required'          // Solicita calculo de taxas
'taxation.completed'         // Taxas calculadas
'titles.generated'           // Titulos gerados
'liquidation.completed'      // Liquidacao completa
```

---

### 5. Sistema/Audit (System Events)

```typescript
// Eventos de sistema e auditoria
'system.audit.log'           // Logs de auditoria
'system.health.check'        // Health checks
'system.config.updated'      // Configuracao atualizada
```

---

### 6. Retry Events

```typescript
// Eventos de retry/retentativa
'retry.attempted'            // Tentativa de retry executada
'retry.blocked'              // Operacao bloqueada por retry
'retry.exhausted'            // Todas tentativas de retry esgotadas
```

---

## METODOS DE DETECCAO (EventRouterService)

**Localizacao:** `src/eventos/core/event-router.service.ts`

```typescript
// Deteccao generica por dominio
isOrderEvent(event): boolean {
  return event.type.startsWith('order.');
}

isEntityEvent(event): boolean {
  return event.type.startsWith('entity.');
}

isPaymentEvent(event): boolean {
  return event.type.startsWith('payment.');
}

isRetryEvent(event): boolean {
  return event.type.includes('retry') ||
         (event.payload.retryCount && event.payload.retryCount > 0);
}

isAuditEvent(event): boolean {
  return event.type.includes('audit') ||
         event.type.includes('log') ||
         event.type.includes('monitoring');
}

isSettlementEvent(event): boolean {
  return event.type.includes('settlement') ||
         event.type.includes('taxation') ||
         event.type.includes('liquidation') ||
         event.type.includes('titles');
}
```

---

## FLUXOS CORRETOS

### Fluxo de Pedido Generico

```
1. Service cria pedido (via Engine/Operacao)
   |
2. Engine.grava() emite: 'order.created'
   |
3. EventRouter detecta dominio (isOrderEvent)
   |
4. Direciona para fila apropriada
   |
5. Processor consome e processa
   |
6. Emite evento seguinte (ex: 'settlement.processing')
```

### Fluxo de Entidade

```
1. Service cria/atualiza entidade
   |
2. Emite: 'entity.created' ou 'entity.updated'
   |
3. EventRouter detecta dominio (isEntityEvent)
   |
4. Direciona para fila de entidades
   |
5. Processor consome (notificacoes, sync, etc.)
```

### Fluxo de Retry

```
1. Processor detecta falha retentavel
   |
2. Emite: 'retry.attempted'
   |
3. EventRouter detecta retry (isRetryEvent)
   |
4. Direciona para retry-queue
   |
5. RetryProcessor processa com backoff exponencial
   |
6. Se esgotou tentativas: emite 'retry.exhausted'
```

---

## COMO EMITIR EVENTOS (Para Services)

### Template para Services

```typescript
// Em qualquer service
import { EventProducerService } from '../eventos/core/event-producer.service';

constructor(
  private readonly eventProducer: EventProducerService
) {}

// Emitir evento
private async registrarEvento(
  eventType: string,
  payload: any
): Promise<void> {
  await this.eventProducer.addInternalEvent(
    eventType,  // Ex: 'order.created'
    {
      ...payload,
      metadata: {
        source: this.constructor.name,  // Identificacao do service
        timestamp: new Date().toISOString()
      }
    },
    correlationId  // ID unico para rastreamento
  );
}

// Uso
await this.registrarEvento('order.created', {
  pedidoId: pedido.chave.toString(),
  valor: pedido.valor.toNumber(),
  entidadeId: pedido.pessoa.toString()
});
```

**NUNCA faca:**
```typescript
// ERRADO - Decidir fila manualmente
if (prioridade === 'alta') {
  queue = 'order-processing-high';  // Logica de roteamento no service!
} else {
  queue = 'order-processing-normal';
}
```

**EventRouter faz isso automaticamente!**

---

## CHECKLIST DE EVENTOS

Ao criar novo service ou modificar eventos:

- [ ] Evento segue nomenclatura padrao (dominio.acao ou dominio.entidade.acao)
- [ ] Payload inclui `metadata` com source e timestamp
- [ ] Payload inclui ID principal da entidade (rastreabilidade)
- [ ] Evento emitido via EventProducerService
- [ ] NUNCA implementa logica de roteamento no service
- [ ] Testa que EventRouter detecta corretamente
- [ ] Testa que fila correta e selecionada
- [ ] Evento emitido APOS persistencia (nunca antes)

---

**Este skill sera usado por Implementer agent ao criar services ou trabalhar com eventos.**

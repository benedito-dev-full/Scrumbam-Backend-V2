# `src/eventos/` — Eventos Canônicos V2

**Fase:** F7 — Bloco M (Producer + Router + Audit) + Bloco Q (Refactor F4/F6).
**Decisão:** ADR-V2-008 (DEvento substitui DNotification/DWebhook), ADR-V2-019 (sync-mode MVP), ADR-V2-020 (mapeamento canônico type→idClasse), ADR-V2-026 (AUDIT_GENERIC -489), ADR-V2-027 (PROJECT/ORG_LIFECYCLE -499/-500).

---

## TL;DR

- Único ponto de emissão de eventos no V2: `EventProducerService.addInternalEvent(type, payload, correlationId)`.
- Roteamento decidido pelo `EventRouterService` — services NÃO decidem fila/consumer.
- Persistência canônica em `DEvento` via `AuditLogConsumer` (catch-all em F7 Task#1).
- Resiliência: `CircuitBreakerService` (half-open, 5 falhas/60s, 30s recover) + `IntelligentRetryService` (backoff 1/2/4/8/16s, máx 5 tentativas).
- Saúde exposta em `GET /events/health` (JWT-only).
- **ZERO dependência de Engine** (`src/engine/`) — eventos são estruturais (Pilar 1 NÃO se aplica).
- **AuditService DELETADO** (F7 Bloco Q decisão CEO #4) — todos os callsites migraram para `EventProducerService`.

---

## Diagrama de fluxo

```
+----------------------+
|   Service caller     |  ← TasksService, ProjectsService, EmailService, OperacaoExecucaoClaude...
| (após persistência)  |
+----------+-----------+
           |
           |  await eventProducer.addInternalEvent(type, payload, correlationId, { source })
           v
+----------------------+
|  EventProducerService|  ← valida type ∈ ALL_EVENT_TYPES_SET (BadRequest se não)
| (single entry point) |    enriquece com metadata (source, timestamp, correlationId)
+----------+-----------+    chama Telemetry.trackEmitted
           |
           v
+----------------------+
|  EventRouterService  |  ← decide consumers (Task#1: catch-all = AuditLogConsumer)
+----------+-----------+    Task#2 estende para NotificationConsumer + WebhookConsumer
           |
           v  (1 ou N consumers, em paralelo via Promise.allSettled)
+----------------------+
| CircuitBreakerService|  ← checa estado (closed/open/half-open) por consumer
+----------+-----------+    se OPEN: skip + Telemetry.trackFailed
           |
           v
+----------------------+
|   consumer.handle()  |  ← AuditLogConsumer faz INSERT em DEvento (Prisma direto)
+----------+-----------+
           |
    sucesso|             falha
           v               v
       reportSuccess    reportFailure
       Telemetry        Telemetry.trackFailed
                        IntelligentRetryService.schedule
                        (backoff 1/2/4/8/16s, máx 5 tentativas)
```

---

## Arquivos

| Arquivo | Responsabilidade |
|---|---|
| `eventos.module.ts` | Módulo `@Global()`. Registra todos os services + `EventHealthController`. |
| `interfaces/event.interface.ts` | Contrato `IEvent<TPayload>` (type, payload, correlationId, metadata). |
| `interfaces/event-producer.interface.ts` | Contrato `IEventProducer` (consumido pelo Engine sem importar a implementação concreta). |
| `interfaces/consumer.interface.ts` | Contrato `IEventConsumer` (`name`, `handle(event)`). |
| `core/event-types.ts` | `EVENT_TYPES` (constante) + `ALL_EVENT_TYPES_SET` (Set para validação O(1)). |
| `core/event-producer.service.ts` | Single entry point; valida type, enriquece, roteia, executa consumers. |
| `core/event-router.service.ts` | Decide quais consumers invocar para cada event.type (Task#1: catch-all audit). |
| `core/circuit-breaker.service.ts` | Pattern Half-Open: 5 falhas/60s → OPEN; 30s no OPEN → HALF-OPEN; sucesso → CLOSED. |
| `core/intelligent-retry.service.ts` | Backoff exponencial 1/2/4/8/16s, máx 5 tentativas, `setTimeout` em memória. |
| `consumers/audit-log.consumer.ts` | INSERT em `DEvento` com `idClasse` mapeado canonicamente (TYPE_TO_CLASSE). |
| `monitoring/telemetry.service.ts` | Contadores em memória (1min/1h) por tipo + outcome. |
| `monitoring/event-health.controller.ts` | `GET /events/health` (JWT-only). |
| `dto/event-health-response.dto.ts` | Response shape do endpoint. |

---

## Como emitir eventos (services consumers)

```typescript
import { EventProducerService } from '../eventos/core/event-producer.service';
import { CorrelationIdService } from '../common/services/correlation-id.service';

@Injectable()
export class MeuService {
  constructor(
    private readonly eventProducer: EventProducerService,
    private readonly correlationIdService: CorrelationIdService,
  ) {}

  async criarFoo(dto: CreateFooDto): Promise<Foo> {
    const foo = await this.prisma.$transaction(/* ... */);

    // SEMPRE APÓS persistência (Padrão #7 devari-backend-patterns)
    await this.eventProducer.addInternalEvent(
      'foo.created',  // DEVE estar em EVENT_TYPES
      { fooId: foo.chave.toString(), nome: dto.nome },
      this.correlationIdService.getOrGenerate(),
      { source: MeuService.name },
    );

    return foo;
  }
}
```

**Regras**:
1. NUNCA emitir antes da persistência (evento órfão).
2. NUNCA chamar `prisma.dEvento.create` direto — apenas `AuditLogConsumer` faz isso.
3. Adicionar novo tipo: 1) entrada em `EVENT_TYPES`; 2) (opcional) mapeamento em `TYPE_TO_CLASSE`; 3) atualizar este README.
4. Para o Engine (`OperacaoExecucaoClaude`): receber via interface `IEventProducer` (sem importar `EventProducerService` concreto).

---

## Tipos canônicos (EVENT_TYPES)

| Categoria | Tipos | idClasse DEvento |
|---|---|---|
| **Tasks** | `task.created` | `-497` TASK_CREATED |
|  | `task.status.changed` | `-498` TASK_STATUS_CHANGED |
|  | `task.assigned`, `task.deleted` | `-498` (via `metaDados._meta.action`) |
| **Projects** (lifecycle) | `project.created`, `project.updated`, `project.deleted` | `-499` PROJECT_LIFECYCLE |
| **Orgs** (lifecycle) | `org.created`, `org.updated`, `org.deleted` | `-500` ORG_LIFECYCLE |
| **Teams** | `team.created`, `team.deleted` | `-489` AUDIT_GENERIC |
| **Entidades** | `entity.created`, `entity.updated`, `entity.deleted` | `-489` AUDIT_GENERIC |
| **Executions** (F6) | `execution.{low\|medium\|high}.created`, `execution.awaiting_approval`, `execution.approved`, `execution.rejected`, `execution.completed`, `execution.succeeded`, `execution.failed`, `execution.{low\|medium\|high}.skip` | `-496` EXECUTION_LOG |
| **Email** | `email.sent`, `email.failed` | `-489` AUDIT_GENERIC |
| **Auth** | `user.login.succeeded`, `user.login.failed` | `-501` USER_LOGIN |
| **Sistema** | `system.health.check`, `system.audit.log` | `-489` AUDIT_GENERIC |
| **Integrações** (F10/F11/F12 placeholders) | `agent.heartbeat`, `webhook.attempted`, `mcp.call`, `telegram.message.in`, `telegram.message.out` | `-492`/`-491`/`-495`/`-493`/`-494` |
| **Fallback** | qualquer outro | `-489` AUDIT_GENERIC (ADR-V2-026) |

---

## Sync mode (V2 MVP)

`Promise.allSettled` aguarda todos os consumers terminarem. Falha de um consumer NÃO derruba os outros nem o caller (CB conta + Retry agenda).

Se latência se tornar problema (target sub-plano §7.8: ≤ 5 queries por operação), trocar para `void Promise.allSettled(...)` (fire-and-forget total).

Migração para BullMQ + Redis: F14 (hardening pós-MVP) — ADR-V2-019.

---

## Resiliência

### CircuitBreaker

- **CLOSED** (estado inicial): tudo passa, conta falhas em janela 60s.
- **OPEN** (após 5 falhas em 60s): rejeita execuções.
- **HALF-OPEN** (após 30s no OPEN): permite 1 tentativa. Sucesso → CLOSED, falha → OPEN.

### IntelligentRetry

- Backoff exponencial: 1, 2, 4, 8, 16 segundos (máx 5 tentativas).
- `setTimeout` em memória (não persiste — process restart perde pendentes).
- Idempotência dos consumers mitiga: `audit-log` é INSERT (cada chamada cria 1 registro novo).

---

## Endpoint de saúde

```
GET /events/health
Authorization: Bearer <jwt>
```

Retorna:

```json
{
  "status": "healthy",  // | "degraded" | "unhealthy"
  "circuitBreaker": {
    "byConsumer": {
      "audit-log": { "state": "closed", "failuresInWindow": 0 }
    }
  },
  "retry": { "pendingRetries": 0, "maxAttemptsExceeded": 0 },
  "telemetry": { "eventsPerMinute": 12, "totalEventsLastHour": 543 },
  "consumers": {
    "byName": {
      "audit-log": "up",
      "notification": "pending (Task#2)",
      "webhook": "pending (Task#4)"
    }
  },
  "timestamp": "2026-05-09T..."
}
```

**Status global**:
- `healthy`: nenhum CB aberto + retries pendentes < 100.
- `degraded`: pelo menos 1 CB half-open OU retries pendentes ≥ 100.
- `unhealthy`: pelo menos 1 CB open.

---

## Decisões CEO 2026-05-09

| Decisão | Resultado |
|---|---|
| #3 (mapeamento type→idClasse) | Opção (b): renomear -499/-500 para LIFECYCLE; criar -489 AUDIT_GENERIC. ADR-V2-026 + ADR-V2-027. |
| #4 (AuditService façade vs delete) | Opção B: **DELETAR** AuditService + migrar 8 callsites. Sem façade, sem dupla emissão. |
| #5 (eventProducer no Engine: any vs IEventProducer) | Opção B: tipar via `IEventProducer`. Engine NÃO importa `EventProducerService` concreto. |

---

## Não-objetivos (Task#1)

Implementados em sub-tasks futuras:
- **Task#2**: `NotificationConsumer` + `WebhookConsumer` + endpoints `/notifications` (-490 -494) + `/webhooks` outbound (-491).
- **Task#4**: `AutoScalingService` + `WebhookIncomingController`.
- **F14**: BullMQ/Redis migration + Prometheus export + CB persistence.

---

## Ver também

- `.claude/rules/devari-event-naming.md` — naming convention dominio.entidade.acao.
- `.claude/rules/devari-backend-patterns.md` §14 — Padrão de event emission.
- `docs/decisions/ADR-V2-026-audit-generic-dclass.md`
- `docs/decisions/ADR-V2-027-project-org-lifecycle.md`
- `workspace/plans/plan-eventos-canonicos-f7-task1.md` — plano completo da fase.

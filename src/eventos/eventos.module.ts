import { Global, Module, forwardRef } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommonModule } from '../common/common.module';
import { EventProducerService } from './core/event-producer.service';
import { EventRouterService } from './core/event-router.service';
import { CircuitBreakerService } from './core/circuit-breaker.service';
import { IntelligentRetryService } from './core/intelligent-retry.service';
import { AuditLogConsumer } from './consumers/audit-log.consumer';
import { NotificationConsumer } from './consumers/notification.consumer';
import { WebhookConsumer } from './consumers/webhook.consumer';
import { WebhookDispatcherStub } from './dispatchers/webhook-dispatcher.stub';
import { WEBHOOK_DISPATCHER_TOKEN } from './interfaces/webhook-dispatcher.interface';
import { TelemetryService } from './monitoring/telemetry.service';
import { EventHealthController } from './monitoring/event-health.controller';

/**
 * Módulo Global de Eventos V2 — Pilar 2 e Padrão #14.
 *
 * Provê:
 *  - `EventProducerService` (single entry point para emissão).
 *  - `EventRouterService` (decide consumers).
 *  - `CircuitBreakerService` + `IntelligentRetryService` (resiliência).
 *  - `AuditLogConsumer` (persiste cada evento em DEvento).
 *  - `TelemetryService` + `EventHealthController` (monitoramento).
 *
 * Marcado como `@Global()` para que qualquer módulo possa injetar
 * `EventProducerService` (ou `IEventProducer`) sem importar
 * `EventosModule` localmente. Reduz boilerplate.
 *
 * Dependências:
 *  - `CommonModule` (também `@Global()`) — fornece `PrismaService` e
 *    `CorrelationIdService` por injeção transparente.
 *  - `AuthModule` (forwardRef) — `EventHealthController` usa `JwtAuthGuard`.
 *
 * Pilar 1 NÃO ATIVADO em F7: este módulo NÃO usa `Operacao*`.
 * `DEvento` é estrutural — `AuditLogConsumer` faz INSERT direto via
 * `PrismaService` (ADR-V2-005).
 *
 * F7 Bloco Q (decisão CEO #4): `AuditService` foi DELETADO; toda
 * auditoria passa por `EventProducerService.addInternalEvent()`.
 */
@Global()
@Module({
  imports: [CommonModule, forwardRef(() => AuthModule)],
  controllers: [EventHealthController],
  providers: [
    EventProducerService,
    EventRouterService,
    CircuitBreakerService,
    IntelligentRetryService,
    AuditLogConsumer,
    NotificationConsumer,
    WebhookConsumer,
    { provide: WEBHOOK_DISPATCHER_TOKEN, useClass: WebhookDispatcherStub },
    TelemetryService,
  ],
  exports: [EventProducerService, TelemetryService, CircuitBreakerService, EventRouterService],
})
export class EventosModule {}

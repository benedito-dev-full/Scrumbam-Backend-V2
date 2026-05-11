import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CorrelationIdService } from './services/correlation-id.service';
import { TimezoneService } from './services/timezone.service';
import { SensitiveDataSanitizerService } from './security/sensitive-data-sanitizer.service';

/**
 * `CommonModule` — Módulo global de serviços canônicos compartilhados.
 *
 * Marcado como `@Global()` para que os providers exportados estejam
 * disponíveis em qualquer módulo da aplicação (inclusive `EventosModule`,
 * `AuthModule`, etc.) sem necessidade de importar `CommonModule` em cada um.
 *
 * Providers exportados:
 *  - `PrismaService` — acesso ao banco (singleton).
 *  - `CorrelationIdService` — AsyncLocalStorage por request (X-Correlation-Id).
 *  - `TimezoneService` — manipulação de datas em America/Sao_Paulo.
 *
 * Reduz boilerplate em modules que precisam dos services comuns e garante
 * **uma única instância** de `CorrelationIdService` em toda a aplicação
 * (essencial para o tracing via AsyncLocalStorage).
 *
 * NÃO exporta `AuditService` — ele foi DELETADO em F7 Bloco Q
 * (ADR-V2-026 + decisão CEO 2026-05-09 #4). Use `EventProducerService`
 * (de `EventosModule`, também `@Global()`).
 */
@Global()
@Module({
  providers: [
    PrismaService,
    CorrelationIdService,
    TimezoneService,
    SensitiveDataSanitizerService,
  ],
  exports: [
    PrismaService,
    CorrelationIdService,
    TimezoneService,
    SensitiveDataSanitizerService,
  ],
})
export class CommonModule {}

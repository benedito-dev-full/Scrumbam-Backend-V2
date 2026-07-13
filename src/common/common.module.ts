import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { CorrelationIdService } from './services/correlation-id.service';
import { TimezoneService } from './services/timezone.service';
import { TenantScopeService } from './services/tenant-scope.service';
import { SensitiveDataSanitizerService } from './security/sensitive-data-sanitizer.service';
import { MetricsService } from './observability/metrics.service';
import { ProjectRefService } from '../projects/project-ref.service';

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
 *  - `TenantScopeService` — isolamento multi-tenant (ADR-V2-042).
 *  - `SensitiveDataSanitizerService` — sanitizacao de PII em logs.
 *  - `MetricsService` — contadores por log estruturado (F0 observabilidade).
 *    `@Global` de proposito: guards de auth (JwtAuthGuard, AuthCompositeGuard) e
 *    services de qualquer modulo injetam sem import explicito e sem ciclo.
 *  - `ProjectRefService` — handle canônico de projeto em DVincula via
 *    DEntidade-espelho -158 PROJECT_REF (ADR-V2-058). Registrado aqui (e não
 *    em `ProjectsModule`) por ser `@Global` e depender apenas de `PrismaService`,
 *    permitindo injeção em executions/webhooks/auth/teams/folders sem
 *    dependência circular. O arquivo mora em `src/projects/` por coesão.
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
    TenantScopeService,
    SensitiveDataSanitizerService,
    ProjectRefService,
    MetricsService,
  ],
  exports: [
    PrismaService,
    CorrelationIdService,
    TimezoneService,
    TenantScopeService,
    SensitiveDataSanitizerService,
    ProjectRefService,
    MetricsService,
  ],
})
export class CommonModule {}

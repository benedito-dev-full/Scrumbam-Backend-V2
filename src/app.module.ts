import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { EntidadesModule } from './entidades/entidades.module';
import { TabelasModule } from './tabelas/tabelas.module';
import { ClassesModule } from './classes/classes.module';
import { AuthModule } from './auth/auth.module';
import { PermissoesModule } from './permissoes/permissoes.module';

// F4 — Common Services + Email
import { CommonModule } from './common/common.module';
import { EmailModule } from './email/email.module';
import { HealthModule } from './common/health/health.module';
import { CorrelationIdMiddleware } from './common/middlewares/correlation-id.middleware';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

// F5 — Domínio Estrutural Scrumban (Organizations, Teams, Sprints, Workflow Statuses, Projects, Tasks)
import { OrganizationsModule } from './organizations/organizations.module';
import { TeamsModule } from './teams/teams.module';
import { SprintsModule } from './sprints/sprints.module';
import { WorkflowStatusesModule } from './workflow-statuses/workflow-statuses.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';

// F6 — Engine + Executions (OperacaoExecucaoClaude + ApprovalFlow + Sweeper)
import { ExecutionsModule } from './executions/executions.module';

// F7 — Eventos Canônicos (EventProducerService + AuditLogConsumer + /events/health)
import { EventosModule } from './eventos/eventos.module';
import { NotificationsModule } from './notifications/notifications.module';

// F8 — Flow Metrics (read-only analytics) + Forecast Monte Carlo + Search
import { FlowMetricsModule } from './flow-metrics/flow-metrics.module';
import { ForecastModule } from './forecast/forecast.module';
import { SearchModule } from './search/search.module';
import { DashboardsModule } from './dashboards/dashboards.module';
import { AnalyticsModule } from './analytics/analytics.module';
import { ReportsModule } from './reports/reports.module';

// F10 — Channels (Telegram + Groq Whisper) — Bloco A: Core Channels
import { ChannelsModule } from './channels/channels.module';
import { McpModule } from './mcp/mcp.module';
import { WebhooksModule } from './webhooks/webhooks.module';
import { AutomationModule } from './automation/automation.module';

/**
 * AppModule raiz do Scrumban-Backend-V2.
 *
 * Estrutura canônica Devari-Core (será populada nas fases F1-F13):
 *
 *   src/
 *   ├── classes/        — endpoint genérico /classes (Pilar 2)        [F2]
 *   ├── entidades/      — endpoint genérico /entidades (Pilar 2)      [F2]
 *   ├── tabelas/        — endpoint genérico /tabela (Pilar 2)         [F2]
 *   ├── auth/           — JWT + RBAC duplo via DVincula                [F3]
 *   ├── permissoes/     — DPermissao CRUD                              [F3]
 *   ├── email/          — provedor de email + templates                [F4]
 *   ├── common/         — TimezoneService + pipes + utils              [F4]
 *   ├── projects/       — DProject (com automation fields em dados)    [F5]
 *   ├── tasks/          — DTask + V3 intentions + workSessions         [F5]
 *   ├── engine/         — Operacao + OperacaoExecucaoClaude (PILAR 1) [F6]
 *   ├── eventos/        — DEvento + EventProducerService               [F7]
 *   ├── flow-metrics/   — runtime sobre DTask                          [F8]
 *   ├── forecast/       — Monte Carlo                                  [F8]
 *   ├── search/         — FTS                                          [F8]
 *   ├── reports/        — read-only PDF                                [F9]
 *   ├── dashboards/     — read-only dashboards                         [F9]
 *   ├── analytics/      — agregações                                   [F9]
 *   ├── channels/       — Telegram + voz Groq                          [F10]
 *   ├── mcp/            — MCP Server (5 tools)                         [F11]
 *   ├── webhooks/       — outbound HMAC + retry                        [F12]
 *   ├── automation/     — Agent + Execution + Risk Gate                [F13]
 *   └── integrations/   — adapters (groq, github)                      [F10/13]
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
    }),
    ScheduleModule.forRoot(),
    // F4 — CommonModule (@Global) — exporta PrismaService, CorrelationIdService, TimezoneService
    CommonModule,
    // F2 — Pilar 2: Endpoints Genéricos (EntidadeController, TabelaController, ClasseController)
    EntidadesModule,
    TabelasModule,
    ClassesModule,
    // F3 — Auth + RBAC duplo (DUserGroup + DVincula)
    AuthModule,
    PermissoesModule,
    // F4 — Email + Common Services
    EmailModule,
    HealthModule,
    // F5 — Domínio Estrutural Scrumban (Blocos A, B, C, D, E implementados)
    OrganizationsModule,
    TeamsModule,
    SprintsModule,
    WorkflowStatusesModule,
    ProjectsModule,
    TasksModule,
    // F6 — Automation Claude Code (Engine + Executions + ApprovalFlow)
    ExecutionsModule.forRoot(),
    // F7 — Eventos Canônicos (EventProducerService global + /events/health)
    EventosModule,
    // F7 — Notifications endpoints sobre DEvento -490
    NotificationsModule,
    // F8 — Flow Metrics + Forecast Monte Carlo + Search (read-only analytics)
    FlowMetricsModule,
    ForecastModule,
    SearchModule,
    // F9 Bloco V - Dashboards read-only + cache TTL
    DashboardsModule,
    // F9 Bloco W - Analytics read-only
    AnalyticsModule,
    // F9 Bloco X - Reports PDF read-only
    ReportsModule,
    // F10 Bloco A — Core Channels (pairing, routing, command registry)
    ChannelsModule,
    McpModule,
    WebhooksModule,
    AutomationModule,
  ],
  providers: [
    // LoggingInterceptor global — loga method, path, statusCode, durationMs, correlationId
    {
      provide: APP_INTERCEPTOR,
      useClass: LoggingInterceptor,
    },
    // HttpExceptionFilter global — padroniza responses 4xx/5xx com correlationId
    {
      provide: APP_FILTER,
      useClass: HttpExceptionFilter,
    },
  ],
})
export class AppModule implements NestModule {
  /**
   * Registra o CorrelationIdMiddleware globalmente para todas as rotas.
   *
   * O middleware lê/gera o X-Correlation-Id e inicializa o AsyncLocalStorage
   * antes de qualquer handler ser executado.
   */
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('*');
  }
}

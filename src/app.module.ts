import { Module, MiddlewareConsumer, NestModule } from '@nestjs/common';
import { APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';
import { EntidadesModule } from './entidades/entidades.module';
import { TabelasModule } from './tabelas/tabelas.module';
import { ClassesModule } from './classes/classes.module';
import { AuthModule } from './auth/auth.module';
import { PermissoesModule } from './permissoes/permissoes.module';

// F4 — Common Services + Email
import { EmailModule } from './email/email.module';
import { HealthModule } from './common/health/health.module';
import { CorrelationIdMiddleware } from './common/middlewares/correlation-id.middleware';
import { CorrelationIdService } from './common/services/correlation-id.service';
import { LoggingInterceptor } from './common/interceptors/logging.interceptor';
import { HttpExceptionFilter } from './common/filters/http-exception.filter';

// F5 — Domínio Estrutural Scrumban (Organizations, Teams, Sprints, Workflow Statuses, Projects, Tasks)
import { OrganizationsModule } from './organizations/organizations.module';
import { TeamsModule } from './teams/teams.module';
import { SprintsModule } from './sprints/sprints.module';
import { WorkflowStatusesModule } from './workflow-statuses/workflow-statuses.module';
import { ProjectsModule } from './projects/projects.module';
import { TasksModule } from './tasks/tasks.module';

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
    // Modules canônicos das fases F6-F13 restantes serão importados aqui.
  ],
  providers: [
    PrismaService,
    CorrelationIdService,
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
  exports: [PrismaService],
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

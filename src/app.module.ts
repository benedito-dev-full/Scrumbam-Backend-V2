import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaService } from './prisma.service';

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
    // Modules canônicos serão importados aqui nas fases F1-F13.
  ],
  providers: [PrismaService],
  exports: [PrismaService],
})
export class AppModule {}

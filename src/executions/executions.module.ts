import { Module } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { EntidadesModule } from '../entidades/entidades.module';
import { AutomationModule } from '../automation/automation.module';

import { ExecutionsController } from './executions.controller';
import { ExecutionsService } from './executions.service';
import { ApprovalFlowService } from './approval-flow.service';
import { ApprovalFlowSweeperService } from './approval-flow-sweeper.service';
import { ExecutionHistoryService } from './execution-history.service';
import { ClaudeRunnerService } from './claude-runner.service';
import { CommandValidatorService } from './services/command-validator.service';
import { EXECUTION_QUEUE_NAME } from './queues/execution-queue.constants';
import { ExecutionQueueService } from './queues/execution-queue.service';
import { ExecutionRunProcessor } from './processors/execution-run.processor';
import { ExecutionAccessGuard } from './guards/execution-access.guard';
import { ExecutionThrottlerGuard } from './guards/execution-throttler.guard';
import { IdempotencyGuard } from './guards/idempotency.guard';

/**
 * ExecutionsModule — Automation Claude Code (Pilar 1 + F6).
 *
 * Expõe endpoints de execution (POST /projects/:id/execute, GET /executions, etc.)
 * via Engine OperacaoExecucaoClaude.
 *
 * ThrottlerModule: 30 req/min por projectId (hash SHA-256).
 * ScheduleModule.forFeature(): cron @Cron do ApprovalFlowSweeperService.
 *
 * F7 Bloco Q: ExecutionsService injeta EventProducerService real (sem stub).
 * EventosModule é `@Global()` — providers disponíveis via DI sem import explícito.
 *
 * Bloco C (F13): adicionados CommandValidatorService e IdempotencyGuard.
 *
 * @see ADR-V2-005 (OperacaoExecucaoClaude extends OperacaoPedido)
 * @see ADR-V2-006 (risk via idClasse -301/-302/-303)
 */
@Module({
  imports: [
    ConfigModule,
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => ({
        connection: {
          host: configService.get<string>('REDIS_HOST', 'localhost'),
          port: Number(configService.get<string>('REDIS_PORT', '6379')),
          ...(configService.get<string>('REDIS_PASSWORD')
            ? { password: configService.get<string>('REDIS_PASSWORD') }
            : {}),
        },
      }),
    }),
    BullModule.registerQueue({
      name: EXECUTION_QUEUE_NAME,
      defaultJobOptions: {
        attempts: 1,
        removeOnComplete: { count: 500, age: 86400 },
        removeOnFail: { count: 1000, age: 604800 },
      },
    }),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 30 }]),
    EntidadesModule,
    AutomationModule,
  ],
  controllers: [ExecutionsController],
  providers: [
    ExecutionsService,
    ApprovalFlowService,
    ApprovalFlowSweeperService,
    ExecutionHistoryService,
    ClaudeRunnerService,
    CommandValidatorService,
    ExecutionQueueService,
    ExecutionRunProcessor,
    ExecutionAccessGuard,
    ExecutionThrottlerGuard,
    IdempotencyGuard,
  ],
  exports: [ExecutionsService, ExecutionHistoryService, ClaudeRunnerService, ExecutionQueueService],
})
export class ExecutionsModule {}

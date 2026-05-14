import { Module, DynamicModule } from '@nestjs/common';
import { BullModule } from '@nestjs/bullmq';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { EntidadesModule } from '../entidades/entidades.module';
import { AutomationModule } from '../automation/automation.module';
import { TasksModule } from '../tasks/tasks.module';

import { ExecutionsController } from './executions.controller';
import { ExecutionsService } from './executions.service';
import { ApprovalFlowService } from './approval-flow.service';
import { ApprovalFlowSweeperService } from './approval-flow-sweeper.service';
import { ExecutionHistoryService } from './execution-history.service';
import { ClaudeRunnerService } from './claude-runner.service';
import { CommandValidatorService } from './services/command-validator.service';
import { EXECUTION_QUEUE_NAME } from './queues/execution-queue.constants';
import { ExecutionQueueService } from './queues/execution-queue.service';
import { InMemoryQueueService } from './queues/in-memory-queue.service';
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
 * Redis opcional: quando REDIS_ENABLED=false, usa InMemoryQueueService (sem persistência).
 *
 * @see ADR-V2-005 (OperacaoExecucaoClaude extends OperacaoPedido)
 * @see ADR-V2-006 (risk via idClasse -301/-302/-303)
 */
@Module({})
export class ExecutionsModule {
  static forRoot(): DynamicModule {
    const configService = new ConfigService();
    const redisEnabled = configService.get<string>('REDIS_ENABLED', 'true') === 'true';

    const baseImports = [
      ConfigModule,
      ScheduleModule.forRoot(),
      ThrottlerModule.forRoot([{ ttl: 60000, limit: 30 }]),
      EntidadesModule,
      AutomationModule,
      TasksModule,
    ];

    const redisImports = redisEnabled
      ? [
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
        ]
      : [];

    const queueProvider = {
      provide: ExecutionQueueService,
      useClass: redisEnabled ? ExecutionQueueService : InMemoryQueueService,
    };

    const baseProviders = [
      ExecutionsService,
      ApprovalFlowService,
      ApprovalFlowSweeperService,
      ExecutionHistoryService,
      ClaudeRunnerService,
      CommandValidatorService,
      queueProvider,
      ExecutionAccessGuard,
      ExecutionThrottlerGuard,
      IdempotencyGuard,
    ];

    const processorProvider = redisEnabled ? [ExecutionRunProcessor] : [];

    return {
      module: ExecutionsModule,
      imports: [...baseImports, ...redisImports],
      controllers: [ExecutionsController],
      providers: [...baseProviders, ...processorProvider],
      exports: [ExecutionsService, ExecutionHistoryService, ClaudeRunnerService, ExecutionQueueService],
    };
  }
}

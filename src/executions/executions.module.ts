import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { ThrottlerModule } from '@nestjs/throttler';

import { PrismaService } from '../prisma.service';
import { EntidadesModule } from '../entidades/entidades.module';

import { ExecutionsController } from './executions.controller';
import { ExecutionsService } from './executions.service';
import { ApprovalFlowService } from './approval-flow.service';
import { ApprovalFlowSweeperService } from './approval-flow-sweeper.service';
import { ExecutionHistoryService } from './execution-history.service';
import { ClaudeRunnerService } from './claude-runner.service';
import { ExecutionAccessGuard } from './guards/execution-access.guard';
import { ExecutionThrottlerGuard } from './guards/execution-throttler.guard';

/**
 * ExecutionsModule — Automation Claude Code (Pilar 1 + F6).
 *
 * Expõe endpoints de execution (POST /projects/:id/execute, GET /executions, etc.)
 * via Engine OperacaoExecucaoClaude.
 *
 * ThrottlerModule: 30 req/min por projectId (hash SHA-256).
 * ScheduleModule.forFeature(): cron @Cron do ApprovalFlowSweeperService.
 *
 * @see ADR-V2-005 (OperacaoExecucaoClaude extends OperacaoPedido)
 * @see ADR-V2-006 (risk via idClasse -301/-302/-303)
 */
@Module({
  imports: [
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([{ ttl: 60000, limit: 30 }]),
    EntidadesModule,
  ],
  controllers: [ExecutionsController],
  providers: [
    PrismaService,
    ExecutionsService,
    ApprovalFlowService,
    ApprovalFlowSweeperService,
    ExecutionHistoryService,
    ClaudeRunnerService,
    ExecutionAccessGuard,
    ExecutionThrottlerGuard,
  ],
  exports: [ExecutionsService, ExecutionHistoryService, ClaudeRunnerService],
})
export class ExecutionsModule {}

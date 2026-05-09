import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../common/services/audit.service';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TasksIdentifierService } from './tasks-identifier.service';

/**
 * TasksModule — Domínio de tasks (DTask + V3 Intentions) V2.
 *
 * Controller: TasksController — CRUD + state machine V3 + identifier atômico
 *
 * Services:
 * - TasksService: CRUD principal + V3 Intentions + telemetria
 * - TasksIdentifierService: identifier atômico DEV-N via DTabela -475
 * - AuditService: audit log pós-commit (DEvento -497/-498)
 *
 * Exporta TasksService para uso em outros módulos (ex: ProjectsModule, FlowMetrics).
 */
@Module({
  controllers: [TasksController],
  providers: [
    PrismaService,
    AuditService,
    TasksService,
    TasksIdentifierService,
  ],
  exports: [TasksService],
})
export class TasksModule {}

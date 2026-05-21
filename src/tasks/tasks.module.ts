import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TasksIdentifierService } from './tasks-identifier.service';
import { PhaseHierarchyService } from './services/phase-hierarchy.service';

/**
 * TasksModule — Domínio de tasks (DTask + V3 Intentions) V2.
 *
 * Controller: TasksController — CRUD + state machine V3 + identifier atômico
 *
 * Services:
 * - TasksService: CRUD principal + V3 Intentions + telemetria
 *   (usa EventProducerService para emitir DEvento -497/-498 pós-commit)
 * - TasksIdentifierService: identifier atômico DEV-N via DTabela -475
 * - PhaseHierarchyService: validacao de ciclo + cascade soft-delete
 *   (ADR-V2-047 — Fases via DTask.idPai)
 *
 * Imports:
 * - `AuthModule` (forwardRef) — `AuthCompositeGuard` no controller (ADR-V2-042).
 * - `ProjectsModule` (forwardRef) — `ProjectsService.findAccessibleProjectIds`
 *   para resolver scope tenant + membership por request.
 *
 * NÃO importa CommonModule nem EventosModule explicitamente — ambos `@Global()`.
 * `ConfigModule` ja eh global no AppModule — `PhaseHierarchyService` injeta
 * `ConfigService` diretamente.
 *
 * Exporta TasksService para uso em outros módulos (ex: ProjectsModule, FlowMetrics).
 */
@Module({
  imports: [forwardRef(() => AuthModule), forwardRef(() => ProjectsModule)],
  controllers: [TasksController],
  providers: [TasksService, TasksIdentifierService, PhaseHierarchyService],
  exports: [TasksService],
})
export class TasksModule {}

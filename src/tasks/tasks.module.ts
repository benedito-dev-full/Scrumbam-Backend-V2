import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';
import { TasksController } from './tasks.controller';
import { TasksService } from './tasks.service';
import { TasksIdentifierService } from './tasks-identifier.service';
import { PhaseHierarchyService } from './services/phase-hierarchy.service';
import { PhaseTreeService } from './services/phase-tree.service';
import { PhaseMetricsService } from './services/phase-metrics.service';
import { PunctualityMetricsService } from './services/punctuality-metrics.service';
import { TaskTimerService } from './services/task-timer.service';

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
 * - PhaseTreeService: CTE recursiva real (Fase 5 — ADR-V2-047)
 * - PhaseMetricsService: % conclusão via CTE recursiva (Fase 5 — ADR-V2-047)
 * - TaskTimerService: timer manual de tempo por tarefa (ADR-V2-057) — Prisma
 *   direto em dados.telemetry.manualTimers; aritmética server-side anti-fraude.
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
  providers: [
    TasksService,
    TasksIdentifierService,
    PhaseHierarchyService,
    PhaseTreeService,
    PhaseMetricsService,
    PunctualityMetricsService,
    TaskTimerService,
  ],
  exports: [TasksService, PhaseTreeService],
})
export class TasksModule {}

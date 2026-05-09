import { forwardRef, Module } from '@nestjs/common';
import { WorkflowStatusesController } from './workflow-statuses.controller';
import { WorkflowStatusesService } from './workflow-statuses.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';

/**
 * WorkflowStatusesModule — wrapper thin sobre DTabela (ADR-V2-009).
 *
 * Expõe apenas:
 * - `POST /workflow-statuses/seed-defaults/:projectId` — cria 9 statuses V3 padrão
 *
 * CRUD de statuses → endpoint genérico /tabelas?idClasse=-440&dEntidadeId={projectId}
 *
 * Exporta WorkflowStatusesService para uso em outros módulos
 * (ex: ProjectsModule ao criar um projeto).
 *
 * @see WorkflowStatusesController — endpoint seed-defaults
 * @see WorkflowStatusesService — lógica de seedDefaults
 * @see README.md — documentação completa
 */
@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [WorkflowStatusesController],
  providers: [PrismaService, WorkflowStatusesService],
  exports: [WorkflowStatusesService],
})
export class WorkflowStatusesModule {}

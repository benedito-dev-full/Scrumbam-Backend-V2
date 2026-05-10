import { Module } from '@nestjs/common';
import { ProjectsController } from './projects.controller';
import { ProjectMembersController } from './project-members.controller';
import { ProjectsService } from './projects.service';
import { ProjectActivityService } from './project-activity.service';
import { ProjectMembersService } from './project-members.service';
import { SeedBootstrapService } from './seed-bootstrap.service';
import { UserProjectService } from './user-project.service';

/**
 * ProjectsModule — Domínio de projetos (DProject) V2.
 *
 * Exporta ProjectsService para uso em outros módulos (ex: TasksModule
 * pode verificar membership em project).
 *
 * Controllers:
 * - ProjectsController: CRUD + activity + stats
 * - ProjectMembersController: gestão de membros DVincula -171/-172/-173
 *
 * Services:
 * - ProjectsService: CRUD principal (usa EventProducerService p/ audit)
 * - ProjectActivityService: timeline de eventos
 * - ProjectMembersService: gestão de membros
 * - SeedBootstrapService: seed de statuses V3 + sprint default
 *
 * NÃO importa CommonModule nem EventosModule explicitamente — ambos `@Global()`.
 */
@Module({
  controllers: [ProjectsController, ProjectMembersController],
  providers: [
    ProjectsService,
    ProjectActivityService,
    ProjectMembersService,
    SeedBootstrapService,
    UserProjectService,
  ],
  exports: [ProjectsService, ProjectMembersService, UserProjectService],
})
export class ProjectsModule {}

import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
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
 * Importa `AuthModule` (via forwardRef p/ evitar circular dep) para usar
 * `AuthCompositeGuard` no controller — ADR-V2-042 defesa em profundidade
 * de tenant isolation.
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
  imports: [forwardRef(() => AuthModule)],
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

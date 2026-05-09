import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuditService } from '../common/services/audit.service';
import { ProjectsController } from './projects.controller';
import { ProjectMembersController } from './project-members.controller';
import { ProjectsService } from './projects.service';
import { ProjectActivityService } from './project-activity.service';
import { ProjectMembersService } from './project-members.service';
import { SeedBootstrapService } from './seed-bootstrap.service';

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
 * - ProjectsService: CRUD principal
 * - ProjectActivityService: timeline de eventos
 * - ProjectMembersService: gestão de membros
 * - SeedBootstrapService: seed de statuses V3 + sprint default
 * - AuditService: audit log pós-commit
 */
@Module({
  controllers: [ProjectsController, ProjectMembersController],
  providers: [
    PrismaService,
    AuditService,
    ProjectsService,
    ProjectActivityService,
    ProjectMembersService,
    SeedBootstrapService,
  ],
  exports: [ProjectsService, ProjectMembersService],
})
export class ProjectsModule {}

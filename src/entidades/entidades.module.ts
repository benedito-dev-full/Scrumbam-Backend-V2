import { forwardRef, Module } from '@nestjs/common';
import { EntidadeController } from './entidades.controller';
import { EntidadeService } from './entidades.service';
import { FoldersService } from './folders.service';
import { AuthModule } from '../auth/auth.module';
import { TimezoneService } from '../common/services/timezone.service';

/**
 * Módulo canônico para DEntidade (Pilar 2 — Endpoints Genéricos).
 *
 * Importa AuthModule (forwardRef para evitar circular dependency) para
 * que EntidadeController possa usar AuthCompositeGuard, OrgTenantGuard (F3)
 * e que FoldersService consuma RoleResolverService (exportado por AuthModule).
 *
 * Exporta EntidadeService + FoldersService para uso em outros módulos
 * (ex: ProjectsModule consome FoldersService para resolver `folderId`
 * em batch nas listagens — ADR-V2-FOLDERS-001).
 *
 * @see EntidadeController — endpoints REST genéricos
 * @see EntidadeService — lógica de negócio + Pilar 2
 * @see FoldersService — folders MVP (ADR-V2-FOLDERS-001)
 */
@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [EntidadeController],
  providers: [EntidadeService, FoldersService, TimezoneService],
  exports: [EntidadeService, FoldersService],
})
export class EntidadesModule {}

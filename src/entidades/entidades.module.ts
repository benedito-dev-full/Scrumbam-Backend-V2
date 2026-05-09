import { forwardRef, Module } from '@nestjs/common';
import { EntidadeController } from './entidades.controller';
import { EntidadeService } from './entidades.service';
import { AuthModule } from '../auth/auth.module';
import { TimezoneService } from '../common/services/timezone.service';

/**
 * Módulo canônico para DEntidade (Pilar 2 — Endpoints Genéricos).
 *
 * Importa AuthModule (forwardRef para evitar circular dependency) para
 * que EntidadeController possa usar AuthCompositeGuard e OrgTenantGuard (F3).
 *
 * Exporta EntidadeService para uso em outros módulos (ex: AuthModule).
 *
 * @see EntidadeController — endpoints REST genéricos
 * @see EntidadeService — lógica de negócio + Pilar 2
 */
@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [EntidadeController],
  providers: [EntidadeService, TimezoneService],
  exports: [EntidadeService],
})
export class EntidadesModule {}

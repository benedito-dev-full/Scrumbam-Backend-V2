import { forwardRef, Module } from '@nestjs/common';
import { OrganizationsController } from './organizations.controller';
import { OrganizationsService } from './organizations.service';
import { AuthModule } from '../auth/auth.module';

/**
 * Módulo de organizações (DEntidade idClasse=-152).
 *
 * Provê OrganizationsService para:
 * - CRUD de organizações (DEntidade -152)
 * - Gestão de membros via DVincula (-161/-162/-163)
 * - Usado pelo AuthModule no register() para criar org completa
 *
 * Importa AuthModule (forwardRef para evitar circular dependency).
 * NÃO importa CommonModule nem EventosModule explicitamente — ambos são
 * `@Global()` (PrismaService, CorrelationIdService, EventProducerService
 * disponíveis via DI).
 *
 * @see OrganizationsController — endpoints REST
 * @see OrganizationsService — lógica de negócio
 * @see AuthModule — importa este módulo para usar no register()
 */
@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [OrganizationsController],
  providers: [OrganizationsService],
  exports: [OrganizationsService],
})
export class OrganizationsModule {}

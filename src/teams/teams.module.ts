import { forwardRef, Module } from '@nestjs/common';
import { TeamsController } from './teams.controller';
import { TeamsService } from './teams.service';
import { AuthModule } from '../auth/auth.module';
import { PrismaService } from '../prisma.service';

/**
 * Módulo de times (DEntidade idClasse=-180).
 *
 * Provê TeamsService para:
 * - CRUD de times (DEntidade -180)
 * - Gestão de memberships via DVincula (-181)
 * - Issue Counter via DTabela (-475)
 *
 * TeamsController expõe rotas tanto sob /organizations/:orgId/teams
 * quanto sob /teams/:id (via prefixos múltiplos no controller).
 *
 * @see TeamsController — endpoints REST
 * @see TeamsService — lógica de negócio
 */
@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [TeamsController],
  providers: [PrismaService, TeamsService],
  exports: [TeamsService],
})
export class TeamsModule {}

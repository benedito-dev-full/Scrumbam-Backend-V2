import { Module } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { AuthModule } from '../auth/auth.module';
import { PermissoesController } from './permissoes.controller';
import { PermissoesService } from './permissoes.service';

/**
 * Módulo de permissões granulares (DPermissao).
 *
 * Importa AuthModule para acesso a AuthCompositeGuard e RolesGuard.
 */
@Module({
  imports: [AuthModule],
  controllers: [PermissoesController],
  providers: [PermissoesService, PrismaService],
  exports: [PermissoesService],
})
export class PermissoesModule {}

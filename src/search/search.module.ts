import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { SearchController } from './search.controller';
import { SearchService } from './search.service';

/**
 * SearchModule — busca cross-entity do Scrumban-Backend-V2 (F8 Bloco U).
 *
 * Registra SearchController e SearchService.
 * Importa AuthModule para acesso aos guards (JwtAuthGuard, OrgTenantGuard).
 * CommonModule é @Global() — PrismaService disponível automaticamente.
 *
 * F8 Bloco U — read-only puro:
 * - ZERO Engine/Operacao
 * - ZERO INSERT/UPDATE/DELETE
 * - ZERO migration, ZERO seed, ZERO DClasse nova
 * - 3 queries Prisma paralelas (Promise.all): DTask + DProject + DEntidade USER
 *
 * Endpoint exposto: GET /search
 * Guards: JwtAuthGuard + OrgTenantGuard
 * Tenant isolation: organizationId sempre do JWT (nunca query param)
 */
@Module({
  imports: [AuthModule],
  controllers: [SearchController],
  providers: [SearchService],
  exports: [SearchService],
})
export class SearchModule {}

import { Module, forwardRef } from '@nestjs/common';

import { AuthModule } from '../auth/auth.module';
import { BookmarksController } from './bookmarks.controller';
import { BookmarksService } from './bookmarks.service';

/**
 * Modulo de bookmarks/favoritos (ADR-V2-051, DClasse -187 BOOKMARK).
 *
 * Expoe 3 endpoints REST:
 *  - GET  /bookmarks         — lista do usuario logado (cursor pagination)
 *  - POST /bookmarks         — cria ou reativa bookmark
 *  - DELETE /bookmarks/:id   — soft-delete com ownership check
 *
 * Pilar 1 NAO aplica (cadastro estrutural, sem DPedido).
 * Pilar 3 PRESERVADO: DClasse -187 ja seedada, sem alteracao de seed.
 *
 * `CommonModule` e global — `PrismaService` disponivel sem import explicito.
 * `AuthModule` importado via forwardRef — resolve McpKeyGuard no AuthCompositeGuard.
 */
@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [BookmarksController],
  providers: [BookmarksService],
  exports: [BookmarksService],
})
export class BookmarksModule {}

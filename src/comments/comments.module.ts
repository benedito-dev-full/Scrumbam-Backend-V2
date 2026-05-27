import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';
import { CommentsController } from './comments.controller';
import { CommentsService } from './comments.service';
import { CommentTargetResolver } from './comment-target.resolver';

/**
 * CommentsModule — comentários polimórficos sobre DEvento (idClasse=-507).
 *
 * **Polimorfismo:** uma única estrutura serve task, project, folder, list
 * (e DOC futuro). `CommentTargetResolver` encapsula a diferença entre
 * tipos — adicionar um novo `targetType` é (a) adicionar entrada no
 * enum, (b) acrescentar branch no resolver. Nada mais muda.
 *
 * **Storage:** `DEvento` é tabela ESTRUTURAL de audit trail polimórfico —
 * persistência via Prisma direto (Pilar 1 não se aplica; Engine é
 * exclusivo de DPedido/DTitulo/DMov*).
 *
 * **Dependências:**
 * - `AuthModule` (via forwardRef): `AuthCompositeGuard` (ADR-V2-042).
 * - `ProjectsModule` (via forwardRef): `ProjectsService.findAccessibleProjectIds`
 *   (resolver de acesso a TASK).
 * - `EventosModule`, `CommonModule`: `@Global()`, não precisam import.
 *
 * **Naming débito aceito (sprint 2026-05-27):** DClasse -507 mantém o nome
 * histórico `TASK_COMMENT` apesar do uso polimórfico — débito consciente
 * para evitar retrabalho no seed F1 já aprovado (8.5/10). Ver `README.md`.
 *
 * @see CommentsService — orquestração.
 * @see CommentTargetResolver — regras por targetType.
 * @see README.md — débito de naming e como adicionar novo targetType.
 */
@Module({
  imports: [forwardRef(() => AuthModule), forwardRef(() => ProjectsModule)],
  controllers: [CommentsController],
  providers: [CommentsService, CommentTargetResolver],
  exports: [CommentsService],
})
export class CommentsModule {}

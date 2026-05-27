import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  ParseEnumPipe,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthCompositeGuard } from '../auth/guards/auth-composite.guard';
import { CommentsService } from './comments.service';
import { CommentTargetType } from './dto/comment-target-type.enum';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CommentResponseDto } from './dto/comment-response.dto';
import { ListCommentsQueryDto } from './dto/list-comments-query.dto';
import { ListCommentsResponseDto } from './dto/list-comments-response.dto';

/**
 * Shape do `req.user` injetado pelo `AuthCompositeGuard` (JWT + ApiKey + MCP).
 *
 * Padrão local (não compartilhado) — replicado de `TasksController` e
 * `ProjectsController` para evitar acoplamento entre controllers.
 */
interface JwtRequest {
  user: { entidadeId: string; organizationId?: string };
}

/**
 * Controller polimórfico de comentários.
 *
 * Aceita comentários em `task`, `project`, `folder` e `list` (DOC fica
 * pronto para entrar na próxima sprint — basta liberar o enum e adicionar
 * estratégia no resolver).
 *
 * Rotas:
 * - `POST /comments/:targetType/:targetId` — criar comentário.
 * - `GET /comments/:targetType/:targetId` — listar comentários (DESC, cursor).
 *
 * Autenticação: `AuthCompositeGuard` (JWT/ApiKey/MCP — ADR-V2-042).
 * Tenant isolation: defesa em profundidade — controller passa `organizationId`
 * do request para o service, que delega ao resolver.
 *
 * @see CommentsService — lógica de persistência e listagem.
 * @see CommentTargetResolver — regras de existência + autorização por tipo.
 */
@ApiTags('comments')
@ApiBearerAuth()
@UseGuards(AuthCompositeGuard)
@Controller('comments/:targetType/:targetId')
export class CommentsController {
  private readonly logger = new Logger(CommentsController.name);

  constructor(private readonly commentsService: CommentsService) {}

  /**
   * Cria um comentário no alvo informado.
   *
   * `ParseEnumPipe` rejeita valores fora do enum `CommentTargetType` com
   * HTTP 400 antes mesmo de chegar ao service.
   *
   * @param targetType - Tipo do alvo (task / project / folder / list).
   * @param targetId - Chave string do alvo.
   * @param dto - Conteúdo do comentário.
   * @param req - Request com `user.entidadeId` e `user.organizationId`.
   * @returns Comentário criado.
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/comments/task/777 \
   *   -H "Authorization: Bearer ..." \
   *   -H "Content-Type: application/json" \
   *   -d '{"texto":"LGTM!"}'
   * ```
   */
  @Post()
  @ApiOperation({
    summary: 'Adicionar comentário a um alvo (task/project/folder/list)',
    description:
      'Cria DEvento idClasse=-507 polimórfico. Emite task.comment.created após persistência.',
  })
  @ApiParam({
    name: 'targetType',
    enum: CommentTargetType,
    description: 'Tipo do alvo do comentário',
  })
  @ApiParam({
    name: 'targetId',
    description: 'ID do alvo (DTask.chave ou DProject.chave)',
    example: '777',
  })
  @ApiResponse({ status: 201, description: 'Comentário criado', type: CommentResponseDto })
  @ApiResponse({ status: 400, description: 'targetType inválido ou texto vazio/longo demais' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Sem acesso ao alvo' })
  @ApiResponse({ status: 404, description: 'Alvo não encontrado' })
  async create(
    @Param('targetType', new ParseEnumPipe(CommentTargetType))
    targetType: CommentTargetType,
    @Param('targetId') targetId: string,
    @Body() dto: CreateCommentDto,
    @Request() req: JwtRequest,
  ): Promise<CommentResponseDto> {
    this.logger.log(`POST /comments/${targetType}/${targetId} — user=${req.user.entidadeId}`);
    return this.commentsService.create(
      targetType,
      targetId,
      dto,
      BigInt(req.user.entidadeId),
      req.user.organizationId,
    );
  }

  /**
   * Lista comentários do alvo (cursor pagination DESC).
   *
   * @param targetType - Tipo do alvo.
   * @param targetId - Chave string do alvo.
   * @param query - Cursor + limit.
   * @param req - Request com `user.entidadeId` e `user.organizationId`.
   * @returns Página com `items` e `nextCursor`.
   *
   * @example
   * ```bash
   * curl http://localhost:3000/comments/task/777?limit=20 \
   *   -H "Authorization: Bearer ..."
   * ```
   */
  @Get()
  @ApiOperation({
    summary: 'Listar comentários de um alvo (cursor pagination DESC)',
    description:
      'Retorna comentários ordenados do mais recente ao mais antigo. nextCursor para próxima página.',
  })
  @ApiParam({ name: 'targetType', enum: CommentTargetType })
  @ApiParam({ name: 'targetId', description: 'ID do alvo', example: '777' })
  @ApiResponse({ status: 200, description: 'Lista de comentários', type: ListCommentsResponseDto })
  @ApiResponse({ status: 400, description: 'targetType inválido' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Sem acesso ao alvo' })
  @ApiResponse({ status: 404, description: 'Alvo não encontrado' })
  async findMany(
    @Param('targetType', new ParseEnumPipe(CommentTargetType))
    targetType: CommentTargetType,
    @Param('targetId') targetId: string,
    @Query() query: ListCommentsQueryDto,
    @Request() req: JwtRequest,
  ): Promise<ListCommentsResponseDto> {
    this.logger.log(
      `GET /comments/${targetType}/${targetId} — user=${req.user.entidadeId} cursor=${query.cursor ?? '-'}`,
    );
    return this.commentsService.findMany(
      targetType,
      targetId,
      query,
      BigInt(req.user.entidadeId),
      req.user.organizationId,
    );
  }
}

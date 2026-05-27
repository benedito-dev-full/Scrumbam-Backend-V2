import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { CorrelationIdService } from '../common/services/correlation-id.service';
import { EventProducerService } from '../eventos/core/event-producer.service';
import { EVENT_TYPES } from '../eventos/core/event-types';
import { CommentTargetResolver } from './comment-target.resolver';
import { CommentTargetType } from './dto/comment-target-type.enum';
import { CreateCommentDto } from './dto/create-comment.dto';
import { CommentResponseDto } from './dto/comment-response.dto';
import { ListCommentsQueryDto } from './dto/list-comments-query.dto';
import { ListCommentsResponseDto } from './dto/list-comments-response.dto';

/** DClasse polimórfica do comentário no audit trail (seed F1). */
const ID_CLASSE_COMMENT = BigInt(-507);

/** Default e máximo de itens por página (defesa contra payload abusivo). */
const DEFAULT_LIMIT = 20;

/**
 * Tipo da linha de DEvento incluindo o autor (DEntidade) — usado pelos
 * mappers internos para garantir zero N+1 na listagem.
 */
type EventoComAutor = {
  chave: bigint;
  identificadorExterno: string | null;
  descricao: string | null;
  metaDados: Prisma.JsonValue | null;
  criadoEm: Date;
  idEntidade: bigint | null;
  entidade: { chave: bigint; nome: string | null } | null;
};

/**
 * Service de comentários polimórficos sobre `DEvento` (idClasse=-507).
 *
 * Cobre todos os `CommentTargetType` numa única implementação — task,
 * project, folder, list (e DOC quando habilitado). A regra de acesso por
 * tipo é delegada ao `CommentTargetResolver`.
 *
 * Persistência usa Prisma direto: `DEvento` é tabela ESTRUTURAL de audit
 * trail, não transacional (Pilar 1 não se aplica — Engine é só para
 * DPedido/DTitulo/DMov*). ADR-V2-001 respeitado: zero alteração de schema.
 *
 * Eventos `task.comment.created` são emitidos APÓS persistência via
 * `EventProducerService.addInternalEvent` (Pilar 7 do backend-patterns).
 *
 * @see CommentTargetResolver — autorização por targetType.
 * @see EVENT_TYPES.TASK_COMMENT_CREATED — tipo de evento já registrado na F1.
 */
@Injectable()
export class CommentsService {
  private readonly logger = new Logger(CommentsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly targetResolver: CommentTargetResolver,
    private readonly eventProducer: EventProducerService,
    private readonly correlationId: CorrelationIdService,
  ) {}

  /**
   * Cria um novo comentário no alvo informado.
   *
   * Fluxo:
   *  1. `CommentTargetResolver.resolveAndAuthorize` confirma alvo + acesso.
   *  2. Persiste `DEvento` (idClasse=-507) com join eager no autor.
   *  3. Após sucesso, emite `task.comment.created` (assinatura
   *     polimórfica — `targetType` no payload diferencia o tipo).
   *
   * Evento é emitido APÓS persistência — se o `dEvento.create` falhar,
   * nenhum evento órfão é gerado.
   *
   * @param targetType - Tipo do alvo (task / project / folder / list).
   * @param targetId - Chave string do alvo.
   * @param dto - Conteúdo do comentário.
   * @param requesterEntidadeId - `DEntidade.chave` do autor.
   * @param organizationId - Org ativa (opcional, para tenant isolation).
   * @returns Comentário criado, com nome do autor já resolvido.
   *
   * @throws {NotFoundException} Alvo não existe ou está em outra org.
   * @throws {ForbiddenException} Sem acesso ao alvo.
   * @throws {BadRequestException} targetType inválido.
   *
   * @example
   * ```typescript
   * const comment = await service.create(
   *   CommentTargetType.TASK,
   *   '777',
   *   { texto: 'LGTM!' },
   *   BigInt(42),
   *   '50'
   * );
   * ```
   */
  async create(
    targetType: CommentTargetType,
    targetId: string,
    dto: CreateCommentDto,
    requesterEntidadeId: bigint,
    organizationId?: string,
  ): Promise<CommentResponseDto> {
    await this.targetResolver.resolveAndAuthorize(
      targetType,
      targetId,
      requesterEntidadeId,
      organizationId,
    );

    const metaDados: Prisma.InputJsonValue = {
      targetType,
      targetId,
      autorId: requesterEntidadeId.toString(),
    };

    const evento = await this.prisma.dEvento.create({
      data: {
        idClasse: ID_CLASSE_COMMENT,
        idEntidade: requesterEntidadeId,
        identificadorExterno: targetId,
        descricao: dto.texto,
        metaDados,
      },
      include: {
        entidade: { select: { chave: true, nome: true } },
      },
    });

    // Evento APÓS persistência (Pilar 7) — payload inclui targetType para
    // que consumidores (audit, webhooks, IA) possam filtrar/rotear por tipo.
    await this.eventProducer.addInternalEvent(
      EVENT_TYPES.TASK_COMMENT_CREATED,
      {
        commentId: evento.chave.toString(),
        targetType,
        targetId,
        autorId: requesterEntidadeId.toString(),
        metadata: {
          source: CommentsService.name,
          timestamp: new Date().toISOString(),
        },
      },
      this.correlationId.getOrGenerate(),
    );

    this.logger.log(
      `comment_created targetType=${targetType} targetId=${targetId} ` +
        `commentId=${evento.chave.toString()} autorId=${requesterEntidadeId.toString()}`,
    );

    return this.toResponseDto(evento, targetType);
  }

  /**
   * Lista comentários do alvo com cursor pagination DESC.
   *
   * Query única com `include: { entidade }` resolve o autor em JOIN —
   * zero N+1. `take: limit + 1` detecta se há próxima página sem query
   * extra de count.
   *
   * @param targetType - Tipo do alvo (task / project / folder / list).
   * @param targetId - Chave string do alvo.
   * @param query - Parâmetros de paginação (cursor + limit).
   * @param requesterEntidadeId - `DEntidade.chave` do requester (autorização).
   * @param organizationId - Org ativa (opcional).
   * @returns Página com `items` (DESC por id) e `nextCursor`.
   *
   * @throws {NotFoundException} Alvo não existe ou está em outra org.
   * @throws {ForbiddenException} Sem acesso ao alvo.
   *
   * @example
   * ```typescript
   * const page1 = await service.findMany(
   *   CommentTargetType.TASK, '777', {}, BigInt(42), '50'
   * );
   * const page2 = await service.findMany(
   *   CommentTargetType.TASK, '777',
   *   { cursor: page1.nextCursor!, limit: 50 },
   *   BigInt(42), '50'
   * );
   * ```
   */
  async findMany(
    targetType: CommentTargetType,
    targetId: string,
    query: ListCommentsQueryDto,
    requesterEntidadeId: bigint,
    organizationId?: string,
  ): Promise<ListCommentsResponseDto> {
    await this.targetResolver.resolveAndAuthorize(
      targetType,
      targetId,
      requesterEntidadeId,
      organizationId,
    );

    const limit = query.limit ?? DEFAULT_LIMIT;

    // Cursor: chave < cursor (DESC). `BigInt(cursor)` lança se cursor
    // for malformado — capturado e tratado como "sem cursor" (defesa).
    let cursorClause: Prisma.DEventoWhereInput['chave'] | undefined;
    if (query.cursor) {
      try {
        cursorClause = { lt: BigInt(query.cursor) };
      } catch {
        // Cursor inválido = ignora (volta à primeira página).
        cursorClause = undefined;
      }
    }

    const eventos = await this.prisma.dEvento.findMany({
      where: {
        idClasse: ID_CLASSE_COMMENT,
        identificadorExterno: targetId,
        excluido: false,
        ...(cursorClause ? { chave: cursorClause } : {}),
      },
      include: {
        entidade: { select: { chave: true, nome: true } },
      },
      take: limit + 1,
      orderBy: { chave: 'desc' },
    });

    const hasMore = eventos.length > limit;
    const page = hasMore ? eventos.slice(0, limit) : eventos;
    const nextCursor = hasMore ? page[page.length - 1].chave.toString() : null;

    return {
      items: page.map((e) => this.toResponseDto(e, targetType)),
      nextCursor,
    };
  }

  /**
   * Mapeia `DEvento` + join autor → `CommentResponseDto`.
   *
   * `targetType` recebido como argumento (não extraído de `metaDados`)
   * porque ele já vem validado pelo controller via path param —
   * confiamos mais no path que no JSON persistido.
   */
  private toResponseDto(evento: EventoComAutor, targetType: CommentTargetType): CommentResponseDto {
    return {
      id: evento.chave.toString(),
      texto: evento.descricao ?? '',
      targetType,
      targetId: evento.identificadorExterno ?? '',
      autorId: evento.idEntidade?.toString() ?? '',
      autorNome: evento.entidade?.nome ?? '',
      createdAt: evento.criadoEm.toISOString(),
    };
  }
}

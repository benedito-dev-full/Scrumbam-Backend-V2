import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { ChatHistoryMessageDto, ChatHistoryResponseDto } from './dto/chat-history-response.dto';

/** DClasse da mensagem de chat IA no audit/storage trail (seed Frente B). */
const ID_CLASSE_AI_CHAT_MESSAGE = BigInt(-508);

/** Default/limit superior de itens por pagina (defesa contra payload abusivo). */
const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 100;

/**
 * Forma de uma mensagem persistida (raw da DEvento) — interna ao service.
 *
 * Usada pelo `AiChatService` para hidratar historico antes de chamar o provider
 * e pelo mapper publico que produz o DTO. NAO inclui join — `DEvento -508` nao
 * referencia outras entidades alem do user (idEntidade), e o nome do user nao
 * eh necessario nesta v1 (frontend ja sabe quem eh o "eu").
 */
export interface PersistedChatMessage {
  id: bigint;
  role: 'user' | 'assistant';
  content: string;
  createdAt: Date;
  model?: string;
  toolCallsCount?: number;
}

/**
 * Service de mensagens do chat IA Nexus.
 *
 * Espelha o padrao do `CommentsService`: persistencia direta em `DEvento`
 * (Pilar 1 NAO se aplica — DEvento eh audit/structural; Engine eh exclusivo
 * de DPedido/DTitulo/DMov*).
 *
 * Convencao v1 (conversa unica por user):
 *  - `idClasse` = `-508` (AI_CHAT_MESSAGE — seed Frente B).
 *  - `idEntidade` = `userEntidadeId` (DEntidade.chave do dono da conversa).
 *  - `identificadorExterno` = `userEntidadeId.toString()` (NA v1 sempre — na
 *    v2 multi-conversa virara UUID por conversa SEM mudanca de schema).
 *  - `descricao` = conteudo textual da mensagem.
 *  - `metaDados` = `{ role, model?, tokens?, toolCalls?, timestamp }`.
 *
 * Performance:
 *  - INSERT: 1 query (sem joins).
 *  - findHistory: 1 query — usa o indice composto `(idClasse, identificadorExterno)`
 *    aplicado em produção em B.0 (DEBT-COMMENTS-01 — mesmo plano canonico).
 *
 * @see CommentsService — padrao de DEvento polimorfico (mesmo modelo).
 * @see AiChatService — consumidor principal.
 */
@Injectable()
export class ChatMessagesService {
  private readonly logger = new Logger(ChatMessagesService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persiste uma mensagem (user ou assistant) na conversa do usuario.
   *
   * Ordem de chamada (padrao do `AiChatService.sendMessage`):
   *  1. `append(role='user', content=<input>)` — ANTES de chamar Gemini.
   *  2. (chamada Gemini)
   *  3. `append(role='assistant', content=<output>, metadata={...})` — APOS sucesso.
   *
   * Se Gemini falhar, a mensagem do user ja esta persistida — refresh
   * hidrata o historico corretamente (R-7 do plano canonico).
   *
   * @param opts.userEntidadeId - `DEntidade.chave` do dono da conversa.
   * @param opts.role - 'user' ou 'assistant'.
   * @param opts.content - Texto da mensagem.
   * @param opts.metadata - Metadados extras (model, tokens, toolCalls).
   * @returns Mensagem persistida com `id` resolvido.
   */
  async append(opts: {
    userEntidadeId: bigint;
    role: 'user' | 'assistant';
    content: string;
    metadata?: Record<string, unknown>;
  }): Promise<PersistedChatMessage> {
    const conversationId = opts.userEntidadeId.toString();

    const metaDados: Prisma.InputJsonValue = {
      role: opts.role,
      timestamp: new Date().toISOString(),
      ...(opts.metadata ?? {}),
    };

    const evento = await this.prisma.dEvento.create({
      data: {
        idClasse: ID_CLASSE_AI_CHAT_MESSAGE,
        idEntidade: opts.userEntidadeId,
        identificadorExterno: conversationId,
        descricao: opts.content,
        metaDados,
      },
      select: {
        chave: true,
        descricao: true,
        criadoEm: true,
        metaDados: true,
      },
    });

    this.logger.debug(
      `ai_chat_message_persisted role=${opts.role} userId=${conversationId} ` +
        `messageId=${evento.chave.toString()} len=${opts.content.length}`,
    );

    return this.toPersisted(
      evento.chave,
      opts.role,
      evento.descricao ?? '',
      evento.criadoEm,
      evento.metaDados,
    );
  }

  /**
   * Lista mensagens da conversa do user em ordem CRONOLOGICA (ASC).
   *
   * Estrategia: query DESC com `take=limit+1` para detectar paginacao,
   * depois reverse no mapper para devolver ASC (mais antiga primeiro).
   *
   * Cursor (`cursor`) representa "carregar mensagens MAIS ANTIGAS que esta
   * chave" — usado pelo frontend para lazy-load do scroll para cima.
   *
   * @param userEntidadeId - Dono da conversa.
   * @param opts.limit - Itens por pagina (default 50, max 100).
   * @param opts.cursor - chave (BigInt como string) — paginar para historico anterior.
   */
  async findHistory(
    userEntidadeId: bigint,
    opts: { limit?: number; cursor?: string } = {},
  ): Promise<ChatHistoryResponseDto> {
    const conversationId = userEntidadeId.toString();
    const limit = Math.min(Math.max(opts.limit ?? DEFAULT_LIMIT, 1), MAX_LIMIT);

    let cursorClause: Prisma.DEventoWhereInput['chave'] | undefined;
    if (opts.cursor) {
      try {
        cursorClause = { lt: BigInt(opts.cursor) };
      } catch {
        // Cursor invalido = ignora (primeira pagina), nao quebra.
        cursorClause = undefined;
      }
    }

    const rows = await this.prisma.dEvento.findMany({
      where: {
        idClasse: ID_CLASSE_AI_CHAT_MESSAGE,
        identificadorExterno: conversationId,
        excluido: false,
        ...(cursorClause ? { chave: cursorClause } : {}),
      },
      select: {
        chave: true,
        descricao: true,
        criadoEm: true,
        metaDados: true,
      },
      take: limit + 1,
      orderBy: { chave: 'desc' },
    });

    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const nextCursor = hasMore ? page[page.length - 1].chave.toString() : null;

    // Reverse para devolver ASC (cronologico — mais antiga primeiro).
    const itemsAsc = [...page].reverse();
    const items: ChatHistoryMessageDto[] = itemsAsc.map((r) =>
      this.toResponseDto(r.chave, r.descricao ?? '', r.criadoEm, r.metaDados),
    );

    return { items, nextCursor };
  }

  /**
   * Hidrata historico cru (com role) para uso interno do `AiChatService` —
   * monta o payload do provider. NAO devolve DTO publico.
   *
   * @param limit - Janela conservadora (default 30 no `AiChatService`).
   */
  async findHistoryForProvider(
    userEntidadeId: bigint,
    limit: number,
  ): Promise<PersistedChatMessage[]> {
    const conversationId = userEntidadeId.toString();

    const rows = await this.prisma.dEvento.findMany({
      where: {
        idClasse: ID_CLASSE_AI_CHAT_MESSAGE,
        identificadorExterno: conversationId,
        excluido: false,
      },
      select: {
        chave: true,
        descricao: true,
        criadoEm: true,
        metaDados: true,
      },
      take: limit,
      orderBy: { chave: 'desc' },
    });

    // Reverse para ASC (cronologico) — o provider espera historico em ordem.
    return [...rows].reverse().map((r) => {
      const meta = (r.metaDados ?? {}) as Record<string, unknown>;
      const role = meta.role === 'assistant' ? 'assistant' : 'user';
      return this.toPersisted(r.chave, role, r.descricao ?? '', r.criadoEm, r.metaDados);
    });
  }

  /**
   * Marca toda a conversa do user como deletada (soft-delete em DEvento).
   *
   * v1 = "nova conversa" — limpa o historico mas mantem trilha de audit
   * (excluido=true em vez de DELETE). v2 com multi-conversa este metodo
   * vai aceitar `conversationId` explicito.
   *
   * @returns Quantidade de mensagens marcadas como excluidas.
   */
  async clearHistory(userEntidadeId: bigint): Promise<number> {
    const conversationId = userEntidadeId.toString();
    const result = await this.prisma.dEvento.updateMany({
      where: {
        idClasse: ID_CLASSE_AI_CHAT_MESSAGE,
        identificadorExterno: conversationId,
        excluido: false,
      },
      data: { excluido: true },
    });
    this.logger.log(`ai_chat_history_cleared userId=${conversationId} count=${result.count}`);
    return result.count;
  }

  // -------------------------------------------------------------------------
  // Mappers
  // -------------------------------------------------------------------------

  private toPersisted(
    id: bigint,
    role: 'user' | 'assistant',
    content: string,
    createdAt: Date,
    rawMeta: Prisma.JsonValue | null,
  ): PersistedChatMessage {
    const meta = (rawMeta ?? {}) as Record<string, unknown>;
    return {
      id,
      role,
      content,
      createdAt,
      model: typeof meta.model === 'string' ? meta.model : undefined,
      toolCallsCount: typeof meta.toolCallsCount === 'number' ? meta.toolCallsCount : undefined,
    };
  }

  private toResponseDto(
    id: bigint,
    content: string,
    createdAt: Date,
    rawMeta: Prisma.JsonValue | null,
  ): ChatHistoryMessageDto {
    const meta = (rawMeta ?? {}) as Record<string, unknown>;
    const role = meta.role === 'assistant' ? 'assistant' : 'user';
    return {
      id: id.toString(),
      role,
      content,
      createdAt: createdAt.toISOString(),
      ...(typeof meta.model === 'string' ? { model: meta.model } : {}),
      ...(typeof meta.toolCallsCount === 'number' ? { toolCallsCount: meta.toolCallsCount } : {}),
    };
  }
}

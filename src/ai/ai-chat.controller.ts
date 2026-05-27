import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthCompositeGuard } from '../auth/guards/auth-composite.guard';
import { AiChatService } from './ai-chat.service';
import { ChatMessagesService } from './chat-messages.service';
import { ChatHistoryResponseDto } from './dto/chat-history-response.dto';
import { ChatMessageResponseDto } from './dto/chat-message-response.dto';
import { SendMessageDto } from './dto/send-message.dto';

/**
 * Shape do `req.user` injetado pelo `AuthCompositeGuard`.
 *
 * Mesmo padrao local replicado em `CommentsController`/`TasksController` —
 * evita acoplamento entre controllers.
 */
interface JwtRequest {
  user: { entidadeId: string; organizationId?: string };
}

/**
 * Controller do chat IA Nexus (Frente B — v1).
 *
 * Rotas:
 *  - `POST   /ai/chat`         — envia mensagem, retorna resposta do assistant.
 *  - `GET    /ai/chat/history` — lista historico (cronologico, cursor pagination).
 *  - `DELETE /ai/chat/history` — limpa conversa atual (soft-delete em DEvento -508).
 *
 * Autenticacao: `AuthCompositeGuard` (JWT/ApiKey/MCP — ADR-V2-042). Embora
 * conversa seja por user, aceitamos qualquer mecanismo — quem se autenticar
 * via API/MCP key tera sua propria "conversa unica" amarrada ao
 * `entidadeId` resolvido pelo guard.
 *
 * Resposta: JSON puro (NAO SSE — decisao 5 do plano canonico). Streaming
 * fica para v2.
 *
 * @see AiChatService — orquestracao do fluxo (persist + provider + audit).
 * @see ChatMessagesService — CRUD em DEvento -508.
 */
@ApiTags('ai-chat')
@ApiBearerAuth()
@UseGuards(AuthCompositeGuard)
@Controller('ai/chat')
export class AiChatController {
  private readonly logger = new Logger(AiChatController.name);

  constructor(
    private readonly aiChat: AiChatService,
    private readonly chatMessages: ChatMessagesService,
  ) {}

  /**
   * Envia uma mensagem ao Nexus e recebe a resposta completa.
   *
   * Fluxo (server-side):
   *  1. Persiste mensagem do user.
   *  2. Carrega historico (30 msgs).
   *  3. Chama Gemini com tools.
   *  4. Persiste resposta do assistant.
   *  5. Emite eventos de audit.
   *  6. Retorna DTO.
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/ai/chat \
   *   -H "Authorization: Bearer ..." \
   *   -H "Content-Type: application/json" \
   *   -d '{"content":"Quantas tasks abertas tem no projeto 1?"}'
   * ```
   */
  @Post()
  @ApiOperation({
    summary: 'Envia mensagem ao Nexus IA (resposta completa, nao streaming)',
    description:
      'Persiste DEvento -508 user, chama Gemini com 4 tools, persiste DEvento -508 assistant, emite ai.chat.message.created.',
  })
  @ApiResponse({ status: 200, description: 'Resposta do assistant', type: ChatMessageResponseDto })
  @ApiResponse({ status: 400, description: 'content vazio ou > 50000 chars' })
  @ApiResponse({ status: 401, description: 'Nao autenticado' })
  @ApiResponse({ status: 502, description: 'Falha do provider IA (401/erro generico)' })
  @ApiResponse({ status: 503, description: 'Limite de uso do provider IA atingido (429)' })
  @ApiResponse({ status: 504, description: 'Timeout do provider IA (>30s)' })
  async sendMessage(
    @Body() dto: SendMessageDto,
    @Request() req: JwtRequest,
  ): Promise<ChatMessageResponseDto> {
    this.logger.log(`POST /ai/chat — user=${req.user.entidadeId}`);
    return this.aiChat.sendMessage(dto, BigInt(req.user.entidadeId), req.user.organizationId);
  }

  /**
   * Retorna o historico do user (conversa unica v1) em ordem cronologica.
   *
   * Cursor pagination: passar `cursor` (chave da DEvento como string) para
   * carregar mensagens MAIS ANTIGAS que o cursor (lazy-load do scroll para cima).
   *
   * @example
   * ```bash
   * curl http://localhost:3000/ai/chat/history?limit=50 \
   *   -H "Authorization: Bearer ..."
   * ```
   */
  @Get('history')
  @ApiOperation({
    summary: 'Lista historico do chat (conversa unica do user logado)',
    description:
      'Retorna mensagens em ordem cronologica (mais antiga primeiro). Cursor para lazy-load.',
  })
  @ApiQuery({ name: 'limit', required: false, description: '1-100 (default 50)' })
  @ApiQuery({ name: 'cursor', required: false, description: 'Chave da DEvento (paginacao)' })
  @ApiResponse({ status: 200, description: 'Historico', type: ChatHistoryResponseDto })
  @ApiResponse({ status: 401, description: 'Nao autenticado' })
  async getHistory(
    @Query('limit') limit: string | undefined,
    @Query('cursor') cursor: string | undefined,
    @Request() req: JwtRequest,
  ): Promise<ChatHistoryResponseDto> {
    const parsedLimit = limit !== undefined ? parseInt(limit, 10) : undefined;
    return this.chatMessages.findHistory(BigInt(req.user.entidadeId), {
      ...(parsedLimit && Number.isFinite(parsedLimit) ? { limit: parsedLimit } : {}),
      ...(cursor ? { cursor } : {}),
    });
  }

  /**
   * Limpa a conversa atual do user (soft-delete em DEvento -508).
   *
   * Mantem trilha de audit (excluido=true em vez de DELETE fisico).
   * v2 multi-conversa: aceitar `conversationId` explicito.
   *
   * @example
   * ```bash
   * curl -X DELETE http://localhost:3000/ai/chat/history \
   *   -H "Authorization: Bearer ..."
   * ```
   */
  @Delete('history')
  @ApiOperation({
    summary: 'Limpa conversa atual (soft-delete)',
    description: 'Marca todas as DEventos -508 do user como excluidas. Trilha de audit preservada.',
  })
  @ApiResponse({
    status: 200,
    description: 'Conversa limpa',
    schema: { example: { cleared: true, count: 42 } },
  })
  @ApiResponse({ status: 401, description: 'Nao autenticado' })
  async clearHistory(@Request() req: JwtRequest): Promise<{ cleared: boolean; count: number }> {
    this.logger.log(`DELETE /ai/chat/history — user=${req.user.entidadeId}`);
    const count = await this.chatMessages.clearHistory(BigInt(req.user.entidadeId));
    return { cleared: true, count };
  }
}

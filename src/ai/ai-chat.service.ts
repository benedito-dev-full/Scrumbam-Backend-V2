import { Injectable, Logger } from '@nestjs/common';
import { CorrelationIdService } from '../common/services/correlation-id.service';
import { EventProducerService } from '../eventos/core/event-producer.service';
import { EVENT_TYPES } from '../eventos/core/event-types';
import { ChatMessagesService, PersistedChatMessage } from './chat-messages.service';
import { ContextBuilderService } from './context-builder.service';
import { SendMessageDto } from './dto/send-message.dto';
import { ChatMessageResponseDto, ChatToolCallDto } from './dto/chat-message-response.dto';
import { GeminiProvider } from './providers/gemini.provider';
import { AiProviderMessage } from './providers/ai-provider.interface';
import { SYSTEM_PROMPT_NEXUS } from './system-prompt';
import { ToolRegistry } from './tools/tool-registry';

/** Janela conservadora de historico enviada ao provider a cada request. */
const HISTORY_WINDOW = 30;

/** Limite duro de iteracoes do loop de tool calling (defesa contra loop infinito). */
const MAX_TOOL_ITERATIONS = 5;

/**
 * Orquestrador principal do chat IA Nexus.
 *
 * Fluxo (`POST /ai/chat`):
 *   1. Persistir `role=user` em `DEvento -508` ANTES da chamada Gemini.
 *      (Se Gemini falhar, refresh hidrata a mensagem do user — R-7 do plano.)
 *   2. Carregar historico (ultimas 30 msgs, ASC cronologico).
 *   3. Anexar nova mensagem do user ao final do array.
 *   4. Construir tools via `ToolRegistry` com `ctx` extraido do JWT.
 *   5. Chamar `GeminiProvider.chat(...)` — loop de tool calling embutido.
 *   6. Persistir `role=assistant` com metadata (model, tokens, toolCalls)
 *      em `DEvento -508` APOS sucesso.
 *   7. Emitir eventos canonicos (`ai.chat.message.created` + 1 por tool call).
 *   8. Retornar `ChatMessageResponseDto`.
 *
 * Erros do provider (429/timeout/5xx) sao traduzidos para HTTP appropriado
 * dentro do `GeminiProvider` (NestJS HttpException). O `AiChatController`
 * NAO precisa try/catch — propagacao natural.
 *
 * Tenant isolation: tools recebem `userEntidadeId` + `organizationId` do
 * `AiToolContext` — services internos (Comments, Tasks, Projects) ja fazem
 * o gate. IA NUNCA escolhe quem eh o user.
 *
 * @see ChatMessagesService — persistencia em DEvento -508.
 * @see GeminiProvider — chamada ao SDK + tool calling.
 * @see ToolRegistry — montagem das tools com ctx do request.
 */
@Injectable()
export class AiChatService {
  private readonly logger = new Logger(AiChatService.name);

  constructor(
    private readonly chatMessages: ChatMessagesService,
    private readonly toolRegistry: ToolRegistry,
    private readonly gemini: GeminiProvider,
    private readonly eventProducer: EventProducerService,
    private readonly correlationId: CorrelationIdService,
    private readonly contextBuilder: ContextBuilderService,
  ) {}

  /**
   * Envia uma mensagem do usuario ao Nexus e devolve a resposta do assistant.
   *
   * @param dto - Conteudo da mensagem do user.
   * @param userEntidadeId - `DEntidade.chave` do user logado (JWT).
   * @param organizationId - Org ativa (JWT). Opcional — algumas integracoes
   *   legadas (MCP key sem org) podem nao ter.
   * @returns DTO com texto final, modelo, e auditoria de tools.
   */
  async sendMessage(
    dto: SendMessageDto,
    userEntidadeId: bigint,
    organizationId?: string,
  ): Promise<ChatMessageResponseDto> {
    const correlationId = this.correlationId.getOrGenerate();

    this.logger.log(
      `ai_chat_send user=${userEntidadeId.toString()} len=${dto.content.length} org=${organizationId ?? '-'}`,
    );

    // 1. Persistir user message ANTES de chamar o provider — garante que a
    //    mensagem nao se perde se o Gemini falhar.
    await this.chatMessages.append({
      userEntidadeId,
      role: 'user',
      content: dto.content,
    });

    // 2. Carregar historico (janela de 30 msgs). Como acabamos de inserir
    //    a do user, ela ja aparece no historico carregado.
    const history = await this.chatMessages.findHistoryForProvider(userEntidadeId, HISTORY_WINDOW);

    // 3. Montar payload do provider.
    const providerMessages: AiProviderMessage[] = history.map((m) => ({
      role: m.role,
      content: m.content,
    }));

    const tools = this.toolRegistry.buildAll({
      userEntidadeId,
      ...(organizationId ? { organizationId } : {}),
    });

    // 3.5. Montar bloco de contexto runtime (Etapa A — nome, org, data,
    //      projetos recentes). Cache 60s em memoria — ver ContextBuilderService.
    const contextBlock = await this.contextBuilder.build(userEntidadeId, organizationId);
    const finalSystemPrompt = `${SYSTEM_PROMPT_NEXUS}\n\n${contextBlock}`;

    // 4. Chamar Gemini — erros sao traduzidos pelo provider (Http exceptions).
    const result = await this.gemini.chat({
      systemPrompt: finalSystemPrompt,
      messages: providerMessages,
      tools,
      maxToolIterations: MAX_TOOL_ITERATIONS,
    });

    // 5. Persistir assistant message APOS sucesso, com metadata para audit.
    const assistantMessage = await this.chatMessages.append({
      userEntidadeId,
      role: 'assistant',
      content: result.finalMessage,
      metadata: {
        model: result.model,
        ...(result.tokensUsed ? { tokens: result.tokensUsed } : {}),
        toolCallsCount: result.toolCallsExecuted.length,
        ...(result.toolCallsExecuted.length > 0 ? { toolCalls: result.toolCallsExecuted } : {}),
        ...(result.finishReason ? { finishReason: result.finishReason } : {}),
      },
    });

    // 5.5. B5 — invalidacao event-driven do bloco de contexto runtime.
    //      Se alguma tool foi executada (criou task, comment, etc.), o
    //      bloco do `ContextBuilderService` ficou stale (contadores de
    //      unread, projetos recentes, etc.). Limpa todas as entradas do
    //      user para forcar recomputacao na proxima mensagem. TTL de 60s
    //      continua como fallback geral. Chamado APOS persistencia do
    //      assistant message e ANTES dos eventos de audit para garantir
    //      ordem consistente.
    if (result.toolCallsExecuted.length > 0) {
      this.contextBuilder.invalidate(userEntidadeId);
    }

    // 6. Audit events — APOS persistencia. Aguarda persistencia do evento
    //    (modo sincrono atual do EventProducer). Em futuro modo assincrono,
    //    considerar fire-and-forget para reduzir latencia da resposta.
    await this.eventProducer.addInternalEvent(
      EVENT_TYPES.AI_CHAT_MESSAGE_CREATED,
      {
        messageId: assistantMessage.id.toString(),
        userId: userEntidadeId.toString(),
        role: 'assistant',
        model: result.model,
        toolCallsCount: result.toolCallsExecuted.length,
      },
      correlationId,
      { source: AiChatService.name },
    );

    for (const call of result.toolCallsExecuted) {
      await this.eventProducer.addInternalEvent(
        EVENT_TYPES.AI_CHAT_TOOL_CALLED,
        {
          userId: userEntidadeId.toString(),
          tool: call.name,
          argsHash: call.argsHash,
        },
        correlationId,
        { source: AiChatService.name },
      );
    }

    // 7. Construir DTO de resposta.
    const toolCallsDto: ChatToolCallDto[] = result.toolCallsExecuted.map((c) => ({
      name: c.name,
      argsHash: c.argsHash,
      resultPreview: c.resultPreview,
    }));

    return {
      assistantMessage: result.finalMessage,
      model: result.model,
      toolCallsCount: result.toolCallsExecuted.length,
      ...(toolCallsDto.length > 0 ? { toolCalls: toolCallsDto } : {}),
      messageId: assistantMessage.id.toString(),
    };
  }

  /** Wrapper para o controller — preserva tipo `PersistedChatMessage` interno. */
  // (exposto se algum consumer interno precisar — frontend usa GET /history)
  // istanbul ignore next - utility for future usage
  protected _hint(): PersistedChatMessage | null {
    return null;
  }
}

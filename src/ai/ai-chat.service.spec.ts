import { AiChatService } from './ai-chat.service';
import { ChatMessagesService, PersistedChatMessage } from './chat-messages.service';
import { ContextBuilderService } from './context-builder.service';
import { CorrelationIdService } from '../common/services/correlation-id.service';
import { EventProducerService } from '../eventos/core/event-producer.service';
import { ToolRegistry } from './tools/tool-registry';
import { AiProviderRegistry } from './providers/ai-provider.registry';
import { AiProviderPrefService } from './ai-provider-pref.service';
import { AiProvider, AiProviderResult } from './providers/ai-provider.interface';
import { SendMessageDto } from './dto/send-message.dto';

/**
 * Testes de ROTEAMENTO de provider no `AiChatService` (Fase 4).
 *
 * Foco exclusivo: como o provider efetivo e resolvido na cascata
 * `dto.provider → preferencia da org → registry.defaultName ('gemini')`,
 * e a compat retroativa (sem provider/pref → Gemini, sem model → default).
 */
describe('AiChatService — roteamento de provider (Fase 4)', () => {
  let service: AiChatService;

  let chatMessages: jest.Mocked<Pick<ChatMessagesService, 'append' | 'findHistoryForProvider'>>;
  let toolRegistry: jest.Mocked<Pick<ToolRegistry, 'buildAll'>>;
  let providerPref: jest.Mocked<Pick<AiProviderPrefService, 'getDefaultForOrg'>>;
  let eventProducer: jest.Mocked<Pick<EventProducerService, 'addInternalEvent'>>;
  let correlationId: jest.Mocked<Pick<CorrelationIdService, 'getOrGenerate'>>;
  let contextBuilder: jest.Mocked<Pick<ContextBuilderService, 'build' | 'invalidate'>>;

  // Providers reais (stubs) indexados por um registry real.
  let geminiProvider: AiProvider;
  let claudeProvider: AiProvider;
  let openaiProvider: AiProvider;
  let registry: AiProviderRegistry;

  const USER = BigInt(123);

  const providerResult: AiProviderResult = {
    finalMessage: 'ok',
    model: 'stub-model',
    toolCallsExecuted: [],
  };

  const persisted: PersistedChatMessage = {
    id: BigInt(1),
    role: 'assistant',
    content: 'ok',
    createdAt: new Date(),
  };

  beforeEach(() => {
    geminiProvider = { name: 'gemini', chat: jest.fn().mockResolvedValue(providerResult) };
    claudeProvider = { name: 'claude', chat: jest.fn().mockResolvedValue(providerResult) };
    openaiProvider = { name: 'openai', chat: jest.fn().mockResolvedValue(providerResult) };

    registry = new AiProviderRegistry(
      geminiProvider as never,
      claudeProvider as never,
      openaiProvider as never,
    );

    chatMessages = {
      append: jest.fn().mockResolvedValue(persisted),
      findHistoryForProvider: jest
        .fn()
        .mockResolvedValue([{ role: 'user', content: 'oi' }]),
    };
    toolRegistry = { buildAll: jest.fn().mockReturnValue([]) };
    providerPref = { getDefaultForOrg: jest.fn().mockResolvedValue(null) };
    eventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };
    correlationId = { getOrGenerate: jest.fn().mockReturnValue('corr-1') };
    contextBuilder = { build: jest.fn().mockResolvedValue('ctx'), invalidate: jest.fn() };

    service = new AiChatService(
      chatMessages as unknown as ChatMessagesService,
      toolRegistry as unknown as ToolRegistry,
      registry,
      providerPref as unknown as AiProviderPrefService,
      eventProducer as unknown as EventProducerService,
      correlationId as unknown as CorrelationIdService,
      contextBuilder as unknown as ContextBuilderService,
    );
  });

  function dto(extra: Partial<SendMessageDto> = {}): SendMessageDto {
    return { content: 'oi', ...extra } as SendMessageDto;
  }

  it('compat retroativa: sem dto.provider e sem pref de org → usa Gemini', async () => {
    await service.sendMessage(dto(), USER);

    expect(geminiProvider.chat).toHaveBeenCalledTimes(1);
    expect(claudeProvider.chat).not.toHaveBeenCalled();
    expect(openaiProvider.chat).not.toHaveBeenCalled();
  });

  it('compat retroativa: sem model no dto/pref → nao passa model ao provider', async () => {
    await service.sendMessage(dto(), USER);

    const opts = (geminiProvider.chat as jest.Mock).mock.calls[0][0];
    expect(opts.model).toBeUndefined();
  });

  it('dto.provider="claude" → usa Claude', async () => {
    await service.sendMessage(dto({ provider: 'claude' }), USER);

    expect(claudeProvider.chat).toHaveBeenCalledTimes(1);
    expect(geminiProvider.chat).not.toHaveBeenCalled();
  });

  it('sem dto.provider mas com pref de org {provider:"openai"} → usa OpenAI', async () => {
    providerPref.getDefaultForOrg.mockResolvedValue({ provider: 'openai' });

    await service.sendMessage(dto(), USER, '152');

    expect(openaiProvider.chat).toHaveBeenCalledTimes(1);
    expect(providerPref.getDefaultForOrg).toHaveBeenCalledWith(BigInt(152));
    expect(geminiProvider.chat).not.toHaveBeenCalled();
  });

  it('precedencia: dto.provider ganha da pref da org (dto=claude, pref=openai → claude)', async () => {
    providerPref.getDefaultForOrg.mockResolvedValue({ provider: 'openai' });

    await service.sendMessage(dto({ provider: 'claude' }), USER, '152');

    expect(claudeProvider.chat).toHaveBeenCalledTimes(1);
    expect(openaiProvider.chat).not.toHaveBeenCalled();
  });

  it('model efetivo: dto.model presente → chega no provider.chat', async () => {
    await service.sendMessage(dto({ model: 'gemini-2.5-pro' }), USER);

    const opts = (geminiProvider.chat as jest.Mock).mock.calls[0][0];
    expect(opts.model).toBe('gemini-2.5-pro');
  });

  it('model efetivo: pref.model usado quando dto.model ausente', async () => {
    providerPref.getDefaultForOrg.mockResolvedValue({ provider: 'claude', model: 'claude-opus-4' });

    await service.sendMessage(dto(), USER, '152');

    const opts = (claudeProvider.chat as jest.Mock).mock.calls[0][0];
    expect(opts.model).toBe('claude-opus-4');
  });

  it('nao consulta pref de org quando nao ha organizationId', async () => {
    await service.sendMessage(dto(), USER);

    expect(providerPref.getDefaultForOrg).not.toHaveBeenCalled();
  });

  it('lista de tools dinamica: systemPrompt contem "- **name** — description" de cada tool', async () => {
    // ADR-V2-079: o prompt reflete literalmente o payload `tools` de buildAll.
    toolRegistry.buildAll.mockReturnValue([
      {
        name: 'search_tasks',
        description: 'Busca tasks por texto livre.',
        parameters: {},
        execute: jest.fn(),
      },
      {
        name: 'update_status',
        description: 'Move uma task entre estados V3.',
        parameters: {},
        execute: jest.fn(),
      },
    ] as never);

    await service.sendMessage(dto(), USER);

    const opts = (geminiProvider.chat as jest.Mock).mock.calls[0][0];
    expect(typeof opts.systemPrompt).toBe('string');
    expect(opts.systemPrompt).toContain('- **search_tasks** — Busca tasks por texto livre.');
    expect(opts.systemPrompt).toContain('- **update_status** — Move uma task entre estados V3.');
    // Bloco de contexto ('ctx') continua concatenado ao fim do prompt.
    expect(opts.systemPrompt).toContain('ctx');
  });

  it('sem tools disponiveis: systemPrompt continua string nao-vazia (sem bullets)', async () => {
    // buildAll → [] (default do beforeEach): prompt valido mesmo sem tools.
    await service.sendMessage(dto(), USER);

    const opts = (geminiProvider.chat as jest.Mock).mock.calls[0][0];
    expect(typeof opts.systemPrompt).toBe('string');
    expect(opts.systemPrompt.length).toBeGreaterThan(0);
    expect(opts.systemPrompt).not.toContain('- **');
  });
});

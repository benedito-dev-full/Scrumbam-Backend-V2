import { Test, TestingModule } from '@nestjs/testing';
import { MessageRouterService } from '../core/message-router.service';
import { AccountLinkService } from '../core/account-link.service';
import { CommandRegistryService } from '../core/command-registry.service';
import { InboundMessage } from '../core/channel-adapter.interface';

describe('MessageRouterService', () => {
  let service: MessageRouterService;
  let accountLinkService: { findByChat: jest.Mock };
  let commandRegistry: { resolve: jest.Mock; register: jest.Mock; listCommands: jest.Mock };

  const chatId = BigInt(123456789);
  const userId = BigInt(42);
  const channelName = 'telegram';

  beforeEach(async () => {
    accountLinkService = {
      findByChat: jest.fn(),
    };

    commandRegistry = {
      resolve: jest.fn(),
      register: jest.fn(),
      listCommands: jest.fn().mockReturnValue([]),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        MessageRouterService,
        { provide: AccountLinkService, useValue: accountLinkService },
        { provide: CommandRegistryService, useValue: commandRegistry },
      ],
    }).compile();

    service = module.get<MessageRouterService>(MessageRouterService);
  });

  describe('handleInbound', () => {
    it('deve chamar AccountLinkService.findByChat antes de rotear', async () => {
      accountLinkService.findByChat.mockResolvedValue(null);

      const message: InboundMessage = { chatId, type: 'text', text: 'Olá' };
      await service.handleInbound(channelName, message);

      expect(accountLinkService.findByChat).toHaveBeenCalledWith(channelName, chatId);
    });

    it('não deve processar mensagem quando userId é null (canal não pareado)', async () => {
      accountLinkService.findByChat.mockResolvedValue(null);

      const mockCommandHandler = { commandName: 'tasks', handle: jest.fn() };
      commandRegistry.resolve.mockReturnValue(mockCommandHandler);

      const message: InboundMessage = {
        chatId,
        type: 'command',
        commandName: 'tasks',
        commandArgs: ['today'],
      };
      await service.handleInbound(channelName, message);

      // Handler não deve ter sido chamado
      expect(mockCommandHandler.handle).not.toHaveBeenCalled();
    });

    it('deve rotear comando para handler registrado quando userId existe', async () => {
      accountLinkService.findByChat.mockResolvedValue(userId);

      const mockHandler = {
        commandName: 'tasks',
        handle: jest.fn().mockResolvedValue('Aqui estão suas tasks:'),
      };
      commandRegistry.resolve.mockReturnValue(mockHandler);

      const message: InboundMessage = {
        chatId,
        type: 'command',
        commandName: 'tasks',
        commandArgs: ['today'],
      };
      await service.handleInbound(channelName, message);

      expect(commandRegistry.resolve).toHaveBeenCalledWith('tasks');
      expect(mockHandler.handle).toHaveBeenCalledWith(chatId, userId, ['today']);
    });

    it('deve ignorar comando não registrado sem lançar erro', async () => {
      accountLinkService.findByChat.mockResolvedValue(userId);
      commandRegistry.resolve.mockReturnValue(undefined);

      const message: InboundMessage = {
        chatId,
        type: 'command',
        commandName: 'unknown',
        commandArgs: [],
      };

      await expect(service.handleInbound(channelName, message)).resolves.not.toThrow();
    });

    it('deve tentar intent handlers para mensagens de texto', async () => {
      accountLinkService.findByChat.mockResolvedValue(userId);

      const intentHandler = {
        intentName: 'create_task',
        canHandle: jest.fn().mockReturnValue(true),
        handle: jest.fn().mockResolvedValue(undefined),
      };
      service.registerIntentHandler(intentHandler);

      const message: InboundMessage = {
        chatId,
        type: 'text',
        text: 'Nova task: implementar feature X',
      };
      await service.handleInbound(channelName, message);

      expect(intentHandler.canHandle).toHaveBeenCalledWith(message);
      expect(intentHandler.handle).toHaveBeenCalledWith(chatId, userId, message);
    });

    it('deve capturar erros de handlers sem propagar (fail-safe)', async () => {
      accountLinkService.findByChat.mockResolvedValue(userId);

      const mockHandler = {
        commandName: 'crash',
        handle: jest.fn().mockRejectedValue(new Error('handler crash')),
      };
      commandRegistry.resolve.mockReturnValue(mockHandler);

      const message: InboundMessage = {
        chatId,
        type: 'command',
        commandName: 'crash',
        commandArgs: [],
      };

      // Não deve lançar
      await expect(service.handleInbound(channelName, message)).resolves.not.toThrow();
    });

    it('deve usar o primeiro intent handler que retornar canHandle=true', async () => {
      accountLinkService.findByChat.mockResolvedValue(userId);

      const handler1 = {
        intentName: 'handler1',
        canHandle: jest.fn().mockReturnValue(false),
        handle: jest.fn(),
      };
      const handler2 = {
        intentName: 'handler2',
        canHandle: jest.fn().mockReturnValue(true),
        handle: jest.fn().mockResolvedValue(undefined),
      };
      service.registerIntentHandler(handler1);
      service.registerIntentHandler(handler2);

      const message: InboundMessage = { chatId, type: 'text', text: 'Oi' };
      await service.handleInbound(channelName, message);

      expect(handler1.handle).not.toHaveBeenCalled();
      expect(handler2.handle).toHaveBeenCalled();
    });
  });
});

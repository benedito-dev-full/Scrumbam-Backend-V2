import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { TelegramWebhookService } from '../telegram-webhook.service';
import { AccountLinkService } from '../../core/account-link.service';
import { MessageRouterService } from '../../core/message-router.service';
import { TelegramSendService } from '../telegram-send.service';
import { TelegramFileDownloadService } from '../telegram-file-download.service';
import { GroqWhisperService } from '../../../integrations/groq/groq-whisper.service';
import { EventProducerService } from '../../../eventos/core/event-producer.service';
import { PrismaService } from '../../../prisma.service';
import { TelegramUpdateDto } from '../dto/telegram-update.dto';

describe('TelegramWebhookService', () => {
  let service: TelegramWebhookService;

  // Mocks de todos os colaboradores
  let mockPrisma: {
    dEvento: { create: jest.Mock };
    dVincula: { findMany: jest.Mock; update: jest.Mock };
    $transaction: jest.Mock;
  };

  let mockAccountLinkService: jest.Mocked<Pick<AccountLinkService, 'findByChat'>>;
  let mockMessageRouterService: jest.Mocked<Pick<MessageRouterService, 'handleInbound'>>;
  let mockTelegramSendService: jest.Mocked<Pick<TelegramSendService, 'sendMessage' | 'setWebhook'>>;
  let mockFileDownloadService: jest.Mocked<Pick<TelegramFileDownloadService, 'download'>>;
  let mockGroqWhisperService: jest.Mocked<Pick<GroqWhisperService, 'transcribe'>>;
  let mockEventProducer: jest.Mocked<Pick<EventProducerService, 'addInternalEvent'>>;
  let mockConfigService: jest.Mocked<Pick<ConfigService, 'get'>>;

  const USER_ID = BigInt(100);
  const CHAT_ID = BigInt(123456789);
  const UPDATE_ID = 42;

  function buildUpdate(overrides: Partial<TelegramUpdateDto> = {}): TelegramUpdateDto {
    return {
      update_id: UPDATE_ID,
      message: {
        message_id: 1,
        chat: { id: Number(CHAT_ID), type: 'private' },
        from: { id: 987654321, username: 'testuser' },
        text: 'Olá bot!',
        date: 1746000000,
      },
      ...overrides,
    } as TelegramUpdateDto;
  }

  beforeEach(async () => {
    // tx mock para $transaction
    const txMock = {
      dEvento: { create: jest.fn().mockResolvedValue({}) },
      dVincula: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) },
    };

    mockPrisma = {
      dEvento: { create: jest.fn().mockResolvedValue({}) },
      dVincula: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) },
      $transaction: jest.fn().mockImplementation((fn: (tx: typeof txMock) => Promise<unknown>) =>
        fn(txMock),
      ),
    };

    mockAccountLinkService = {
      findByChat: jest.fn().mockResolvedValue(USER_ID),
    };

    mockMessageRouterService = {
      handleInbound: jest.fn().mockResolvedValue(undefined),
    };

    mockTelegramSendService = {
      sendMessage: jest.fn().mockResolvedValue(undefined),
      setWebhook: jest.fn().mockResolvedValue(undefined),
    };

    mockFileDownloadService = {
      download: jest.fn().mockResolvedValue(Buffer.from('fake-audio-data')),
    };

    mockGroqWhisperService = {
      transcribe: jest.fn().mockResolvedValue('Texto transcrito do áudio'),
    };

    mockEventProducer = {
      addInternalEvent: jest.fn().mockResolvedValue(undefined),
    };

    mockConfigService = {
      get: jest.fn().mockImplementation((key: string) => {
        const config: Record<string, string> = {
          CHANNELS_ENABLED: 'true',
          REDIS_URL: 'redis://localhost:6379',
          TELEGRAM_WEBHOOK_URL: 'https://example.com/webhooks/telegram',
        };
        return config[key];
      }),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramWebhookService,
        { provide: PrismaService, useValue: mockPrisma },
        { provide: AccountLinkService, useValue: mockAccountLinkService },
        { provide: MessageRouterService, useValue: mockMessageRouterService },
        { provide: TelegramSendService, useValue: mockTelegramSendService },
        { provide: TelegramFileDownloadService, useValue: mockFileDownloadService },
        { provide: GroqWhisperService, useValue: mockGroqWhisperService },
        { provide: EventProducerService, useValue: mockEventProducer },
        { provide: ConfigService, useValue: mockConfigService },
      ],
    }).compile();

    service = module.get<TelegramWebhookService>(TelegramWebhookService);

    // Desabilitar initRedis nos testes para evitar conexão real
    jest.spyOn(service as unknown as { initRedis: () => void }, 'initRedis').mockImplementation(() => {});

    // Desabilitar deduplicação Redis (sempre retorna false = "não é duplicado")
    jest.spyOn(service as unknown as { isDuplicate: (id: number) => Promise<boolean> }, 'isDuplicate')
      .mockResolvedValue(false);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  // ==============================================================
  // handleUpdate
  // ==============================================================
  describe('handleUpdate', () => {
    it('deve descartar update duplicado (deduplicação)', async () => {
      // Simular update_id já processado
      jest.spyOn(service as unknown as { isDuplicate: (id: number) => Promise<boolean> }, 'isDuplicate')
        .mockResolvedValue(true);

      const update = buildUpdate();
      await service.handleUpdate(update);

      expect(mockAccountLinkService.findByChat).not.toHaveBeenCalled();
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('deve ignorar update sem mensagem', async () => {
      const update: TelegramUpdateDto = { update_id: UPDATE_ID };
      await service.handleUpdate(update);

      expect(mockAccountLinkService.findByChat).not.toHaveBeenCalled();
    });

    it('deve orientar pareamento quando chatId não está vinculado', async () => {
      mockAccountLinkService.findByChat.mockResolvedValue(null);

      const update = buildUpdate();
      await service.handleUpdate(update);

      expect(mockTelegramSendService.sendMessage).toHaveBeenCalledWith(
        CHAT_ID,
        expect.stringContaining('parear'),
      );
      expect(mockPrisma.$transaction).not.toHaveBeenCalled();
    });

    it('deve processar mensagem de texto para usuário pareado', async () => {
      const update = buildUpdate({ message: { message_id: 1, chat: { id: Number(CHAT_ID), type: 'private' }, text: 'Criar tarefa', date: 1746000000 } });
      await service.handleUpdate(update);

      expect(mockPrisma.$transaction).toHaveBeenCalled();
      expect(mockEventProducer.addInternalEvent).toHaveBeenCalledWith(
        'telegram.message.received',
        expect.objectContaining({ chatId: CHAT_ID.toString() }),
        UPDATE_ID.toString(),
        expect.any(Object),
      );
    });

    it('deve processar mensagem de voz para usuário pareado', async () => {
      const update: TelegramUpdateDto = {
        update_id: UPDATE_ID,
        message: {
          message_id: 1,
          chat: { id: Number(CHAT_ID), type: 'private' },
          voice: { file_id: 'voice-file-id', duration: 5, mime_type: 'audio/ogg' },
          date: 1746000000,
        },
      };

      await service.handleUpdate(update);

      expect(mockFileDownloadService.download).toHaveBeenCalledWith('voice-file-id');
      expect(mockGroqWhisperService.transcribe).toHaveBeenCalled();
      expect(mockPrisma.dEvento.create).toHaveBeenCalled();
    });
  });

  // ==============================================================
  // handleText
  // ==============================================================
  describe('handleText', () => {
    it('deve criar DEvento via prisma.$transaction', async () => {
      await service.handleText(CHAT_ID, USER_ID, 'Criar tarefa', 1, 1746000000, 'corr-1');

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('deve emitir evento telegram.message.received APÓS o commit', async () => {
      const callOrder: string[] = [];

      mockPrisma.$transaction.mockImplementation(async (fn: (tx: unknown) => Promise<void>) => {
        const txMock = {
          dEvento: { create: jest.fn().mockImplementation(() => { callOrder.push('dEvento.create'); return Promise.resolve({}); }) },
          dVincula: { findMany: jest.fn().mockResolvedValue([]), update: jest.fn().mockResolvedValue({}) },
        };
        await fn(txMock);
        callOrder.push('transaction_committed');
      });

      mockEventProducer.addInternalEvent.mockImplementation(() => {
        callOrder.push('event_emitted');
        return Promise.resolve();
      });

      await service.handleText(CHAT_ID, USER_ID, 'Texto', 1, 1746000000, 'corr-1');

      const txIdx = callOrder.indexOf('transaction_committed');
      const evtIdx = callOrder.indexOf('event_emitted');
      expect(txIdx).toBeLessThan(evtIdx);
    });

    it('deve chamar prisma.$transaction (atomicidade DEvento + DVincula)', async () => {
      await service.handleText(CHAT_ID, USER_ID, 'Mensagem', 1, 1746000000, 'corr-1');

      expect(mockPrisma.$transaction).toHaveBeenCalledTimes(1);
    });

    it('deve rotear para MessageRouterService após commit', async () => {
      await service.handleText(CHAT_ID, USER_ID, 'Criar tarefa de login', 1, 1746000000, 'corr-1');

      expect(mockMessageRouterService.handleInbound).toHaveBeenCalledWith(
        'telegram',
        expect.objectContaining({ chatId: CHAT_ID, type: 'text' }),
      );
    });
  });

  // ==============================================================
  // handleVoice
  // ==============================================================
  describe('handleVoice', () => {
    it('deve gravar DEvento mesmo quando Groq falha', async () => {
      mockGroqWhisperService.transcribe.mockRejectedValue(
        new Error('Groq unavailable'),
      );

      await service.handleVoice(CHAT_ID, USER_ID, 'file-id', 'audio/ogg', 'corr-1');

      // DEvento deve ser gravado mesmo com falha no Groq
      expect(mockPrisma.dEvento.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            idEntidade: USER_ID,
          }),
        }),
      );
    });

    it('deve incluir transcription quando Groq tem sucesso', async () => {
      mockGroqWhisperService.transcribe.mockResolvedValue('Texto transcrito');

      await service.handleVoice(CHAT_ID, USER_ID, 'file-id', 'audio/ogg', 'corr-1');

      expect(mockPrisma.dEvento.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metaDados: expect.objectContaining({
              transcription: 'Texto transcrito',
              transcriptError: null,
            }),
          }),
        }),
      );
    });

    it('deve incluir transcriptError quando Groq falha', async () => {
      mockGroqWhisperService.transcribe.mockRejectedValue(
        new Error('API timeout'),
      );

      await service.handleVoice(CHAT_ID, USER_ID, 'file-id', 'audio/ogg', 'corr-1');

      expect(mockPrisma.dEvento.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metaDados: expect.objectContaining({
              transcription: null,
              transcriptError: expect.stringContaining('groq_unavailable'),
            }),
          }),
        }),
      );
    });

    it('deve emitir telegram.voice.received após gravar DEvento', async () => {
      const callOrder: string[] = [];

      mockPrisma.dEvento.create.mockImplementation(() => {
        callOrder.push('dEvento_created');
        return Promise.resolve({});
      });

      mockEventProducer.addInternalEvent.mockImplementation(() => {
        callOrder.push('event_emitted');
        return Promise.resolve();
      });

      await service.handleVoice(CHAT_ID, USER_ID, 'file-id', 'audio/ogg', 'corr-1');

      const eventoIdx = callOrder.indexOf('dEvento_created');
      const emitIdx = callOrder.indexOf('event_emitted');
      expect(eventoIdx).toBeLessThan(emitIdx);
    });

    it('deve gravar DEvento com transcriptError quando download falha', async () => {
      mockFileDownloadService.download.mockRejectedValue(new Error('Network timeout'));

      await service.handleVoice(CHAT_ID, USER_ID, 'file-id', 'audio/ogg', 'corr-1');

      expect(mockPrisma.dEvento.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            metaDados: expect.objectContaining({
              transcription: null,
              transcriptError: expect.stringContaining('download_failed'),
            }),
          }),
        }),
      );

      // Groq não deve ser chamado se download falhou
      expect(mockGroqWhisperService.transcribe).not.toHaveBeenCalled();
    });
  });
});

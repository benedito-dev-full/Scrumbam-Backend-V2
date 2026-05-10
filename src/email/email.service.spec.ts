import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EmailService } from './email.service';
import { EMAIL_PROVIDER_TOKEN, EmailProvider } from './providers/email-provider.interface';
import { EventProducerService } from '../eventos/core/event-producer.service';
import { CorrelationIdService } from '../common/services/correlation-id.service';
import { SendEmailDto } from './dto/send-email.dto';

describe('EmailService', () => {
  let service: EmailService;
  let mockEmailProvider: jest.Mocked<EmailProvider>;
  let mockEventProducer: jest.Mocked<Pick<EventProducerService, 'addInternalEvent'>>;
  let mockCorrelationIdService: jest.Mocked<Pick<CorrelationIdService, 'getOrGenerate'>>;

  beforeEach(async () => {
    mockEmailProvider = {
      send: jest.fn(),
    };
    mockEventProducer = {
      addInternalEvent: jest.fn().mockResolvedValue(undefined),
    };
    mockCorrelationIdService = {
      getOrGenerate: jest.fn().mockReturnValue('test-correlation-id'),
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: EMAIL_PROVIDER_TOKEN,
          useValue: mockEmailProvider,
        },
        {
          provide: EventProducerService,
          useValue: mockEventProducer,
        },
        {
          provide: CorrelationIdService,
          useValue: mockCorrelationIdService,
        },
      ],
    }).compile();

    service = module.get<EmailService>(EmailService);
  });

  describe('send', () => {
    it('deve enviar email com sucesso e retornar id e provider', async () => {
      const dto: SendEmailDto = {
        to: 'user@example.com',
        subject: 'Teste',
        html: '<p>Teste</p>',
      };
      mockEmailProvider.send.mockResolvedValue({ id: 'msg-123', provider: 'smtp' });

      const result = await service.send(dto);

      expect(mockEmailProvider.send).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'user@example.com', subject: 'Teste' }),
      );
      expect(result.id).toBe('msg-123');
      expect(result.provider).toBe('smtp');
      expect(result.sentAt).toBeDefined();
      // Auditoria via EventProducerService deve ser chamada após envio bem-sucedido
      expect(mockEventProducer.addInternalEvent).toHaveBeenCalledWith(
        'email.sent',
        expect.objectContaining({ to: 'user@example.com', provider: 'smtp' }),
        'test-correlation-id',
        expect.objectContaining({ source: 'EmailService' }),
      );
    });

    it('deve emitir email.failed e relançar exceção quando provider falha', async () => {
      const dto: SendEmailDto = {
        to: 'user@example.com',
        subject: 'Teste',
        html: '<p>Teste</p>',
      };
      const error = new Error('SMTP connection refused');
      mockEmailProvider.send.mockRejectedValue(error);

      await expect(service.send(dto)).rejects.toThrow('SMTP connection refused');

      expect(mockEventProducer.addInternalEvent).toHaveBeenCalledWith(
        'email.failed',
        expect.objectContaining({ error: 'SMTP connection refused' }),
        'test-correlation-id',
        expect.objectContaining({ source: 'EmailService' }),
      );
    });
  });

  describe('sendTemplate', () => {
    it('deve renderizar template welcome e chamar send', async () => {
      mockEmailProvider.send.mockResolvedValue({ id: 'msg-456', provider: 'smtp-mock' });

      const result = await service.sendTemplate(
        'welcome',
        { name: 'João', loginUrl: 'https://app.scrumban.com/login' },
        'joao@example.com',
      );

      expect(mockEmailProvider.send).toHaveBeenCalledWith(
        expect.objectContaining({
          to: 'joao@example.com',
          subject: expect.stringContaining('Bem-vindo'),
          html: expect.stringContaining('João'),
        }),
      );
      expect(result.id).toBe('msg-456');
    });

    it('deve lançar NotFoundException para template inválido', async () => {
      await expect(
        service.sendTemplate('template-inexistente', {}, 'user@example.com'),
      ).rejects.toThrow(NotFoundException);

      await expect(
        service.sendTemplate('template-inexistente', {}, 'user@example.com'),
      ).rejects.toThrow(/template.*não encontrado/i);
    });
  });
});

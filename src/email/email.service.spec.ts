import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';
import { EmailService } from './email.service';
import { EMAIL_PROVIDER_TOKEN, EmailProvider } from './providers/email-provider.interface';
import { AuditService } from '../common/services/audit.service';
import { SendEmailDto } from './dto/send-email.dto';

describe('EmailService', () => {
  let service: EmailService;
  let mockEmailProvider: jest.Mocked<EmailProvider>;
  let mockAuditService: jest.Mocked<AuditService>;

  beforeEach(async () => {
    mockEmailProvider = {
      send: jest.fn(),
    };
    mockAuditService = {
      log: jest.fn().mockResolvedValue(undefined),
    } as unknown as jest.Mocked<AuditService>;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        EmailService,
        {
          provide: EMAIL_PROVIDER_TOKEN,
          useValue: mockEmailProvider,
        },
        {
          provide: AuditService,
          useValue: mockAuditService,
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
      // Auditoria deve ser chamada após envio bem-sucedido
      expect(mockAuditService.log).toHaveBeenCalledWith(
        'email.sent',
        expect.any(BigInt),
        expect.objectContaining({ to: 'user@example.com', provider: 'smtp' }),
        undefined,
      );
    });

    it('deve logar email.failed e relançar exceção quando provider falha', async () => {
      const dto: SendEmailDto = {
        to: 'user@example.com',
        subject: 'Teste',
        html: '<p>Teste</p>',
      };
      const error = new Error('SMTP connection refused');
      mockEmailProvider.send.mockRejectedValue(error);

      await expect(service.send(dto)).rejects.toThrow('SMTP connection refused');

      expect(mockAuditService.log).toHaveBeenCalledWith(
        'email.failed',
        expect.any(BigInt),
        expect.objectContaining({ error: 'SMTP connection refused' }),
        undefined,
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

import { Test, TestingModule } from '@nestjs/testing';
import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TelegramWebhookController } from '../telegram-webhook.controller';
import { TelegramWebhookService } from '../telegram-webhook.service';
import { TelegramSecretGuard } from '../telegram-secret.guard';
import { TelegramUpdateDto } from '../dto/telegram-update.dto';

/**
 * Cria um mock de ExecutionContext para o guard.
 */
function createGuardContext(secret: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: {
          'x-telegram-bot-api-secret-token': secret,
        },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('TelegramWebhookController', () => {
  let controller: TelegramWebhookController;
  let guard: TelegramSecretGuard;
  let webhookServiceMock: jest.Mocked<Pick<TelegramWebhookService, 'handleUpdate'>>;
  let configServiceMock: jest.Mocked<Pick<ConfigService, 'get'>>;

  const VALID_SECRET = 'valid-secret-token-for-testing!!';

  const VALID_UPDATE: TelegramUpdateDto = {
    update_id: 123456789,
    message: {
      message_id: 42,
      chat: { id: 987654321, type: 'private' },
      from: { id: 987654321, username: 'testuser' },
      text: 'Olá!',
      date: 1746000000,
    },
  };

  beforeEach(async () => {
    webhookServiceMock = {
      handleUpdate: jest.fn().mockResolvedValue(undefined),
    };

    configServiceMock = {
      get: jest.fn().mockReturnValue(VALID_SECRET),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [TelegramWebhookController],
      providers: [
        { provide: TelegramWebhookService, useValue: webhookServiceMock },
        TelegramSecretGuard,
        { provide: ConfigService, useValue: configServiceMock },
      ],
    }).compile();

    controller = module.get<TelegramWebhookController>(TelegramWebhookController);
    guard = module.get<TelegramSecretGuard>(TelegramSecretGuard);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('handleWebhook', () => {
    it('deve chamar handleUpdate via setImmediate quando secret é correto', async () => {
      // O guard aceita o secret correto
      const guardResult = guard.canActivate(createGuardContext(VALID_SECRET));
      expect(guardResult).toBe(true);

      // Chamar o controller diretamente (guard já passou)
      controller.handleWebhook(VALID_UPDATE);

      // Aguardar setImmediate
      await new Promise<void>((resolve) => setImmediate(resolve));

      expect(webhookServiceMock.handleUpdate).toHaveBeenCalledWith(VALID_UPDATE);
    });

    it('deve rejeitar com false quando secret é errado', () => {
      const guardResult = guard.canActivate(createGuardContext('wrong-secret-same-length!!!!'));
      expect(guardResult).toBe(false);
    });

    it('deve rejeitar com false quando header está ausente (string vazia)', () => {
      const guardResult = guard.canActivate(createGuardContext(''));
      expect(guardResult).toBe(false);
    });

    it('deve retornar void imediatamente (não bloqueia o response)', () => {
      // handleUpdate simula operação lenta
      webhookServiceMock.handleUpdate.mockImplementation(
        () => new Promise<void>((resolve) => setTimeout(resolve, 5000)),
      );

      // handleWebhook deve retornar imediatamente
      const result = controller.handleWebhook(VALID_UPDATE);
      expect(result).toBeUndefined(); // Retorna void
    });

    it('deve usar setImmediate para não bloquear o response Telegram', async () => {
      const callOrder: string[] = [];

      webhookServiceMock.handleUpdate.mockImplementation(async () => {
        callOrder.push('handleUpdate_called');
      });

      // Simular que o response já foi enviado antes do handleUpdate executar
      controller.handleWebhook(VALID_UPDATE);
      callOrder.push('response_sent');

      // handleUpdate ainda não foi chamado (setImmediate pendente)
      expect(callOrder).toContain('response_sent');
      expect(callOrder).not.toContain('handleUpdate_called');

      // Aguardar setImmediate
      await new Promise<void>((resolve) => setImmediate(resolve));

      // Agora handleUpdate foi chamado
      expect(callOrder).toContain('handleUpdate_called');

      // O response foi enviado ANTES do handleUpdate
      expect(callOrder.indexOf('response_sent')).toBeLessThan(
        callOrder.indexOf('handleUpdate_called'),
      );
    });
  });
});

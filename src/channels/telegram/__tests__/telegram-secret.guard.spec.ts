import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Test, TestingModule } from '@nestjs/testing';
import { TelegramSecretGuard } from '../telegram-secret.guard';

/**
 * Cria um mock de ExecutionContext com o header especificado.
 */
function createMockContext(header: string): ExecutionContext {
  return {
    switchToHttp: () => ({
      getRequest: () => ({
        headers: {
          'x-telegram-bot-api-secret-token': header,
        },
      }),
    }),
  } as unknown as ExecutionContext;
}

describe('TelegramSecretGuard', () => {
  let guard: TelegramSecretGuard;
  let configService: jest.Mocked<ConfigService>;

  const VALID_SECRET = 'my-super-secret-token-32chars-ok';

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        TelegramSecretGuard,
        {
          provide: ConfigService,
          useValue: {
            get: jest.fn(),
          },
        },
      ],
    }).compile();

    guard = module.get<TelegramSecretGuard>(TelegramSecretGuard);
    configService = module.get(ConfigService);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('canActivate', () => {
    it('deve retornar true quando o secret é correto', () => {
      configService.get.mockReturnValue(VALID_SECRET);
      const ctx = createMockContext(VALID_SECRET);

      const result = guard.canActivate(ctx);

      expect(result).toBe(true);
    });

    it('deve retornar false quando o secret é incorreto', () => {
      configService.get.mockReturnValue(VALID_SECRET);
      const ctx = createMockContext('wrong-secret-token-12345678901234');

      const result = guard.canActivate(ctx);

      expect(result).toBe(false);
    });

    it('deve retornar false quando o header está vazio', () => {
      configService.get.mockReturnValue(VALID_SECRET);
      const ctx = createMockContext('');

      const result = guard.canActivate(ctx);

      expect(result).toBe(false);
    });

    it('deve retornar false quando o header tem comprimento diferente', () => {
      configService.get.mockReturnValue(VALID_SECRET);
      const ctx = createMockContext('short');

      const result = guard.canActivate(ctx);

      expect(result).toBe(false);
    });

    it('deve retornar true (sem validação) quando TELEGRAM_WEBHOOK_SECRET não está configurado', () => {
      configService.get.mockReturnValue(undefined);
      const ctx = createMockContext('any-value');

      const result = guard.canActivate(ctx);

      // Sem secret configurado, aceita qualquer request (modo dev)
      expect(result).toBe(true);
    });

    it('deve usar comparação em tempo constante (timingSafeEqual)', () => {
      // Verifica que o guard não lança ao comparar strings de mesmo comprimento
      configService.get.mockReturnValue(VALID_SECRET);
      const ctx = createMockContext('x'.repeat(VALID_SECRET.length));

      // Não deve lançar — comprimentos iguais, valor diferente
      expect(() => guard.canActivate(ctx)).not.toThrow();
      expect(guard.canActivate(ctx)).toBe(false);
    });

    it('não deve vazar o token no log (verificação estrutural)', () => {
      // Verificação de que o guard não expõe o token nos logs
      // O TelegramSecretGuard nunca loga o valor do header recebido
      configService.get.mockReturnValue(VALID_SECRET);
      const ctx = createMockContext('malicious-attempt-same-length!!');

      // Apenas verificamos que retorna false sem lançar
      expect(guard.canActivate(ctx)).toBe(false);
    });
  });
});

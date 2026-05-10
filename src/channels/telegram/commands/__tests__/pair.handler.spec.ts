import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { PairHandler } from '../pair.handler';
import { CommandRegistryService } from '../../../core/command-registry.service';
import { PairingService } from '../../../core/pairing.service';

describe('PairHandler', () => {
  let handler: PairHandler;
  let commandRegistry: jest.Mocked<CommandRegistryService>;
  let pairingService: jest.Mocked<PairingService>;

  const CHAT_ID = BigInt(123456789);

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [
        PairHandler,
        {
          provide: CommandRegistryService,
          useValue: { register: jest.fn() },
        },
        {
          provide: PairingService,
          useValue: { consume: jest.fn() },
        },
      ],
    }).compile();

    handler = module.get(PairHandler);
    commandRegistry = module.get(CommandRegistryService);
    pairingService = module.get(PairingService);
  });

  it('deve instanciar corretamente', () => {
    expect(handler).toBeDefined();
  });

  it('deve ter commandName = "pair"', () => {
    expect(handler.commandName).toBe('pair');
  });

  it('deve se registrar no CommandRegistryService em onModuleInit', () => {
    handler.onModuleInit();
    expect(commandRegistry.register).toHaveBeenCalledWith(handler);
  });

  describe('handle()', () => {
    it('deve retornar erro se nenhum código for informado', async () => {
      const reply = await handler.handle(CHAT_ID, BigInt(0), []);
      expect(reply).toContain('Código não informado');
    });

    it('deve retornar erro se args estiver vazio', async () => {
      const reply = await handler.handle(CHAT_ID, BigInt(0), []);
      expect(reply).toContain('/pair <codigo>');
    });

    it('deve parear com sucesso quando token válido', async () => {
      const userId = BigInt(100);
      pairingService.consume.mockResolvedValue(userId);

      const reply = await handler.handle(CHAT_ID, BigInt(0), ['abc123def456']);

      expect(pairingService.consume).toHaveBeenCalledWith('abc123def456', {
        channelName: 'telegram',
        chatId: CHAT_ID,
      });
      expect(reply).toContain('vinculada com sucesso');
    });

    it('deve retornar erro quando token inválido (UnauthorizedException)', async () => {
      pairingService.consume.mockRejectedValue(
        new UnauthorizedException('Código de pareamento inválido ou expirado'),
      );

      const reply = await handler.handle(CHAT_ID, BigInt(0), ['codigo-invalido']);

      expect(reply).toContain('Código inválido ou expirado');
    });

    it('deve retornar erro quando token expirado', async () => {
      pairingService.consume.mockRejectedValue(
        new UnauthorizedException('Código de pareamento inválido ou expirado'),
      );

      const reply = await handler.handle(CHAT_ID, BigInt(0), ['token-expirado']);

      expect(reply).toContain('expirou');
    });

    it('deve retornar erro quando token já usado (second use)', async () => {
      // Primeiro uso: sucesso
      pairingService.consume.mockResolvedValueOnce(BigInt(100));
      const firstReply = await handler.handle(CHAT_ID, BigInt(0), ['a1b2c3d4e5f6']);
      expect(firstReply).toContain('sucesso');

      // Segundo uso: falha
      pairingService.consume.mockRejectedValueOnce(
        new UnauthorizedException('Código de pareamento inválido ou expirado'),
      );
      const secondReply = await handler.handle(CHAT_ID, BigInt(0), ['a1b2c3d4e5f6']);
      expect(secondReply).toContain('Código inválido ou expirado');
    });

    it('deve passar chatId como BigInt ao PairingService (nunca parseInt)', async () => {
      pairingService.consume.mockResolvedValue(BigInt(100));

      await handler.handle(CHAT_ID, BigInt(0), ['a1b2c3d4e5f6']);

      const callArg = pairingService.consume.mock.calls[0][1];
      expect(typeof callArg.chatId).toBe('bigint');
      expect(callArg.chatId).toBe(CHAT_ID);
    });

    it('deve trimmar o código antes de passar ao PairingService', async () => {
      pairingService.consume.mockResolvedValue(BigInt(100));

      await handler.handle(CHAT_ID, BigInt(0), ['  a1b2c3d4e5f6  ']);

      expect(pairingService.consume).toHaveBeenCalledWith('a1b2c3d4e5f6', expect.any(Object));
    });
  });
});

import { Test, TestingModule } from '@nestjs/testing';
import { UnauthorizedException } from '@nestjs/common';
import { PairingController } from '../pairing.controller';
import { PairingService } from '../core/pairing.service';
import { EntidadeService } from '../../entidades/entidades.service';
import { JwtPayload } from '../../auth/decorators/current-user.decorator';

describe('PairingController', () => {
  let controller: PairingController;
  let pairingService: { generate: jest.Mock; consume: jest.Mock };
  let entidadeService: { getEntidadeIdFromUserGroup: jest.Mock };

  const mockUser: JwtPayload = {
    sub: '999',
    entidadeId: '100',
    organizationId: '200',
    email: 'user@test.com',
  };

  const entidadeId = BigInt(100);

  beforeEach(async () => {
    pairingService = {
      generate: jest.fn(),
      consume: jest.fn(),
    };

    entidadeService = {
      getEntidadeIdFromUserGroup: jest.fn().mockResolvedValue(entidadeId),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [PairingController],
      providers: [
        { provide: PairingService, useValue: pairingService },
        { provide: EntidadeService, useValue: entidadeService },
      ],
    }).compile();

    controller = module.get<PairingController>(PairingController);
  });

  describe('generate', () => {
    it('deve retornar code e expiresAt em formato ISO string', async () => {
      const expiresAt = new Date('2026-05-10T12:30:00.000Z');
      pairingService.generate.mockResolvedValue({ code: 'a1b2c3d4e5f6', expiresAt });

      const result = await controller.generate(mockUser);

      expect(result.code).toBe('a1b2c3d4e5f6');
      expect(result.expiresAt).toBe('2026-05-10T12:30:00.000Z');
    });

    it('deve converter DUserGroup.chave → DEntidade.chave via EntidadeService', async () => {
      const expiresAt = new Date();
      pairingService.generate.mockResolvedValue({ code: 'aabbccddeeff', expiresAt });

      await controller.generate(mockUser);

      // EntidadeService deve ter sido chamado com BigInt(sub)
      expect(entidadeService.getEntidadeIdFromUserGroup).toHaveBeenCalledWith(BigInt(mockUser.sub));
      // PairingService.generate deve receber DEntidade.chave (não DUserGroup.chave)
      expect(pairingService.generate).toHaveBeenCalledWith(entidadeId);
    });

    it('deve propagar UnauthorizedException quando JWT está ausente (simulado sem user)', async () => {
      // Simular que o guard já bloqueou — testar que o service lança se algo falhar
      entidadeService.getEntidadeIdFromUserGroup.mockRejectedValue(
        new UnauthorizedException('JWT inválido'),
      );

      await expect(controller.generate(mockUser)).rejects.toThrow(UnauthorizedException);
    });
  });

  describe('link', () => {
    it('deve retornar { linked: true } quando consume tem sucesso', async () => {
      pairingService.consume.mockResolvedValue(entidadeId);

      const dto = { code: 'a1b2c3d4e5f6', channelName: 'telegram', chatId: '123456789' };
      const result = await controller.link(dto, mockUser);

      expect(result).toEqual({ linked: true });
    });

    it('deve chamar PairingService.consume com chatId como BigInt', async () => {
      pairingService.consume.mockResolvedValue(entidadeId);

      const dto = { code: 'a1b2c3d4e5f6', channelName: 'telegram', chatId: '123456789' };
      await controller.link(dto, mockUser);

      expect(pairingService.consume).toHaveBeenCalledWith('a1b2c3d4e5f6', {
        channelName: 'telegram',
        chatId: BigInt('123456789'),
      });
    });

    it('deve propagar UnauthorizedException quando código é inválido', async () => {
      pairingService.consume.mockRejectedValue(
        new UnauthorizedException('Código de pareamento inválido ou expirado'),
      );

      const dto = { code: 'invalidcode!', channelName: 'telegram', chatId: '123456789' };
      await expect(controller.link(dto, mockUser)).rejects.toThrow(UnauthorizedException);
    });
  });
});

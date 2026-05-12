import { Test, TestingModule } from '@nestjs/testing';
import { NotFoundException } from '@nestjs/common';

import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';
import { AuthCompositeGuard } from '../auth/guards/auth-composite.guard';

import { JwtPayload } from '../auth/decorators/current-user.decorator';

/**
 * Integration spec do InvitesController.
 *
 * Foco: rotas, mapeamento de DTOs, propagacao de erros do service.
 * Guard de auth e mockado (sempre permite). Guard de throttling
 * nao e exercido aqui (tipico de teste e2e — fora do escopo F-pos-F8).
 */
describe('InvitesController', () => {
  let controller: InvitesController;
  let serviceMock: jest.Mocked<
    Pick<InvitesService, 'createInvite' | 'getInviteByToken' | 'acceptInvite'>
  >;

  const fakeUser: JwtPayload = {
    sub: '1',
    entidadeId: '7',
    organizationId: '100',
    email: 'admin@x.com',
  };

  beforeEach(async () => {
    serviceMock = {
      createInvite: jest.fn(),
      getInviteByToken: jest.fn(),
      acceptInvite: jest.fn(),
    };

    const module: TestingModule = await Test.createTestingModule({
      controllers: [InvitesController],
      providers: [{ provide: InvitesService, useValue: serviceMock }],
    })
      .overrideGuard(AuthCompositeGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(InvitesController);
  });

  describe('POST /organizations/:orgId/invites', () => {
    it('cria convite via service e retorna 201 com info publica', async () => {
      serviceMock.createInvite.mockResolvedValue({
        id: '555',
        email: 'convidado@x.com',
        role: 'MEMBER',
        expiresAt: '2026-05-18T12:00:00.000Z',
      });

      const res = await controller.create(
        '100',
        { email: 'convidado@x.com', role: 'MEMBER' },
        fakeUser,
      );

      expect(serviceMock.createInvite).toHaveBeenCalledWith(
        '100',
        { email: 'convidado@x.com', role: 'MEMBER' },
        BigInt(7),
      );
      expect(res.id).toBe('555');
    });
  });

  describe('GET /invites/:token', () => {
    it('retorna info publica sanitizada', async () => {
      serviceMock.getInviteByToken.mockResolvedValue({
        orgName: 'Acme',
        inviterName: 'Joao Admin',
        email: 'convidado@x.com',
        role: 'MEMBER',
        expiresAt: '2026-05-18T12:00:00.000Z',
        flow: 'new_user',
      });

      const res = await controller.getInfo('valid-token');

      expect(serviceMock.getInviteByToken).toHaveBeenCalledWith('valid-token');
      expect(res.orgName).toBe('Acme');
    });

    it('propaga NotFoundException quando service rejeita (anti-enumeracao)', async () => {
      serviceMock.getInviteByToken.mockRejectedValue(new NotFoundException());
      await expect(controller.getInfo('invalid')).rejects.toThrow(NotFoundException);
    });
  });

  describe('POST /invites/:token/accept', () => {
    it('retorna AuthResponseDto + redirectTo apos auto-login', async () => {
      const sessionResp = {
        accessToken: 'jwt',
        refreshToken: 'refresh',
        expiresIn: 900,
        tokenType: 'Bearer' as const,
        user: {
          id: '900',
          entidadeId: '901',
          email: 'novo@x.com',
          name: 'Maria',
        },
        redirectTo: '/intentions',
      };
      serviceMock.acceptInvite.mockResolvedValue(sessionResp);

      const res = await controller.accept('valid-token', {
        name: 'Maria',
        password: 'senha123',
      });

      expect(serviceMock.acceptInvite).toHaveBeenCalledWith('valid-token', {
        name: 'Maria',
        password: 'senha123',
      });
      expect(res.redirectTo).toBe('/intentions');
      expect(res.accessToken).toBe('jwt');
    });
  });
});

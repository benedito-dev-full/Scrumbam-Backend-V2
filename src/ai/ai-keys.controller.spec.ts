import { Test } from '@nestjs/testing';
import { BadRequestException } from '@nestjs/common';
import { AiKeysController } from './ai-keys.controller';
import { AiKeysService } from './ai-keys.service';
import { AiProviderPrefService } from './ai-provider-pref.service';
import { OrgAdminGuard } from './guards/org-admin.guard';
import { AuthCompositeGuard } from '../auth/guards/auth-composite.guard';

/** Request fake com o `req.user` informado. */
function reqWith(user: { entidadeId: string; organizationId?: string }) {
  return { user } as { user: { entidadeId: string; organizationId?: string } };
}

describe('AiKeysController', () => {
  let controller: AiKeysController;
  let aiKeys: {
    upsertKey: jest.Mock;
    listKeys: jest.Mock;
    deleteKey: jest.Mock;
    getConfiguredMap: jest.Mock;
  };
  let pref: { getDefaultForOrg: jest.Mock; setDefaultForOrg: jest.Mock };

  const ADMIN_REQ = reqWith({ entidadeId: '900', organizationId: '152' });

  beforeEach(async () => {
    aiKeys = {
      upsertKey: jest.fn(),
      listKeys: jest.fn(),
      deleteKey: jest.fn().mockResolvedValue(undefined),
      getConfiguredMap: jest.fn(),
    };
    pref = { getDefaultForOrg: jest.fn(), setDefaultForOrg: jest.fn() };

    const module = await Test.createTestingModule({
      controllers: [AiKeysController],
      providers: [
        { provide: AiKeysService, useValue: aiKeys },
        { provide: AiProviderPrefService, useValue: pref },
      ],
    })
      // Guards nao sao exercitados nos testes unit do controller (testados em
      // org-admin.guard.spec). Sobrescrevemos para nao precisar do container auth.
      .overrideGuard(AuthCompositeGuard)
      .useValue({ canActivate: () => true })
      .overrideGuard(OrgAdminGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(AiKeysController);
  });

  describe('POST /ai/keys', () => {
    it('usa orgId do JWT (nunca do body) e devolve resposta mascarada', async () => {
      aiKeys.upsertKey.mockResolvedValue({
        provider: 'claude',
        prefix: 'sk-ant-',
        masked: 'sk-ant-…f3a9',
        configured: true,
      });

      const res = await controller.upsertKey(
        { provider: 'claude', key: 'sk-ant-secret-zzz' },
        ADMIN_REQ,
      );

      // orgId derivado do JWT (152), createdBy do JWT (900).
      expect(aiKeys.upsertKey).toHaveBeenCalledWith(
        BigInt(152),
        'claude',
        'sk-ant-secret-zzz',
        BigInt(900),
      );
      // resposta nunca contem plaintext.
      expect(JSON.stringify(res)).not.toContain('secret-zzz');
      expect((res as unknown as Record<string, unknown>).plaintext).toBeUndefined();
    });
  });

  describe('GET /ai/keys', () => {
    it('lista chaves mascaradas da org do JWT', async () => {
      aiKeys.listKeys.mockResolvedValue([
        { provider: 'gemini', prefix: 'AIza', masked: 'AIza…9xQ2', configured: true },
      ]);

      const res = await controller.listKeys(ADMIN_REQ);

      expect(aiKeys.listKeys).toHaveBeenCalledWith(BigInt(152));
      expect(JSON.stringify(res)).not.toMatch(/plaintext/);
    });
  });

  describe('DELETE /ai/keys/:provider', () => {
    it('valida o provider e delega com orgId do JWT', async () => {
      const res = await controller.deleteKey('openai', ADMIN_REQ);

      expect(aiKeys.deleteKey).toHaveBeenCalledWith(BigInt(152), 'openai');
      expect(res).toEqual({ deleted: true, provider: 'openai' });
    });

    it('rejeita (400) provider invalido no path', async () => {
      await expect(controller.deleteKey('bogus', ADMIN_REQ)).rejects.toBeInstanceOf(
        BadRequestException,
      );
      expect(aiKeys.deleteKey).not.toHaveBeenCalled();
    });
  });

  describe('GET /ai/providers (membro)', () => {
    it('expoe disponibilidade por provider sem chave', async () => {
      aiKeys.getConfiguredMap.mockResolvedValue({ gemini: true, claude: false, openai: false });

      const res = await controller.listProviders(reqWith({ entidadeId: '5', organizationId: '152' }));

      expect(res.providers).toEqual([
        { provider: 'gemini', configured: true },
        { provider: 'claude', configured: false },
        { provider: 'openai', configured: false },
      ]);
    });

    it('sem org ativa → tudo configured:false (nao quebra)', async () => {
      const res = await controller.listProviders(reqWith({ entidadeId: '5' }));

      expect(aiKeys.getConfiguredMap).not.toHaveBeenCalled();
      expect(res.providers.every((p) => p.configured === false)).toBe(true);
    });
  });

  describe('preference', () => {
    it('PUT /ai/preference delega setDefaultForOrg com orgId do JWT', async () => {
      pref.setDefaultForOrg.mockResolvedValue({ provider: 'claude', model: 'claude-sonnet-4-5' });

      const res = await controller.setPreference(
        { provider: 'claude', model: 'claude-sonnet-4-5' },
        ADMIN_REQ,
      );

      expect(pref.setDefaultForOrg).toHaveBeenCalledWith(BigInt(152), {
        provider: 'claude',
        model: 'claude-sonnet-4-5',
      });
      expect(res.provider).toBe('claude');
    });

    it('GET /ai/preference (membro) le a preferencia da org', async () => {
      pref.getDefaultForOrg.mockResolvedValue({ provider: 'gemini' });

      const res = await controller.getPreference(reqWith({ entidadeId: '5', organizationId: '152' }));

      expect(pref.getDefaultForOrg).toHaveBeenCalledWith(BigInt(152));
      expect(res).toEqual({ provider: 'gemini' });
    });

    it('GET /ai/preference sem org → null', async () => {
      const res = await controller.getPreference(reqWith({ entidadeId: '5' }));
      expect(res).toBeNull();
      expect(pref.getDefaultForOrg).not.toHaveBeenCalled();
    });
  });
});

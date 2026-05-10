import { UnauthorizedException } from '@nestjs/common';

import { McpKeysController } from '../mcp-keys.controller';

describe('McpKeysController', () => {
  let mcpKeyService: {
    generate: jest.Mock;
    list: jest.Mock;
    revoke: jest.Mock;
  };
  let entidadeService: {
    getEntidadeIdFromUserGroup: jest.Mock;
  };
  let controller: McpKeysController;

  beforeEach(() => {
    mcpKeyService = {
      generate: jest.fn().mockResolvedValue({ id: '1', plaintext: 'scrumban_mcp_x' }),
      list: jest.fn().mockResolvedValue([]),
      revoke: jest.fn().mockResolvedValue(undefined),
    };
    entidadeService = {
      getEntidadeIdFromUserGroup: jest.fn().mockResolvedValue(BigInt(200)),
    };
    controller = new McpKeysController(mcpKeyService as never, entidadeService as never);
  });

  it('converte DUserGroup.chave para DEntidade.chave antes de gerar key', async () => {
    await controller.create(
      { scopes: ['tools:read'] },
      { user: { sub: '100', entidadeId: 'wrong', organizationId: '', email: '' } } as never,
    );

    expect(entidadeService.getEntidadeIdFromUserGroup).toHaveBeenCalledWith(BigInt(100));
    expect(mcpKeyService.generate).toHaveBeenCalledWith(BigInt(200), ['tools:read']);
  });

  it('lista sem plaintext e revoga usando BigInt para IDs grandes', async () => {
    mcpKeyService.list.mockResolvedValue([
      {
        id: '1',
        prefix: 'scrumban_mcp',
        scopes: [],
        disabled: false,
        createdAt: '2026-05-10T12:00:00.000Z',
        lastUsedAt: null,
      },
    ]);

    const request = {
      user: { sub: '100', entidadeId: 'wrong', organizationId: '', email: '' },
    } as never;

    const list = await controller.list(request);
    await controller.revoke('9007199254740993', request);

    expect(JSON.stringify(list)).not.toContain('plaintext');
    expect(mcpKeyService.list).toHaveBeenCalledWith(BigInt(200));
    expect(mcpKeyService.revoke).toHaveBeenCalledWith(
      BigInt(200),
      BigInt('9007199254740993'),
    );
  });

  it('rejeita request sem JWT populado', async () => {
    await expect(controller.create({}, {} as never)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
  });
});

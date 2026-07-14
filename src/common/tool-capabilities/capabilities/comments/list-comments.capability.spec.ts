import { NotFoundException } from '@nestjs/common';

import { fromMcp, fromNexus } from '../../tool-principal';
import { CapabilityError } from '../../capability-error';
import { ListCommentsCapability } from './list-comments.capability';

/**
 * Onda 2 (bidirecionalidade) — `ListCommentsCapability`.
 *
 * Espelha o comportamento do wrapper legado Nexus
 * (`src/ai/tools/list-comments.tool.ts`): mesmos campos, mesmo default de
 * `limit`, mesmo shape de retorno `{ items, total, hasMore }`, mesma
 * chamada ao `CommentsService.findMany`.
 */
describe('ListCommentsCapability (Onda 2 — ADR-V2-079)', () => {
  const targetId = '777';
  const items = [
    { id: '1', texto: 'a', autorNome: 'Ana', createdAt: '2026-07-12T10:00:00.000Z' },
    { id: '2', texto: 'b', autorNome: 'Bia', createdAt: '2026-07-12T11:00:00.000Z' },
  ];

  let commentsService: { findMany: jest.Mock };
  let capability: ListCommentsCapability;

  beforeEach(() => {
    commentsService = { findMany: jest.fn().mockResolvedValue({ items, nextCursor: null }) };
    capability = new ListCommentsCapability(commentsService as never);
  });

  it('metadados: nome canonico, scope tasks:read', () => {
    expect(capability.name).toBe('list_comments');
    expect(capability.requiredScopes).toEqual(['tasks:read']);
    expect(capability.inputSchema).toMatchObject({
      type: 'object',
      required: ['targetType', 'targetId'],
    });
  });

  it('lista com limit default (20) quando omitido', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    const result = await capability.run({ targetType: 'task', targetId }, principal);

    expect(commentsService.findMany).toHaveBeenCalledWith(
      'task',
      targetId,
      { limit: 20 },
      BigInt(1),
      undefined,
    );
    expect(result).toEqual({
      data: {
        items: items.map((c) => ({
          id: c.id,
          texto: c.texto,
          autorNome: c.autorNome,
          createdAt: c.createdAt,
        })),
        total: 2,
        hasMore: false,
      },
    });
  });

  it('repassa limit customizado e organizationId (MCP)', async () => {
    const principal = fromMcp({
      actorEntidadeId: BigInt(1),
      scopes: ['tasks:read'],
      organizationId: BigInt(50),
    });

    await capability.run({ targetType: 'list', targetId: '999', limit: 5 }, principal);

    expect(commentsService.findMany).toHaveBeenCalledWith(
      'list',
      '999',
      { limit: 5 },
      BigInt(1),
      '50',
    );
  });

  it('hasMore=true quando nextCursor presente', async () => {
    commentsService.findMany.mockResolvedValue({ items, nextCursor: '999' });
    const principal = fromNexus({ actorEntidadeId: BigInt(5), grantedScopes: ['tasks:read'] });

    const result = await capability.run({ targetType: 'folder', targetId }, principal);

    expect((result.data as { hasMore: boolean }).hasMore).toBe(true);
  });

  it('targetType invalido → CapabilityError INVALID_INPUT, service nao chamado', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await expect(
      capability.run({ targetType: 'wiki', targetId }, principal),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', data: { field: 'targetType' } });
    expect(commentsService.findMany).not.toHaveBeenCalled();
  });

  it('limit fora do intervalo (1-50) → CapabilityError INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await expect(
      capability.run({ targetType: 'task', targetId, limit: 51 }, principal),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', data: { field: 'limit' } });
    expect(commentsService.findMany).not.toHaveBeenCalled();
  });

  it('limit nao-numerico → CapabilityError INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await expect(
      capability.run({ targetType: 'task', targetId, limit: 'muitos' }, principal),
    ).rejects.toBeInstanceOf(CapabilityError);
  });

  it('tenant: service lanca NotFound → propaga tal como', async () => {
    commentsService.findMany.mockRejectedValue(new NotFoundException('Alvo nao encontrado'));
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:read'] });

    await expect(
      capability.run({ targetType: 'task', targetId }, principal),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});

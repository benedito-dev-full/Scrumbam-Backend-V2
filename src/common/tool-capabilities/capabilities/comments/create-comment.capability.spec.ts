import { ForbiddenException, NotFoundException } from '@nestjs/common';

import { fromMcp, fromNexus } from '../../tool-principal';
import { CapabilityError } from '../../capability-error';
import { CreateCommentCapability } from './create-comment.capability';

/**
 * Onda 2 (bidirecionalidade) — `CreateCommentCapability`.
 *
 * Espelha o comportamento do wrapper legado Nexus
 * (`src/ai/tools/create-comment.tool.ts`) para provar paridade 1:1: mesmos
 * campos, mesmas validacoes, mesmo shape de retorno, mesma chamada ao
 * `CommentsService.create`. Cobre tambem o `principal` MCP (organizationId
 * repassado como string) e a ausencia de organizationId.
 */
describe('CreateCommentCapability (Onda 2 — ADR-V2-079)', () => {
  const targetId = '777';
  const comment = { id: '1001', texto: 'LGTM!', targetType: 'task', targetId, autorId: '42', autorNome: 'Ana', createdAt: '2026-07-12T10:00:00.000Z' };

  let commentsService: { create: jest.Mock };
  let capability: CreateCommentCapability;

  beforeEach(() => {
    commentsService = { create: jest.fn().mockResolvedValue(comment) };
    capability = new CreateCommentCapability(commentsService as never);
  });

  it('metadados: nome canonico, scope tasks:write', () => {
    expect(capability.name).toBe('create_comment');
    expect(capability.requiredScopes).toEqual(['tasks:write']);
    expect(capability.inputSchema).toMatchObject({
      type: 'object',
      required: ['targetType', 'targetId', 'texto'],
    });
  });

  it('cria comentario em task com organizationId (MCP) → delega ao service e devolve shape esperado', async () => {
    const principal = fromMcp({
      actorEntidadeId: BigInt(42),
      scopes: ['tasks:write'],
      organizationId: BigInt(50),
    });

    const result = await capability.run(
      { targetType: 'task', targetId, texto: 'LGTM!' },
      principal,
    );

    expect(commentsService.create).toHaveBeenCalledWith(
      'task',
      targetId,
      { texto: 'LGTM!' },
      BigInt(42),
      '50',
    );
    expect(result).toEqual({
      data: { success: true, commentId: comment.id, targetType: 'task', targetId },
    });
  });

  it('sem organizationId (Nexus sem org ativa) → repassa undefined ao service', async () => {
    const principal = fromNexus({ actorEntidadeId: BigInt(5), grantedScopes: ['tasks:write'] });

    await capability.run({ targetType: 'project', targetId: '999', texto: 'ok' }, principal);

    expect(commentsService.create).toHaveBeenCalledWith(
      'project',
      '999',
      { texto: 'ok' },
      BigInt(5),
      undefined,
    );
  });

  it('targetType normaliza para lowercase (aceita "TASK")', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:write'] });

    await capability.run({ targetType: 'TASK', targetId, texto: 'x' }, principal);

    expect(commentsService.create).toHaveBeenCalledWith(
      'task',
      targetId,
      { texto: 'x' },
      BigInt(1),
      undefined,
    );
  });

  it('targetType invalido → CapabilityError INVALID_INPUT, service nao chamado', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:write'] });

    await expect(
      capability.run({ targetType: 'wiki', targetId, texto: 'x' }, principal),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', data: { field: 'targetType' } });
    expect(commentsService.create).not.toHaveBeenCalled();
  });

  it('targetId ausente → CapabilityError INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:write'] });

    await expect(
      capability.run({ targetType: 'task', texto: 'x' }, principal),
    ).rejects.toBeInstanceOf(CapabilityError);
    expect(commentsService.create).not.toHaveBeenCalled();
  });

  it('texto vazio → CapabilityError INVALID_INPUT', async () => {
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:write'] });

    await expect(
      capability.run({ targetType: 'task', targetId, texto: '   ' }, principal),
    ).rejects.toMatchObject({ code: 'INVALID_INPUT', data: { field: 'texto' } });
  });

  it('tenant: service lanca NotFound → propaga tal como', async () => {
    commentsService.create.mockRejectedValue(new NotFoundException('Alvo nao encontrado'));
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:write'] });

    await expect(
      capability.run({ targetType: 'task', targetId, texto: 'x' }, principal),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('tenant: service lanca Forbidden → propaga tal como', async () => {
    commentsService.create.mockRejectedValue(new ForbiddenException('Sem acesso'));
    const principal = fromMcp({ actorEntidadeId: BigInt(1), scopes: ['tasks:write'] });

    await expect(
      capability.run({ targetType: 'task', targetId, texto: 'x' }, principal),
    ).rejects.toBeInstanceOf(ForbiddenException);
  });
});

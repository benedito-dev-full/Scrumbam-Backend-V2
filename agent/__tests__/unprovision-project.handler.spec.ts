/**
 * Specs do handler `UNPROVISION_PROJECT`.
 */
import type { Request, Response } from 'express';
import pino from 'pino';
import { createUnprovisionProjectHandler } from '../src/handlers/unprovision-project.handler';

const CLAUDE_MD_PATH = '/home/dev/.claude/CLAUDE.md';

function silentLogger() {
  return pino({ level: 'silent' });
}

function invokeHandler(
  body: Record<string, unknown>,
  removeImpl: jest.Mock = jest.fn(() => Promise.resolve()),
) {
  const json = jest.fn();
  const status = jest.fn(() => ({ json }));

  const handler = createUnprovisionProjectHandler({
    logger: silentLogger(),
    claudeMdPath: CLAUDE_MD_PATH,
    removeImpl: removeImpl as never,
  });

  handler({ body } as Request, { status } as unknown as Response);
  return { status, json, removeImpl };
}

describe('UNPROVISION_PROJECT handler', () => {
  it('slug válido: removeImpl chamado com (slug, claudeMdPath), response 200', async () => {
    const removeImpl = jest.fn(() => Promise.resolve());
    const { status, json } = invokeHandler({ projectSlug: 'meu-proj' }, removeImpl);

    // Aguardar resolução da promise
    await new Promise<void>((r) => setImmediate(r));

    expect(removeImpl).toHaveBeenCalledTimes(1);
    expect(removeImpl).toHaveBeenCalledWith('meu-proj', CLAUDE_MD_PATH);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ accepted: true });
  });

  it('slug inválido: 422 sem chamar removeImpl', () => {
    const removeImpl = jest.fn();
    const { status, json } = invokeHandler({ projectSlug: '!invalid slug!' }, removeImpl);

    expect(status).toHaveBeenCalledWith(422);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({ accepted: false, errorCode: 'INVALID_SLUG' }),
    );
    expect(removeImpl).not.toHaveBeenCalled();
  });

  it('falha do removeImpl: 500 com errorCode CLAUDE_MD_WRITE_ERROR', async () => {
    const removeImpl = jest.fn(() => Promise.reject(new Error('permissão negada')));
    const { status, json } = invokeHandler({ projectSlug: 'meu-proj' }, removeImpl);

    await new Promise<void>((r) => setImmediate(r));

    expect(status).toHaveBeenCalledWith(500);
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        accepted: false,
        errorCode: 'CLAUDE_MD_WRITE_ERROR',
        message: 'permissão negada',
      }),
    );
  });

  it('slug não existente no CLAUDE.md: 200 (idempotente)', async () => {
    // removeProjectEntry trata silenciosamente slugs inexistentes — aqui o mock
    // simula esse comportamento (resolve sem erro)
    const removeImpl = jest.fn(() => Promise.resolve());
    const { status, json } = invokeHandler({ projectSlug: 'inexistente' }, removeImpl);

    await new Promise<void>((r) => setImmediate(r));

    expect(removeImpl).toHaveBeenCalledTimes(1);
    expect(status).toHaveBeenCalledWith(200);
    expect(json).toHaveBeenCalledWith({ accepted: true });
  });
});

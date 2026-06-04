import { ExecutionContext } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { WsJwtGuard } from '../ws-jwt.guard';

/**
 * Cria um ExecutionContext WS falso que devolve o `client` informado.
 */
function makeContext(client: unknown): ExecutionContext {
  return {
    switchToWs: () => ({ getClient: () => client }),
  } as unknown as ExecutionContext;
}

describe('WsJwtGuard', () => {
  let guard: WsJwtGuard;
  let jwtService: { verifyAsync: jest.Mock };
  let config: { get: jest.Mock };

  const payload = {
    sub: '10',
    entidadeId: '20',
    organizationId: '30',
    email: 'user@test.com',
  };

  beforeEach(() => {
    jwtService = { verifyAsync: jest.fn() };
    config = { get: jest.fn().mockReturnValue('test-secret') };
    guard = new WsJwtGuard(
      jwtService as unknown as JwtService,
      config as unknown as ConfigService,
    );
  });

  it('aceita token via handshake.auth.token e popula client.data.user', async () => {
    jwtService.verifyAsync.mockResolvedValue(payload);
    const client = { handshake: { auth: { token: 'valid-token' }, headers: {} }, data: {} };

    const result = await guard.canActivate(makeContext(client));

    expect(result).toBe(true);
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('valid-token', {
      secret: 'test-secret',
    });
    expect(client.data).toEqual({ user: payload });
  });

  it('aceita token via header Authorization Bearer e popula client.data.user', async () => {
    jwtService.verifyAsync.mockResolvedValue(payload);
    const client = {
      handshake: { auth: {}, headers: { authorization: 'Bearer header-token' } },
      data: {},
    };

    const result = await guard.canActivate(makeContext(client));

    expect(result).toBe(true);
    expect(jwtService.verifyAsync).toHaveBeenCalledWith('header-token', {
      secret: 'test-secret',
    });
    expect((client.data as { user: unknown }).user).toEqual(payload);
  });

  it('prioriza handshake.auth.token sobre o header', async () => {
    jwtService.verifyAsync.mockResolvedValue(payload);
    const client = {
      handshake: {
        auth: { token: 'auth-token' },
        headers: { authorization: 'Bearer header-token' },
      },
      data: {},
    };

    await guard.canActivate(makeContext(client));

    expect(jwtService.verifyAsync).toHaveBeenCalledWith('auth-token', {
      secret: 'test-secret',
    });
  });

  it('lança WsException quando não há token', async () => {
    const client = { handshake: { auth: {}, headers: {} }, data: {} };

    await expect(guard.canActivate(makeContext(client))).rejects.toBeInstanceOf(WsException);
    expect(jwtService.verifyAsync).not.toHaveBeenCalled();
  });

  it('lança WsException quando o token é inválido', async () => {
    jwtService.verifyAsync.mockRejectedValue(new Error('jwt expired'));
    const client = { handshake: { auth: { token: 'bad' }, headers: {} }, data: {} };

    await expect(guard.canActivate(makeContext(client))).rejects.toBeInstanceOf(WsException);
  });
});

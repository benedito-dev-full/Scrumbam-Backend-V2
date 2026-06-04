import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { WsException } from '@nestjs/websockets';
import { Socket } from 'socket.io';
import { JwtPayload } from '../auth/decorators/current-user.decorator';

/**
 * Guard de autenticação para o canal WebSocket (`/realtime`).
 *
 * Valida o JWT do handshake reusando o MESMO `JwtService` e `JWT_SECRET`
 * da autenticação HTTP (AuthModule) — nunca re-registra JwtModule nem
 * hardcoda o secret. Em sucesso, popula `client.data.user` com o
 * {@link JwtPayload} decodificado, espelhando o `req.user` do HTTP.
 *
 * Transporte do token (DUAS vias, nesta ordem de precedência):
 * 1. `client.handshake.auth.token` — forma idiomática do Socket.io
 *    (`io(url, { auth: { token } })`).
 * 2. Header `Authorization: Bearer <token>` — fallback para clientes que
 *    enviam o token via header HTTP no upgrade.
 *
 * @see jwt.strategy.ts — equivalente HTTP (mesmo secret, mesmo payload)
 * @see RealtimeGateway — consome `client.data.user` nos handlers
 */
@Injectable()
export class WsJwtGuard implements CanActivate {
  private readonly logger = new Logger(WsJwtGuard.name);

  constructor(
    private readonly jwtService: JwtService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Valida o JWT do handshake WebSocket.
   *
   * @param context - Contexto de execução (esperado: WS).
   * @returns `true` quando o token é válido (e popula `client.data.user`).
   * @throws {WsException} Quando o token está ausente ou é inválido/expirado.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const client = context.switchToWs().getClient<Socket>();
    const token = this.extractToken(client);

    if (!token) {
      this.logger.debug('Handshake WS sem token — recusado');
      throw new WsException('Unauthorized');
    }

    try {
      const payload = await this.jwtService.verifyAsync<JwtPayload>(token, {
        secret: this.config.get<string>('JWT_SECRET'),
      });
      client.data.user = payload;
      return true;
    } catch (err) {
      this.logger.debug(
        `Handshake WS com token inválido: ${err instanceof Error ? err.message : 'erro'}`,
      );
      throw new WsException('Unauthorized');
    }
  }

  /**
   * Extrai o token do handshake — `auth.token` primeiro, header depois.
   *
   * @param client - Socket conectado.
   * @returns O token sem o prefixo `Bearer `, ou `null` se ausente.
   */
  private extractToken(client: Socket): string | null {
    const authToken = client.handshake?.auth?.token;
    if (typeof authToken === 'string' && authToken.length > 0) {
      return authToken.startsWith('Bearer ') ? authToken.slice(7) : authToken;
    }

    const header = client.handshake?.headers?.authorization;
    if (typeof header === 'string' && header.startsWith('Bearer ')) {
      return header.slice(7);
    }

    return null;
  }
}

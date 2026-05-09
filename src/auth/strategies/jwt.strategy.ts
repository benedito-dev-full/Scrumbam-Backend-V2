import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { JwtPayload } from '../decorators/current-user.decorator';

/**
 * Estratégia Passport JWT para validação de access tokens.
 *
 * Extrai o Bearer token do header Authorization e valida a assinatura
 * com JWT_SECRET. O payload validado é anexado em `req.user`.
 *
 * Campos do payload JWT (todos como string para evitar BigInt serialization):
 * - sub: DUserGroup.chave.toString()
 * - entidadeId: DEntidade.chave.toString()
 * - organizationId: DEntidade(-152).chave.toString()
 * - email: DUserGroup.usuario
 *
 * @see JwtAuthGuard — guard que usa esta strategy
 * @see AuthService.login — gera o JWT com este payload
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(configService: ConfigService) {
    const secret = configService.get<string>('JWT_SECRET');
    if (!secret) {
      throw new Error('JWT_SECRET não configurado. Adicione ao .env');
    }

    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: secret,
    });
  }

  /**
   * Valida o payload JWT e o retorna como `req.user`.
   *
   * Chamado pelo Passport após verificar a assinatura JWT.
   * Validações adicionais (blacklist, versão de token) podem ser
   * adicionadas aqui em F14 (Hardening).
   *
   * @param payload - Payload JWT decodificado e verificado
   * @returns JwtPayload que será anexado em req.user
   * @throws {UnauthorizedException} Se payload inválido ou incompleto
   */
  validate(payload: JwtPayload): JwtPayload {
    this.logger.debug(`JWT validate sub=${payload.sub}`);

    if (!payload.sub || !payload.entidadeId) {
      throw new UnauthorizedException('Token JWT inválido: campos obrigatórios ausentes');
    }

    return payload;
  }
}

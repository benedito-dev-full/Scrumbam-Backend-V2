import { Injectable, Logger, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import { PrismaService } from '../../prisma.service';
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
 * ADR-V2-030: alem de validar a assinatura, valida que a DVincula
 * `(entidadeId, organizationId)` ainda esta ATIVA. Se admin removeu o
 * usuario da org enquanto o JWT ainda nao expirou, o proximo request
 * retorna 401 — minimizando janela de membership stale.
 *
 * @see JwtAuthGuard — guard que usa esta strategy
 * @see AuthService.login — gera o JWT com este payload
 */
@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  private readonly logger = new Logger(JwtStrategy.name);

  constructor(
    configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {
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
   * Chamado pelo Passport após verificar a assinatura JWT. Faz uma query
   * adicional para confirmar que a DVincula `(entidadeId, organizationId)`
   * continua ativa — protege contra tokens emitidos antes de uma remocao
   * de membership (ADR-V2-030).
   *
   * Performance: query indexada (~1-2ms). Aceitavel para validar 1x por
   * request.
   *
   * @param payload - Payload JWT decodificado e verificado.
   * @returns JwtPayload que será anexado em req.user.
   * @throws {UnauthorizedException} Se payload invalido ou membership removida.
   */
  async validate(payload: JwtPayload): Promise<JwtPayload> {
    if (!payload.sub || !payload.entidadeId) {
      throw new UnauthorizedException('Token JWT inválido: campos obrigatórios ausentes');
    }

    // ÓRFÃO (ADR-V2-038): JWT sem `organizationId` é estado VÁLIDO.
    // Pula re-validacao de DVincula porque nao ha membership para verificar.
    // O `RequireWorkspaceGuard` (acionado dentro do `AuthCompositeGuard`)
    // decide se a rota aceita JWT orfao via `@AllowOrphan()`; caso contrario
    // responde 403 `{ code: 'NO_WORKSPACE' }`.
    if (!payload.organizationId) {
      this.logger.debug(`JWT validate sub=${payload.sub} (ÓRFÃO) OK`);
      return payload;
    }

    // Re-validar membership a cada request (ADR-V2-030).
    // Se o usuario foi removido da org, o JWT vira invalido no proximo
    // request — sem precisar invalidar JWT explicitamente.
    let entidadeIdBig: bigint;
    let orgIdBig: bigint;
    try {
      entidadeIdBig = BigInt(payload.entidadeId);
      orgIdBig = BigInt(payload.organizationId);
    } catch {
      throw new UnauthorizedException('Token JWT inválido: ids malformados');
    }

    const membership = await this.prisma.dVincula.findFirst({
      where: {
        idEntidade: entidadeIdBig,
        idLocEscritu: orgIdBig,
        idClasse: { in: [BigInt(-161), BigInt(-162), BigInt(-163)] },
        excluido: false,
      },
      select: { chave: true },
    });
    if (!membership) {
      this.logger.warn(
        `JWT rejeitado: membership inativa entidadeId=${payload.entidadeId} orgId=${payload.organizationId}`,
      );
      throw new UnauthorizedException('Membership inválida ou removida');
    }

    this.logger.debug(`JWT validate sub=${payload.sub} org=${payload.organizationId} OK`);
    return payload;
  }
}

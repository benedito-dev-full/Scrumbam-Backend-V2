import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { PrismaService } from '../../prisma.service';
import { TEAM_ROLES_KEY, TeamRole } from '../decorators/team-roles.decorator';

/** idClasse DVincula para membership de time (seed F1). */
const ID_CLASSE_TEAM_MEMBERSHIP = BigInt(-181);

/**
 * Guard de roles de time (implementação F5).
 *
 * Verifica se o usuário autenticado é membro do time e tem o cargo
 * necessário para executar a operação.
 *
 * Mecanismo:
 * 1. Lê o `teamId` de `request.params.id`, `request.params.teamId` ou `request.body.teamId`
 * 2. Busca DVincula idClasse=-181 WHERE idLocEscritu=teamId AND idEntidade=userEntidadeId
 * 3. Lê o cargo de `metaDados.cargo` (LEAD ou MEMBER)
 * 4. Compara com roles exigidos pelo decorator @TeamRoles()
 *
 * Se @TeamRoles() não estiver presente no endpoint, o guard permite acesso
 * (compatibilidade com endpoints que só requerem membership, não cargo específico).
 *
 * @see TEAM_ROLES_KEY — chave do metadata
 * @see TeamRoles — decorator correspondente
 * @see DVincula (-181 TEAM_MEMBERSHIP) — fonte de verdade dos cargos
 */
@Injectable()
export class TeamRolesGuard implements CanActivate {
  private readonly logger = new Logger(TeamRolesGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Verifica role do usuário no time.
   *
   * @param context - Contexto de execução NestJS
   * @returns true se autorizado, lança ForbiddenException caso contrário
   *
   * @throws {UnauthorizedException} Se usuário não autenticado no request
   * @throws {ForbiddenException} Se usuário não é membro do time ou não tem o cargo exigido
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{
      user?: { entidadeId?: string };
      params?: Record<string, string>;
      body?: Record<string, unknown>;
    }>();

    const user = request.user;
    if (!user?.entidadeId) {
      throw new UnauthorizedException('Usuário não autenticado');
    }

    const userEntidadeId = BigInt(user.entidadeId);

    // Resolver teamId dos params ou body
    const teamId = this.resolveTeamId(request);
    if (!teamId) {
      this.logger.debug('TeamRolesGuard: teamId não encontrado nos params/body — permitindo acesso');
      return true;
    }

    const teamIdBigInt = BigInt(teamId);

    // Buscar membership do usuário no time
    const membership = await this.prisma.dVincula.findFirst({
      where: {
        idClasse: ID_CLASSE_TEAM_MEMBERSHIP,
        idLocEscritu: teamIdBigInt,
        idEntidade: userEntidadeId,
        excluido: false,
      },
      select: {
        chave: true,
        metaDados: true,
      },
    });

    if (!membership) {
      this.logger.debug(
        `TeamRolesGuard: usuário ${userEntidadeId} não é membro do time ${teamIdBigInt}`,
      );
      throw new ForbiddenException('Acesso negado: você não é membro deste time');
    }

    // Verificar roles exigidos pelo decorator @TeamRoles()
    const requiredRoles = this.reflector.getAllAndOverride<TeamRole[]>(TEAM_ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    // Se não há roles exigidos, membership já é suficiente
    if (!requiredRoles || requiredRoles.length === 0) {
      this.logger.debug(
        `TeamRolesGuard: sem roles específicos — membership de ${userEntidadeId} no time ${teamIdBigInt} aceita`,
      );
      return true;
    }

    // Ler cargo do metaDados
    const metaDados = membership.metaDados as Record<string, unknown> | null;
    const cargo = metaDados?.cargo as TeamRole | undefined;

    if (!cargo) {
      this.logger.warn(
        `TeamRolesGuard: membership de ${userEntidadeId} no time ${teamIdBigInt} sem cargo em metaDados`,
      );
      throw new ForbiddenException('Acesso negado: cargo não definido no membership');
    }

    const hasRole = requiredRoles.includes(cargo);
    if (!hasRole) {
      this.logger.debug(
        `TeamRolesGuard: cargo "${cargo}" não está nos roles exigidos [${requiredRoles.join(', ')}]`,
      );
      throw new ForbiddenException(
        `Acesso negado: requer cargo ${requiredRoles.join(' ou ')} — seu cargo é ${cargo}`,
      );
    }

    this.logger.debug(
      `TeamRolesGuard: usuário ${userEntidadeId} autorizado no time ${teamIdBigInt} com cargo ${cargo}`,
    );
    return true;
  }

  /**
   * Resolve o teamId a partir dos params ou body do request.
   *
   * Tenta em ordem:
   * 1. request.params.id (rota /teams/:id)
   * 2. request.params.teamId (rota genérica com :teamId)
   * 3. request.body.teamId (body da requisição)
   *
   * @param request - Request HTTP
   * @returns teamId como string, ou undefined se não encontrado
   */
  private resolveTeamId(
    request: {
      params?: Record<string, string>;
      body?: Record<string, unknown>;
    },
  ): string | undefined {
    if (request.params?.teamId) {
      return request.params.teamId;
    }
    if (request.params?.id) {
      return request.params.id;
    }
    if (request.body?.teamId && typeof request.body.teamId === 'string') {
      return request.body.teamId;
    }
    return undefined;
  }
}

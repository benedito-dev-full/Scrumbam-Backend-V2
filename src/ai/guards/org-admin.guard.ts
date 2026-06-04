import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

/**
 * idClasse DVincula do papel ADMIN de org (seed F1, ADR-V2-003).
 *
 * Mesmo valor usado em `OrganizationsService` (RBAC org via DVincula:
 * ADMIN=-161, MEMBER=-162, VIEWER=-163).
 */
const ID_CLASSE_ORG_ADMIN = BigInt(-161);

/** Shape do `req.user` injetado pelo `AuthCompositeGuard`. */
interface JwtUser {
  entidadeId: string;
  organizationId?: string;
}

/**
 * Guard que exige que o usuario autenticado seja ADMIN da org ativa (JWT).
 *
 * Roda DEPOIS do `AuthCompositeGuard` (que popula `req.user`). Verifica a
 * existencia de um vinculo DVincula ADMIN (-161) entre o usuario e a org.
 *
 * **Direcao dos campos do DVincula -161 (confirmada em
 * `OrganizationsService.requireAdminRole`):**
 *  - `idLocEscritu` = ORG (dono do vinculo — DEntidade -152).
 *  - `idEntidade`   = USER (DEntidade do usuario).
 *  - `idClasse`     = -161 (papel ADMIN).
 *
 * Errar a direcao desligaria o gate — por isso ela espelha EXATAMENTE o RBAC
 * existente das organizacoes (nao a sugestao invertida do plano).
 *
 * Sem `organizationId` no JWT → `BadRequestException` (chave de org exige org
 * ativa; e um erro de uso, nao de permissao). Sem vinculo ADMIN →
 * `ForbiddenException` (403).
 *
 * Reuso: investigou-se `src/organizations/`, `src/auth/`, `src/common/` — nao
 * havia guard reutilizavel (o RBAC ADMIN das orgs mora num helper PRIVADO de
 * service, `requireAdminRole`, nao exposto como guard). Este guard e a primeira
 * extracao desse padrao para a camada HTTP.
 *
 * @see OrganizationsService.requireAdminRole — fonte da direcao dos campos.
 * @see AuthCompositeGuard — popula `req.user` (deve rodar antes).
 */
@Injectable()
export class OrgAdminGuard implements CanActivate {
  private readonly logger = new Logger(OrgAdminGuard.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Permite a requisicao apenas se o usuario for ADMIN da org do JWT.
   *
   * @param context - Contexto de execucao NestJS.
   * @returns `true` quando ha vinculo ADMIN (-161) usuario↔org.
   *
   * @throws {BadRequestException} JWT sem `organizationId` (org ativa ausente).
   * @throws {ForbiddenException} Usuario nao e ADMIN da org.
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<{ user?: JwtUser }>();
    const user = request.user;

    if (!user || !user.entidadeId) {
      // AuthCompositeGuard deveria ter populado; defesa em profundidade.
      throw new ForbiddenException('Autenticacao necessaria');
    }

    if (!user.organizationId) {
      throw new BadRequestException(
        'Operacao requer uma organizacao ativa (selecione um workspace)',
      );
    }

    const orgId = BigInt(user.organizationId);
    const userEntidadeId = BigInt(user.entidadeId);

    const vinculo = await this.prisma.dVincula.findFirst({
      where: {
        idLocEscritu: orgId, // ORG (dono do vinculo)
        idEntidade: userEntidadeId, // USER
        idClasse: ID_CLASSE_ORG_ADMIN, // -161
        excluido: false,
      },
      select: { chave: true },
    });

    if (!vinculo) {
      this.logger.warn(
        `org_admin_denied user=${userEntidadeId.toString()} org=${orgId.toString()}`,
      );
      throw new ForbiddenException('Acesso negado: requer papel ADMIN na organizacao');
    }

    return true;
  }
}

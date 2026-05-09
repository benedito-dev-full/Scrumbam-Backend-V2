import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { LRUCache } from '../../common/helpers/lru-cache';
import { OrgRole } from '../decorators/roles.decorator';

/** idClasses de roles de organização (ADR-V2-003). */
const ORG_ROLE_CLASSES = {
  ADMIN: BigInt(-161),
  MEMBER: BigInt(-162),
  VIEWER: BigInt(-163),
};

/** idClasses de roles de projeto (ADR-V2-003). */
const PROJECT_ROLE_CLASSES = {
  MANAGER: BigInt(-171),
  MEMBER: BigInt(-172),
  VIEWER: BigInt(-173),
};

/** Tipo de role de projeto. */
export type ProjectRole = 'MANAGER' | 'MEMBER' | 'VIEWER';

/**
 * Service para resolução de roles via DVincula (N+1 ZERO + LRU cache).
 *
 * Implementa RBAC duplo (ADR-V2-003):
 * - Org roles: ADMIN(-161), MEMBER(-162), VIEWER(-163)
 * - Project roles: MANAGER(-171), MEMBER(-172), VIEWER(-173)
 *
 * Performance:
 * - 1 query por resolução de role
 * - LRU cache TTL 5min, 1000 entradas máx
 * - @@index([idLocEscritu, idClasse]) em DVincula já existe (schema F1)
 *
 * @see DVincula — tabela consultada para resolução de roles
 * @see RolesGuard — usa getOrgRole para validar acesso
 */
@Injectable()
export class RoleResolverService {
  private readonly logger = new Logger(RoleResolverService.name);

  /** Cache LRU de roles: key = `org:${orgId}:${userId}`, value = OrgRole|null */
  private readonly orgRoleCache = new LRUCache<string, OrgRole | null>(1000, 300_000);

  /** Cache LRU de project roles: key = `proj:${projId}:${userId}`, value = ProjectRole|null */
  private readonly projectRoleCache = new LRUCache<string, ProjectRole | null>(1000, 300_000);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Retorna o role do usuário na organização.
   *
   * 1 query ao banco (DVincula com IN list de 3 idClasses).
   * Resultado cacheado por 5min.
   *
   * @param userId - Chave BigInt da DEntidade (-150 USER)
   * @param orgId - Chave BigInt da DEntidade (-152 ORGANIZATION)
   * @returns 'ADMIN' | 'MEMBER' | 'VIEWER' ou null se sem vínculo
   */
  async getOrgRole(userId: bigint, orgId: bigint): Promise<OrgRole | null> {
    const cacheKey = `org:${orgId}:${userId}`;
    const cached = this.orgRoleCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    this.logger.debug(`getOrgRole userId=${userId} orgId=${orgId}`);

    const vinculo = await this.prisma.dVincula.findFirst({
      where: {
        idLocEscritu: orgId,
        idEntidade: userId,
        idClasse: {
          in: [
            ORG_ROLE_CLASSES.ADMIN,
            ORG_ROLE_CLASSES.MEMBER,
            ORG_ROLE_CLASSES.VIEWER,
          ],
        },
        excluido: false,
      },
      select: { idClasse: true },
    });

    let role: OrgRole | null = null;
    if (vinculo) {
      if (vinculo.idClasse === ORG_ROLE_CLASSES.ADMIN) role = 'ADMIN';
      else if (vinculo.idClasse === ORG_ROLE_CLASSES.MEMBER) role = 'MEMBER';
      else if (vinculo.idClasse === ORG_ROLE_CLASSES.VIEWER) role = 'VIEWER';
    }

    this.orgRoleCache.set(cacheKey, role);
    return role;
  }

  /**
   * Retorna o role do usuário no projeto.
   *
   * @param userId - Chave BigInt da DEntidade (-150 USER)
   * @param projectId - Chave BigInt do DProject
   * @returns 'MANAGER' | 'MEMBER' | 'VIEWER' ou null se sem vínculo
   */
  async getProjectRole(userId: bigint, projectId: bigint): Promise<ProjectRole | null> {
    const cacheKey = `proj:${projectId}:${userId}`;
    const cached = this.projectRoleCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }

    this.logger.debug(`getProjectRole userId=${userId} projectId=${projectId}`);

    const vinculo = await this.prisma.dVincula.findFirst({
      where: {
        idLocEscritu: projectId,
        idEntidade: userId,
        idClasse: {
          in: [
            PROJECT_ROLE_CLASSES.MANAGER,
            PROJECT_ROLE_CLASSES.MEMBER,
            PROJECT_ROLE_CLASSES.VIEWER,
          ],
        },
        excluido: false,
      },
      select: { idClasse: true },
    });

    let role: ProjectRole | null = null;
    if (vinculo) {
      if (vinculo.idClasse === PROJECT_ROLE_CLASSES.MANAGER) role = 'MANAGER';
      else if (vinculo.idClasse === PROJECT_ROLE_CLASSES.MEMBER) role = 'MEMBER';
      else if (vinculo.idClasse === PROJECT_ROLE_CLASSES.VIEWER) role = 'VIEWER';
    }

    this.projectRoleCache.set(cacheKey, role);
    return role;
  }

  /**
   * Invalida entradas de cache relacionadas a um usuário.
   *
   * Chamado ao criar ou remover DVincula (role change).
   * Força nova consulta ao banco na próxima request.
   *
   * @param userId - Chave BigInt da DEntidade (-150 USER)
   * @param orgId - Chave BigInt da org (opcional — se ausente, limpa só project)
   * @param projectId - Chave BigInt do projeto (opcional)
   */
  invalidateUser(userId: bigint, orgId?: bigint, projectId?: bigint): void {
    if (orgId) {
      this.orgRoleCache.delete(`org:${orgId}:${userId}`);
    }
    if (projectId) {
      this.projectRoleCache.delete(`proj:${projectId}:${userId}`);
    }
    this.logger.debug(`Cache invalidado para userId=${userId}`);
  }
}

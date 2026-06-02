import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { LRUCache } from '../../common/helpers/lru-cache';
import { OrgRole } from '../decorators/roles.decorator';
import { isProjectPubliclyVisible } from '../../projects/utils/public-space.util';
import { ProjectRefService } from '../../projects/project-ref.service';

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

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectRef: ProjectRefService,
  ) {}

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
          in: [ORG_ROLE_CLASSES.ADMIN, ORG_ROLE_CLASSES.MEMBER, ORG_ROLE_CLASSES.VIEWER],
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

    // ADR-V2-058: o handle do projeto em DVincula é a chave da DEntidade-espelho
    // (-158), ou o próprio projectId (P) para projetos legados sem espelho.
    const projectHandle = await this.projectRef.resolveEntidadeRef(projectId);

    const vinculo = await this.prisma.dVincula.findFirst({
      where: {
        idLocEscritu: projectHandle,
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

    // Fallback — acesso herdado de SPACE público (ADR-V2-051 §8, Camada A):
    // sem DVincula de projeto, mas o SPACE raiz é público e o usuário é membro
    // da org dona → concede MEMBER (lê + edita tasks; ops estruturais continuam
    // exigindo MANAGER via DVincula). É o que permite operar tasks de listas em
    // espaços públicos sem ser membro explícito do projeto.
    if (!role) {
      role = await this.resolvePublicSpaceRole(userId, projectId);
    }

    this.projectRoleCache.set(cacheKey, role);
    return role;
  }

  /**
   * Resolve o role herdado de SPACE público para um usuário sem DVincula de
   * projeto (ADR-V2-051 §8, Camada A).
   *
   * Concede `'MEMBER'` se: (1) o SPACE raiz da hierarquia do projeto é público
   * E (2) o usuário é membro da org dona (`DProject.idEstab`). Caso contrário,
   * retorna `null` (sem acesso).
   *
   * @param userId - Chave BigInt da DEntidade do usuário
   * @param projectId - Chave BigInt do DProject
   * @returns `'MEMBER'` se o acesso público herdado se aplica; `null` caso contrário
   *
   * @see isProjectPubliclyVisible — fonte de verdade da visibilidade hierárquica
   * @see ADR-V2-051 §8 — Visibilidade de espaços
   */
  private async resolvePublicSpaceRole(
    userId: bigint,
    projectId: bigint,
  ): Promise<ProjectRole | null> {
    const project = await this.prisma.dProject.findFirst({
      where: { chave: projectId, excluido: false },
      select: { idEstab: true },
    });
    if (!project?.idEstab) {
      return null;
    }

    const publicVisible = await isProjectPubliclyVisible(this.prisma, projectId);
    if (!publicVisible) {
      return null;
    }

    const orgVinculo = await this.prisma.dVincula.findFirst({
      where: {
        idEntidade: userId,
        idLocEscritu: project.idEstab,
        idClasse: {
          in: [ORG_ROLE_CLASSES.ADMIN, ORG_ROLE_CLASSES.MEMBER, ORG_ROLE_CLASSES.VIEWER],
        },
        excluido: false,
      },
      select: { chave: true },
    });

    return orgVinculo ? 'MEMBER' : null;
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

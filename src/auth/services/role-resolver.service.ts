import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { LRUCache } from '../../common/helpers/lru-cache';
import { OrgRole } from '../decorators/roles.decorator';
import { isProjectPubliclyVisible } from '../../projects/utils/public-space.util';
import { ProjectRefService } from '../../projects/project-ref.service';
import { MCP_SCOPES, McpScope } from '../../mcp/constants';

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

/**
 * idClasses de DVincula consultadas para derivar os scopes MCP permitidos
 * (ADR-V2-068 Fase 2). Cobre roles de organização (-161/-162/-163) e de
 * projeto (-171/-172/-173) — a query única busca em todas de uma vez.
 */
const MCP_ROLE_VINCULO_CLASSES = [
  ORG_ROLE_CLASSES.ADMIN,
  ORG_ROLE_CLASSES.MEMBER,
  ORG_ROLE_CLASSES.VIEWER,
  PROJECT_ROLE_CLASSES.MANAGER,
  PROJECT_ROLE_CLASSES.MEMBER,
  PROJECT_ROLE_CLASSES.VIEWER,
];

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

    // Fallback — herança ORG_ADMIN → MANAGER (decisão CEO 2026-06-02):
    // o ADMIN da org dona do projeto (`DProject.idEstab`) é MANAGER em QUALQUER
    // projeto da org, inclusive privado e sem DVincula de projeto. Centraliza o
    // acesso de admin: todos os consumidores de getProjectRole (guards de
    // mutação, comentários, folders, etc.) passam a respeitar isso de uma vez.
    if (!role) {
      role = await this.resolveOrgAdminRole(userId, projectId);
    }

    this.projectRoleCache.set(cacheKey, role);
    return role;
  }

  /**
   * Resolve o role herdado por ADMIN da organização dona do projeto
   * (herança ORG_ADMIN → MANAGER — decisão CEO 2026-06-02).
   *
   * Concede `'MANAGER'` se o usuário é ADMIN (`-161`) da org `DProject.idEstab`.
   * Diferente de {@link resolvePublicSpaceRole}, NÃO exige que o espaço seja
   * público — o admin da org gere todos os projetos dela, públicos ou privados.
   * O escopo de tenant é garantido por usar `project.idEstab` como org-alvo
   * (admin da org A nunca herda em projeto da org B).
   *
   * @param userId - Chave BigInt da DEntidade do usuário
   * @param projectId - Chave BigInt do DProject
   * @returns `'MANAGER'` se ADMIN da org dona; `null` caso contrário
   */
  private async resolveOrgAdminRole(
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

    const orgRole = await this.getOrgRole(userId, project.idEstab);
    return orgRole === 'ADMIN' ? 'MANAGER' : null;
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
   * Resolve o conjunto de scopes MCP permitidos para um usuário, derivado
   * dos seus vínculos de role (ADR-V2-068 Fase 2 — prevenção de escalação
   * de privilégio via key MCP).
   *
   * Regras de associação role → scope:
   * - Todo usuário autenticado: `notifications:read` + `notifications:write`
   *   (notificações são sempre próprias do usuário) + `tasks:read`.
   * - MEMBER de organização (-162) OU MEMBER de projeto (-172) em ≥1 vínculo:
   *   adiciona `tasks:write`.
   * - MANAGER de projeto (-171) OU ADMIN de organização (-161) em ≥1 vínculo:
   *   adiciona `projects:write` + `executions:create` (implica os scopes acima).
   * - VIEWER (-163/-173) sem nenhum vínculo de MEMBER/MANAGER/ADMIN: permanece
   *   apenas com `tasks:read` + `notifications:*`.
   *
   * Implementado com 1 única query (`IN` list de 6 idClasses) — N+1 ZERO.
   * Não recebe projeto-alvo: a permissão é avaliada pelo conjunto de TODOS
   * os vínculos do usuário (qualquer org/projeto onde ele seja MEMBER/MANAGER/
   * ADMIN já libera o scope correspondente, independente do recurso-alvo).
   *
   * @param userEntidadeId - Chave BigInt da DEntidade (-150 USER)
   * @returns Set de scopes MCP (`McpScope`) permitidos para o usuário
   *
   * @example
   * ```typescript
   * const allowed = await roleResolver.getAllowedMcpScopes(BigInt(123));
   * if (!allowed.has('executions:create')) {
   *   throw new ForbiddenException('Scope não permitido para este usuário');
   * }
   * ```
   *
   * @see MCP_SCOPES — catálogo canônico de scopes (src/mcp/constants.ts)
   * @see McpKeyService.generate — consumidor que valida scopes solicitados
   */
  async getAllowedMcpScopes(userEntidadeId: bigint): Promise<Set<McpScope>> {
    this.logger.debug(`getAllowedMcpScopes userEntidadeId=${userEntidadeId}`);

    const vinculos = await this.prisma.dVincula.findMany({
      where: {
        idEntidade: userEntidadeId,
        idClasse: { in: MCP_ROLE_VINCULO_CLASSES },
        excluido: false,
      },
      select: { idClasse: true },
    });

    const idClasses = new Set(vinculos.map((v) => v.idClasse));

    const isMember =
      idClasses.has(ORG_ROLE_CLASSES.MEMBER) || idClasses.has(PROJECT_ROLE_CLASSES.MEMBER);
    const isManagerOrAdmin =
      idClasses.has(PROJECT_ROLE_CLASSES.MANAGER) || idClasses.has(ORG_ROLE_CLASSES.ADMIN);

    const allowed = new Set<McpScope>([
      MCP_SCOPES.TASKS_READ,
      MCP_SCOPES.NOTIFICATIONS_READ,
      MCP_SCOPES.NOTIFICATIONS_WRITE,
    ]);

    if (isMember || isManagerOrAdmin) {
      allowed.add(MCP_SCOPES.TASKS_WRITE);
    }

    if (isManagerOrAdmin) {
      allowed.add(MCP_SCOPES.PROJECTS_WRITE);
      allowed.add(MCP_SCOPES.EXECUTIONS_CREATE);
    }

    return allowed;
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

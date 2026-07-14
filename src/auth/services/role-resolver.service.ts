import { Injectable, Logger, Optional } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { LRUCache } from '../../common/helpers/lru-cache';
import { MetricsService } from '../../common/observability/metrics.service';
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

/** TTL do cache POSITIVO (role encontrado): 5 min. */
const POSITIVE_TTL_MS = 300_000;

/**
 * TTL do cache NEGATIVO (`null` = sem vínculo): **10 s** (F1, item 1.6).
 *
 * Era igual ao positivo (300 s) — e isso é, literalmente, "o CEO perde a
 * autoridade por 5 minutos": basta um request cair antes da concessão do papel
 * para o `null` ficar grudado por 5 min (e divergir entre réplicas). 10 s ainda
 * protege contra hammering, mas a permissão concedida reflete quase de imediato.
 *
 * A coerência FORTE vem de {@link RoleResolverService.invalidateUser}, agora
 * ligado nas mutações de membership — o TTL é a rede de segurança, não o
 * mecanismo principal.
 */
const NEGATIVE_TTL_MS = 10_000;

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
  private readonly orgRoleCache = new LRUCache<string, OrgRole | null>(1000, POSITIVE_TTL_MS);

  /** Cache LRU de project roles: key = `proj:${projId}:${userId}`, value = ProjectRole|null */
  private readonly projectRoleCache = new LRUCache<string, ProjectRole | null>(
    1000,
    POSITIVE_TTL_MS,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly projectRef: ProjectRefService,
    // F0 — Observabilidade. `@Optional()`: sem MetricsService o service opera igual.
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /**
   * Registra hit/miss/negative_hit do cache de roles (F0).
   *
   * `silent: true` — este caminho roda em TODA request autenticada; emitir uma
   * linha por consulta afogaria o log. Os contadores aparecem agregados na
   * linha `metric: "metrics.snapshot"` (a cada 60 s) e em `GET /telemetry/metrics`.
   *
   * `negative_hit` alto = usuários sendo NEGADOS por cache negativo de 5 min —
   * é a prova do sintoma B2 ("o CEO perde a autoridade"). Correção: F1.6/F4.1.
   *
   * @param cache - Qual cache (`org` | `project`)
   * @param cached - Valor retornado pelo LRU (`undefined` = miss; `null` = negativo)
   */
  private recordCacheLookup(cache: 'org' | 'project', cached: unknown): void {
    if (cached === undefined) {
      this.metrics?.increment('auth.role_cache.miss', { cache }, { silent: true });
      return;
    }

    this.metrics?.increment('auth.role_cache.hit', { cache }, { silent: true });

    if (cached === null) {
      // Hit de um NULL cacheado: permissão negada por cache, não pelo banco.
      this.metrics?.increment('auth.role_cache.negative_hit', { cache }, { silent: true });
    }
  }

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
    this.recordCacheLookup('org', cached); // F0 — só conta
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

    // TTL assimétrico (F1, item 1.6): positivo 300 s, negativo 10 s.
    this.orgRoleCache.set(cacheKey, role, role === null ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS);
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
    this.recordCacheLookup('project', cached); // F0 — só conta
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

    // TTL assimétrico (F1, item 1.6): positivo 300 s, negativo 10 s.
    this.projectRoleCache.set(cacheKey, role, role === null ? NEGATIVE_TTL_MS : POSITIVE_TTL_MS);
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
   * Invalida TODAS as entradas de cache de um usuário (org + projetos).
   *
   * **F1 (item 1.6) — este método tinha ZERO callers.** Sem ele, o único
   * mecanismo de coerência era o TTL — e é isso que produzia "concedi o papel e
   * o usuário continuou sem acesso" (até 5 min) e "403 numa réplica, 200 na
   * outra". Agora é chamado em toda mutação de membership: aceite de convite,
   * add/remove/change de role em org e projeto.
   *
   * **Por que purgar TUDO do usuário e não só a chave exata:** um papel de ORG
   * influencia papéis de PROJETO por herança (ORG_ADMIN → MANAGER, e a Camada A
   * de espaço público exige membership de org). Invalidar só `org:${orgId}:${userId}`
   * deixaria entradas `proj:*:${userId}` derivadas dele **stale** — exatamente o
   * bug que estamos consertando. Purgar por usuário é O(n) sobre um cache de
   * 1000 entradas e roda apenas em mutação de membership (evento raro).
   *
   * @param userId - Chave BigInt da DEntidade (-150 USER)
   * @param orgId - Org afetada (opcional — só rotula a telemetria)
   * @param projectId - Projeto afetado (opcional — só rotula a telemetria)
   */
  invalidateUser(userId: bigint, orgId?: bigint, projectId?: bigint): void {
    const sufixo = `:${userId}`;
    const removidos =
      this.orgRoleCache.deleteWhere((key) => key.endsWith(sufixo)) +
      this.projectRoleCache.deleteWhere((key) => key.endsWith(sufixo));

    this.metrics?.increment('auth.role_cache.invalidate', {
      scope: orgId ? 'org' : projectId ? 'project' : 'user',
      removed: removidos,
    });

    this.logger.debug(`Cache de role invalidado userId=${userId} (${removidos} entrada(s))`);
  }

  /**
   * Invalida o cache de role de um PROJETO inteiro (todos os usuários).
   *
   * Usado quando a mudança não é de um membro específico, mas do projeto:
   * troca de visibilidade (público ↔ privado muda o role herdado pela Camada A
   * do ADR-V2-051) e soft-delete do projeto.
   *
   * @param projectId - Chave BigInt do DProject
   */
  invalidateProject(projectId: bigint): void {
    const prefixo = `proj:${projectId}:`;
    const removidos = this.projectRoleCache.deleteWhere((key) => key.startsWith(prefixo));

    this.metrics?.increment('auth.role_cache.invalidate', {
      scope: 'project_all',
      removed: removidos,
    });

    this.logger.debug(`Cache de role invalidado projectId=${projectId} (${removidos} entrada(s))`);
  }

  /**
   * Invalida o cache de role de uma ORGANIZAÇÃO inteira (todos os usuários).
   *
   * Usado no soft-delete da org, que faz cascade em memberships e projetos.
   * Como a cascade atinge projetos cujas chaves não estão em mãos aqui, o cache
   * de projeto é purgado por inteiro — operação rara e o cache se reconstrói na
   * primeira request (a alternativa, deixar entradas stale de uma org excluída,
   * é pior).
   *
   * @param orgId - Chave BigInt da DEntidade (-152 ORGANIZATION)
   */
  invalidateOrg(orgId: bigint): void {
    const prefixo = `org:${orgId}:`;
    const removidos = this.orgRoleCache.deleteWhere((key) => key.startsWith(prefixo));
    this.projectRoleCache.clear();

    this.metrics?.increment('auth.role_cache.invalidate', {
      scope: 'org_all',
      removed: removidos,
    });

    this.logger.debug(`Cache de role invalidado orgId=${orgId} (${removidos} entrada(s) de org)`);
  }
}

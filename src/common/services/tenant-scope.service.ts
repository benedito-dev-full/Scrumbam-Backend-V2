import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

/**
 * Classes DVincula que representam membership de usuario em projeto
 * (qualquer cargo). ADR-V2-003 — RBAC duplo via DVincula.
 *
 * - -171: PROJECT_ROLE_MANAGER
 * - -172: PROJECT_ROLE_MEMBER
 * - -173: PROJECT_ROLE_VIEWER
 */
const PROJECT_ROLE_CLASSES = [BigInt(-171), BigInt(-172), BigInt(-173)] as const;

/** idClasse de DEntidade AGENT (ADR-V2-013). */
const ID_CLASSE_AGENT = BigInt(-156);

/**
 * `TenantScopeService` — helper canonico de isolamento multi-tenant V2.
 *
 * Concentra a logica de cruzamento entre membership do usuario
 * (DVincula -171/-172/-173 / -161/-162/-163) e tenant do recurso
 * (`DProject.idEstab` ou `DEntidade.idEstab`), expressa por ADR-V2-042
 * (Tenant Isolation Defense-in-Depth).
 *
 * Use este service em qualquer `findMany` / `findOne` tenant-scoped:
 *
 * ```typescript
 * // Listagem (cruzamento membership + idEstab):
 * const ids = await tenantScope.scopeProjectIdsToOrg(userEntidadeId, orgId);
 * const tasks = await prisma.dTask.findMany({ where: { idProject: { in: ids } } });
 *
 * // Endpoint cross-tenant via path param:
 * await tenantScope.assertProjectInOrg(projectId, orgId);
 * ```
 *
 * REGRA: este helper NAO valida cargo (RBAC). RBAC continua nos services
 * via `requireManagerRole`, `requireProjectMembership` etc. — este helper
 * apenas garante isolamento de tenant (org).
 *
 * @see PrismaService — fonte de dados.
 * @see ADR-V2-042 — defesa em profundidade de tenant isolation.
 * @see ADR-V2-001 — ZERO tabela nova: tudo cruza via colunas existentes.
 */
@Injectable()
export class TenantScopeService {
  private readonly logger = new Logger(TenantScopeService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Lista os `DProject.chave` de projetos onde o usuario E membro
   * E o projeto pertence a organizacao indicada.
   *
   * Combina filtros em UMA query (JOIN implicito via relation Prisma)
   * para evitar N+1 e manter o helper barato em hot path (listagem).
   *
   * @param userEntidadeId - `DEntidade.chave` do usuario logado (JWT.entidadeId).
   * @param organizationId - `DEntidade.chave` da organizacao do JWT (BigInt
   *   como string — tipico do payload `JwtPayload.organizationId`).
   * @returns Lista (possivelmente vazia) de `DProject.chave` cruzando
   *   membership + tenant. Ordenacao: descendente por chave (DESC) — caller
   *   pode reordenar.
   *
   * @example
   * ```typescript
   * const projectIds = await tenantScope.scopeProjectIdsToOrg(
   *   BigInt('100'),
   *   '50',
   * );
   * // projectIds: [BigInt(70), BigInt(65), ...]
   * ```
   */
  async scopeProjectIdsToOrg(userEntidadeId: bigint, organizationId: string): Promise<bigint[]> {
    const orgIdBig = this.toBigIntSafe(organizationId);
    if (orgIdBig === null) {
      this.logger.debug(`organizationId invalido="${organizationId}" — retorna lista vazia`);
      return [];
    }

    // Buscar memberships do usuario; para cada membership, validar que o
    // projeto pertence a org via DProject.idEstab.
    //
    // Optamos por DUAS queries (DVincula -> projectIds candidatos; DProject
    // filtrado por idEstab) em vez de relation Prisma JOIN, porque o schema
    // atual define DVincula.idLocEscritu como BigInt sem relation reversa
    // explicita para DProject. Continua sendo ZERO N+1: 2 queries fixas
    // independente da cardinalidade.
    const vinculos = await this.prisma.dVincula.findMany({
      where: {
        idEntidade: userEntidadeId,
        idClasse: { in: [...PROJECT_ROLE_CLASSES] },
        excluido: false,
      },
      select: { idLocEscritu: true },
    });

    const candidateProjectIds = Array.from(
      new Set(vinculos.map((v) => v.idLocEscritu.toString())),
    ).map((s) => BigInt(s));

    if (candidateProjectIds.length === 0) {
      return [];
    }

    const projects = await this.prisma.dProject.findMany({
      where: {
        chave: { in: candidateProjectIds },
        idEstab: orgIdBig,
        excluido: false,
      },
      select: { chave: true },
      orderBy: { chave: 'desc' },
    });

    return projects.map((p) => p.chave);
  }

  /**
   * Garante que o projeto indicado pertence a organizacao indicada.
   *
   * Usado em endpoints que recebem `projectId` por path/body e precisam
   * bloquear cross-tenant via path param antes de qualquer query subsequente.
   *
   * Politica de erro (ADR-V2-042 e plano):
   *  - Projeto inexistente / soft-deleted → 404 (`NotFoundException`).
   *  - Projeto existe mas em OUTRA org → 404 tambem, para evitar
   *    enumeration attack (atacante nao consegue distinguir "nao existe"
   *    de "nao pertence a sua org").
   *
   * @param projectId - `DProject.chave` (BigInt como string).
   * @param organizationId - `DEntidade.chave` da org do JWT (BigInt como string).
   * @throws {NotFoundException} Projeto inexistente OU em outra org.
   *
   * @example
   * ```typescript
   * @Get(':id/stats')
   * async stats(@Param('id') id: string, @CurrentUser() user: JwtPayload) {
   *   await this.tenantScope.assertProjectInOrg(id, user.organizationId!);
   *   return this.service.getStats(id, BigInt(user.entidadeId));
   * }
   * ```
   */
  async assertProjectInOrg(projectId: string, organizationId: string): Promise<void> {
    const projectIdBig = this.toBigIntSafe(projectId);
    const orgIdBig = this.toBigIntSafe(organizationId);

    if (projectIdBig === null || orgIdBig === null) {
      throw new NotFoundException(`Projeto ${projectId} nao encontrado`);
    }

    const project = await this.prisma.dProject.findFirst({
      where: { chave: projectIdBig, excluido: false },
      select: { idEstab: true },
    });

    if (!project) {
      throw new NotFoundException(`Projeto ${projectId} nao encontrado`);
    }

    // idEstab pode ser null em projetos legados pre-multi-tenant.
    // Politica: projeto sem idEstab e tratado como "nao pertence a nenhuma org"
    // e portanto inacessivel via JWT com organizationId. Permitir acesso
    // abriria buraco de tenancy. Operador faz backfill se necessario.
    if (project.idEstab === null || project.idEstab !== orgIdBig) {
      this.logger.warn(
        `tenant_mismatch_project projectId=${projectId} jwtOrg=${organizationId} projectOrg=${
          project.idEstab?.toString() ?? 'null'
        }`,
      );
      throw new NotFoundException(`Projeto ${projectId} nao encontrado`);
    }
  }

  /**
   * Garante que a task indicada pertence a um projeto da organizacao
   * indicada. Resolve via `DTask.idProject -> DProject.idEstab`.
   *
   * @param taskId - `DTask.chave` (BigInt como string).
   * @param organizationId - `DEntidade.chave` da org do JWT.
   * @throws {NotFoundException} Task inexistente, sem projeto, ou em
   *   projeto de outra org (mensagem generica — anti enumeration).
   *
   * @example
   * ```typescript
   * await this.tenantScope.assertTaskInOrg(taskId, user.organizationId!);
   * ```
   */
  async assertTaskInOrg(taskId: string, organizationId: string): Promise<void> {
    const taskIdBig = this.toBigIntSafe(taskId);
    const orgIdBig = this.toBigIntSafe(organizationId);

    if (taskIdBig === null || orgIdBig === null) {
      throw new NotFoundException(`Task ${taskId} nao encontrada`);
    }

    const task = await this.prisma.dTask.findFirst({
      where: { chave: taskIdBig, excluido: false },
      select: { idProject: true },
    });

    if (!task || task.idProject === null) {
      throw new NotFoundException(`Task ${taskId} nao encontrada`);
    }

    const project = await this.prisma.dProject.findFirst({
      where: { chave: task.idProject, excluido: false },
      select: { idEstab: true },
    });

    if (!project || project.idEstab === null || project.idEstab !== orgIdBig) {
      this.logger.warn(
        `tenant_mismatch_task taskId=${taskId} jwtOrg=${organizationId} projectOrg=${
          project?.idEstab?.toString() ?? 'null'
        }`,
      );
      throw new NotFoundException(`Task ${taskId} nao encontrada`);
    }
  }

  /**
   * Garante que o agente (DEntidade idClasse=-156) pertence a organizacao
   * indicada. Usa `DEntidade.idEstab` como FK para a org.
   *
   * Agentes standalone (idEstab=null) sao tratados como "nao pertencem a
   * nenhuma org" e portanto inacessiveis via JWT com organizationId — mesma
   * politica de DProject. Operador faz backfill ou link via
   * `POST /agents/:id/projects`.
   *
   * @param agentId - `DEntidade.chave` do agente (BigInt como string).
   * @param organizationId - `DEntidade.chave` da org do JWT.
   * @throws {NotFoundException} Agente inexistente OU em outra org.
   *
   * @example
   * ```typescript
   * await this.tenantScope.assertAgentInOrg(agentId, user.organizationId!);
   * ```
   */
  async assertAgentInOrg(agentId: string, organizationId: string): Promise<void> {
    const agentIdBig = this.toBigIntSafe(agentId);
    const orgIdBig = this.toBigIntSafe(organizationId);

    if (agentIdBig === null || orgIdBig === null) {
      throw new NotFoundException(`Agente ${agentId} nao encontrado`);
    }

    const agent = await this.prisma.dEntidade.findFirst({
      where: {
        chave: agentIdBig,
        idClasse: ID_CLASSE_AGENT,
        excluido: false,
      },
      select: { idEstab: true },
    });

    if (!agent) {
      throw new NotFoundException(`Agente ${agentId} nao encontrado`);
    }

    if (agent.idEstab === null || agent.idEstab !== orgIdBig) {
      this.logger.warn(
        `tenant_mismatch_agent agentId=${agentId} jwtOrg=${organizationId} agentOrg=${
          agent.idEstab?.toString() ?? 'null'
        }`,
      );
      throw new NotFoundException(`Agente ${agentId} nao encontrado`);
    }
  }

  /**
   * Bloqueia explicitamente um JWT orfao (sem `organizationId`) com 403
   * `{ code: 'NO_WORKSPACE' }`. Helper utilitario para services que
   * querem ser defensivos mesmo quando o `AuthCompositeGuard` ja deveria
   * ter filtrado.
   *
   * @param organizationId - `JwtPayload.organizationId` (pode ser undefined).
   * @throws {ForbiddenException} `{ code: 'NO_WORKSPACE' }` se vazio.
   *
   * @internal — preferir `@AllowOrphan()` / `RequireWorkspaceGuard` para o
   *   gate canonico. Este helper existe para defesa em profundidade.
   */
  assertWorkspace(organizationId: string | undefined | null): asserts organizationId is string {
    if (!organizationId) {
      throw new ForbiddenException({
        code: 'NO_WORKSPACE',
        message: 'Voce precisa criar ou aceitar uma workspace antes de acessar esta rota.',
      });
    }
  }

  /**
   * Converte string → BigInt sem lancar excecao quando a string e invalida.
   * Retorna null em vez de jogar — assim os callers podem decidir entre
   * 404 (mensagem generica) ou 400.
   *
   * @internal
   */
  private toBigIntSafe(value: string): bigint | null {
    if (typeof value !== 'string') return null;
    if (!/^-?\d+$/.test(value)) return null;
    try {
      return BigInt(value);
    } catch {
      return null;
    }
  }
}

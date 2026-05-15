// TODO F14: Para escala >10k tasks/org, adicionar PostgreSQL to_tsvector('portuguese',
// nome || ' ' || COALESCE(descricao, '')) + GIN index. Ver docs/plano/00-PLANO-MESTRE.md §8.6.
// Atualmente: Prisma `contains` com mode:'insensitive' (ILIKE) — aceitável até ~10k tasks/org.

import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import {
  SearchResponseDto,
  TaskSearchResultDto,
  ProjectSearchResultDto,
  PersonSearchResultDto,
  SearchCursorsDto,
} from './dto/search-response.dto';

/** idClasse DEntidade USER no V2 (seed F1 — ADR-V2-002). */
const ID_CLASSE_USER = BigInt(-150);

/** idClasses DVincula para org RBAC (seed F1) — membros da organização. */
const ID_CLASSE_ORG_ADMIN = BigInt(-161);
const ID_CLASSE_ORG_MEMBER = BigInt(-162);
const ID_CLASSE_ORG_VIEWER = BigInt(-163);

/**
 * Service de busca cross-entity do Scrumban-Backend-V2.
 *
 * Implementa busca unificada em 3 categorias via `Promise.all` paralelo:
 * 1. DTask — tasks do workspace (via JOIN DProject.idEstab = orgId)
 * 2. DProject — projetos da organização (via idEstab = orgId)
 * 3. DEntidade USER (-150) — membros da organização (via DVincula -161/-162/-163)
 *
 * Decisões arquiteturais aplicadas:
 * - DA-1: `contains` Prisma com `mode: 'insensitive'` e `OR` — ZERO $queryRaw
 * - DA-2: Cursors separados por tipo (task/project/person)
 * - DA-3: DTask scopada via `project: { idEstab: BigInt(orgId) }` — JOIN Prisma
 * - DA-4: Distribuição fixa tasks=50%, projects=30%, people=20% (ceil, mín 1)
 *
 * Tenant isolation:
 * - DTask: `project.idEstab = orgId` (JOIN via relação Prisma)
 * - DProject: `idEstab = orgId`
 * - DEntidade USER: DVincula idClasse in [-161,-162,-163] WHERE idLocEscritu=orgId
 *   (confirmado em OrganizationsService.addMember — vínculo é via DVincula, NÃO idEstab)
 *
 * ZERO Engine/Operacao — F8 é read-only puro.
 * ZERO INSERT/UPDATE/DELETE em qualquer tabela.
 * ZERO EventProducerService — sem efeitos colaterais.
 *
 * @see PrismaService — acesso ao banco
 */
@Injectable()
export class SearchService {
  private readonly logger = new Logger(SearchService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Executa busca cross-entity no workspace da organização.
   *
   * Lança 3 queries Prisma em paralelo via `Promise.all`. Cada query aplica
   * tenant isolation independente. Cursors calculados por categoria (DA-2).
   *
   * Queries por request: 3 paralelas (ZERO N+1, ZERO sequencial).
   *
   * @param params.q - Termo de busca (mín 2 chars, já validado no DTO)
   * @param params.organizationId - ID da organização do JWT (tenant isolation)
   * @param params.projectIdFilter - Filtro opcional por projeto específico
   * @param params.limit - Limite total (distribuído entre categorias via DA-4)
   * @param params.taskCursor - Cursor de paginação para tasks
   * @param params.projectCursor - Cursor de paginação para projetos
   * @param params.peopleCursor - Cursor de paginação para pessoas
   * @returns SearchResponseDto com tasks, projects, people, cursors e meta
   *
   * @throws {ForbiddenException} Se organizationId não fornecido pelo JWT
   *
   * @example
   * ```typescript
   * const result = await searchService.search({
   *   q: 'login',
   *   organizationId: '100',
   *   limit: 20,
   * });
   * // result.tasks.length <= 10, result.projects.length <= 6, result.people.length <= 4
   * ```
   */
  async search(params: {
    q: string;
    organizationId: string;
    projectIdFilter?: string;
    limit: number;
    taskCursor?: string;
    projectCursor?: string;
    peopleCursor?: string;
  }): Promise<SearchResponseDto> {
    const { q, organizationId, projectIdFilter, limit, taskCursor, projectCursor, peopleCursor } =
      params;

    // Guard: organizationId é obrigatório — vem do JWT via OrgTenantGuard
    if (!organizationId) {
      throw new ForbiddenException('Usuário sem organização — não é possível executar busca');
    }

    // DA-4: distribuição fixa de limite por categoria (mínimo 1 cada)
    const taskLimit = Math.max(1, Math.ceil(limit * 0.5));
    const projectLimit = Math.max(1, Math.ceil(limit * 0.3));
    const peopleLimit = Math.max(1, Math.ceil(limit * 0.2));

    this.logger.debug(
      `Search q="${q}" org=${organizationId} limits=[${taskLimit},${projectLimit},${peopleLimit}]`,
    );

    // Promise.all: 3 queries paralelas — ZERO N+1, ZERO sequencial
    const [tasks, projects, people] = await Promise.all([
      this.queryTasks(q, organizationId, projectIdFilter, taskCursor, taskLimit),
      this.queryProjects(q, organizationId, projectCursor, projectLimit),
      this.queryPeople(q, organizationId, peopleCursor, peopleLimit),
    ]);

    const cursors = this.buildCursors(tasks, projects, people, {
      taskLimit,
      projectLimit,
      peopleLimit,
    });

    return {
      tasks,
      projects,
      people,
      cursors,
      meta: { q, limit, organizationId },
    };
  }

  /**
   * Busca tasks (DTask) da organização via JOIN DProject.
   *
   * Tenant isolation: DTask → DProject.idEstab = orgId (DA-3).
   * ILIKE cross-field em nome + descricao (DA-1).
   * Cursor: chave gt BigInt(cursor) com orderBy chave asc.
   *
   * @param q - Termo de busca
   * @param organizationId - ID da organização (tenant isolation)
   * @param projectIdFilter - Filtro opcional por projeto específico
   * @param cursor - Cursor de paginação (chave da última task)
   * @param limit - Máximo de resultados
   * @returns Lista de TaskSearchResultDto
   */
  private async queryTasks(
    q: string,
    organizationId: string,
    projectIdFilter: string | undefined,
    cursor: string | undefined,
    limit: number,
  ): Promise<TaskSearchResultDto[]> {
    const tasks = await this.prisma.dTask.findMany({
      where: {
        excluido: false,
        // DA-3: Tenant isolation via JOIN DProject.idEstab = orgId
        project: {
          idEstab: BigInt(organizationId),
          excluido: false,
        },
        // Filtro opcional por projeto específico
        ...(projectIdFilter ? { idProject: BigInt(projectIdFilter) } : {}),
        // DA-2: Cursor pagination
        ...(cursor ? { chave: { gt: BigInt(cursor) } } : {}),
        // DA-1: ILIKE cross-field via OR com contains mode:insensitive
        OR: [
          { nome: { contains: q, mode: 'insensitive' } },
          { descricao: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: {
        chave: true,
        nome: true,
        descricao: true,
        idProject: true,
        idStatus: true,
        criadoEm: true,
        project: { select: { chave: true, nome: true } },
      },
      orderBy: { chave: 'asc' },
      take: limit,
    });

    return tasks.map((t) => ({
      chave: t.chave.toString(),
      nome: t.nome,
      descricao: this.truncate(t.descricao),
      idProject: t.idProject?.toString() ?? null,
      projectNome: t.project?.nome ?? null,
      idStatus: t.idStatus?.toString() ?? null,
      criadoEm: t.criadoEm.toISOString(),
    }));
  }

  /**
   * Busca projetos (DProject) da organização.
   *
   * Tenant isolation: DProject.idEstab = orgId.
   * ILIKE em nome (DA-1).
   * Cursor: chave gt BigInt(cursor) com orderBy chave asc.
   *
   * @param q - Termo de busca
   * @param organizationId - ID da organização (tenant isolation)
   * @param cursor - Cursor de paginação
   * @param limit - Máximo de resultados
   * @returns Lista de ProjectSearchResultDto
   */
  private async queryProjects(
    q: string,
    organizationId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<ProjectSearchResultDto[]> {
    const projects = await this.prisma.dProject.findMany({
      where: {
        excluido: false,
        idEstab: BigInt(organizationId),
        ...(cursor ? { chave: { gt: BigInt(cursor) } } : {}),
        // DA-1: ILIKE em nome
        nome: { contains: q, mode: 'insensitive' },
      },
      select: {
        chave: true,
        nome: true,
        descricao: true,
        criadoEm: true,
      },
      orderBy: { chave: 'asc' },
      take: limit,
    });

    return projects.map((p) => ({
      chave: p.chave.toString(),
      nome: p.nome,
      descricao: this.truncate(p.descricao),
      criadoEm: p.criadoEm.toISOString(),
    }));
  }

  /**
   * Busca membros da organização (DEntidade USER idClasse=-150).
   *
   * Tenant isolation via DVincula:
   * - Busca DVincula idClasse in [-161,-162,-163] WHERE idLocEscritu=orgId
   *   para obter os IDs das DEntidades USER membros da org
   * - Aplica filtro ILIKE em nome + email dos membros encontrados
   *
   * ATENÇÃO: O vínculo org↔user em V2 é via DVincula (não via idEstab).
   * Confirmado em OrganizationsService.addMember(): cria DVincula com
   * idLocEscritu=orgId, idEntidade=userEntidadeId — NÃO seta idEstab.
   * (Risco R5 do plano — mitigado pela leitura do código existente.)
   *
   * Cursor aplicado após o filtro DVincula (cursor em DEntidade.chave).
   *
   * @param q - Termo de busca
   * @param organizationId - ID da organização (tenant isolation)
   * @param cursor - Cursor de paginação
   * @param limit - Máximo de resultados
   * @returns Lista de PersonSearchResultDto
   */
  private async queryPeople(
    q: string,
    organizationId: string,
    cursor: string | undefined,
    limit: number,
  ): Promise<PersonSearchResultDto[]> {
    // 1. Buscar IDs dos membros da org via DVincula (sem N+1 — 1 query com select)
    const orgVinculos = await this.prisma.dVincula.findMany({
      where: {
        idLocEscritu: BigInt(organizationId),
        idClasse: { in: [ID_CLASSE_ORG_ADMIN, ID_CLASSE_ORG_MEMBER, ID_CLASSE_ORG_VIEWER] },
        excluido: false,
        idEntidade: { not: null },
      },
      select: { idEntidade: true },
    });

    const memberIds = orgVinculos
      .map((v) => v.idEntidade)
      .filter((id): id is bigint => id !== null);

    if (memberIds.length === 0) {
      return [];
    }

    // 2. Buscar DEntidade USER dos membros com filtro ILIKE (DA-1)
    const people = await this.prisma.dEntidade.findMany({
      where: {
        excluido: false,
        idClasse: ID_CLASSE_USER,
        chave: {
          in: memberIds,
          ...(cursor ? { gt: BigInt(cursor) } : {}),
        },
        // DA-1: ILIKE cross-field em nome + email
        OR: [
          { nome: { contains: q, mode: 'insensitive' } },
          { email: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: {
        chave: true,
        nome: true,
        email: true,
        criadoEm: true,
      },
      orderBy: { chave: 'asc' },
      take: limit,
    });

    return people.map((p) => ({
      chave: p.chave.toString(),
      nome: p.nome,
      email: p.email ?? null,
      criadoEm: p.criadoEm.toISOString(),
    }));
  }

  /**
   * Calcula cursors para cada categoria (DA-2).
   *
   * Se o número de resultados de uma categoria for igual ao limite daquela
   * categoria, há possivelmente mais resultados — retornar o chave do último
   * item como cursor. Caso contrário (menos que o limite), retornar null.
   *
   * @param tasks - Tasks retornadas
   * @param projects - Projetos retornados
   * @param people - Pessoas retornadas
   * @param limits - Limites por categoria
   * @returns SearchCursorsDto com cursors por tipo
   */
  private buildCursors(
    tasks: TaskSearchResultDto[],
    projects: ProjectSearchResultDto[],
    people: PersonSearchResultDto[],
    limits: { taskLimit: number; projectLimit: number; peopleLimit: number },
  ): SearchCursorsDto {
    return {
      task:
        tasks.length === limits.taskLimit ? tasks[tasks.length - 1].chave : null,
      project:
        projects.length === limits.projectLimit ? projects[projects.length - 1].chave : null,
      person:
        people.length === limits.peopleLimit ? people[people.length - 1].chave : null,
    };
  }

  /**
   * Busca tasks para o canal MCP, usando lista de IDs de projetos acessíveis
   * como escopo de tenant (em vez de `organizationId`).
   *
   * Diferença em relação ao `search()`:
   *  - NÃO exige `organizationId` — MCP não tem org no contexto.
   *  - Filtra DTask via `idProject IN (accessibleProjectIds)` (IN clause — ZERO N+1).
   *  - Retorna apenas tasks (sem projects nem people) para UX de LLM otimizada.
   *  - Se `opts.projectId` fornecido, filtra adicionalmente por esse projeto.
   *
   * Queries por chamada: 1 (ZERO N+1).
   * ZERO Engine/Operação — read-only puro.
   *
   * @param q - Termo de busca (mín 2 chars, validado na tool)
   * @param _userEntidadeId - ID do usuário autenticado (reservado para extensão futura)
   * @param accessibleProjectIds - Lista de IDs de projetos acessíveis (já resolvida pela tool)
   * @param opts.projectId - Filtro adicional por projeto específico (opcional)
   * @param opts.limit - Máximo de tasks a retornar (default 20, máx 50)
   * @returns Objeto com lista de tasks e metadados de busca
   */
  async searchForMcp(
    q: string,
    _userEntidadeId: bigint,
    accessibleProjectIds: string[],
    opts: { projectId?: string; limit?: number },
  ): Promise<{ tasks: TaskSearchResultDto[]; total: number; q: string }> {
    const limit = Math.max(1, Math.min(50, opts.limit ?? 20));

    this.logger.debug(
      `searchForMcp q="${q}" projects=[${accessibleProjectIds.length}] limit=${limit}`,
    );

    // Determinar conjunto de projectIds a filtrar
    const projectIdsToSearch =
      opts.projectId !== undefined ? [opts.projectId] : accessibleProjectIds;

    const projectBigInts = projectIdsToSearch.map((id) => BigInt(id));

    // 1 query: DTask IN (projectIds) + ILIKE em nome/descricao — ZERO N+1
    const tasks = await this.prisma.dTask.findMany({
      where: {
        excluido: false,
        idProject: { in: projectBigInts },
        OR: [
          { nome: { contains: q, mode: 'insensitive' } },
          { descricao: { contains: q, mode: 'insensitive' } },
        ],
      },
      select: {
        chave: true,
        nome: true,
        descricao: true,
        idProject: true,
        idStatus: true,
        criadoEm: true,
        project: { select: { chave: true, nome: true } },
      },
      orderBy: { chave: 'asc' },
      take: limit,
    });

    const taskDtos: TaskSearchResultDto[] = tasks.map((t) => ({
      chave: t.chave.toString(),
      nome: t.nome,
      descricao: this.truncate(t.descricao),
      idProject: t.idProject?.toString() ?? null,
      projectNome: t.project?.nome ?? null,
      idStatus: t.idStatus?.toString() ?? null,
      criadoEm: t.criadoEm.toISOString(),
    }));

    return { tasks: taskDtos, total: taskDtos.length, q };
  }

  /**
   * Trunca texto em `max` caracteres com sufixo '...' se necessário.
   *
   * Usado para limitar payloads de descrição em responses de busca.
   * Retorna null se o texto de entrada for null/undefined.
   *
   * @param text - Texto a truncar (pode ser null/undefined)
   * @param max - Limite de caracteres (default 150)
   * @returns Texto truncado ou null
   *
   * @example
   * ```typescript
   * truncate('texto longo...', 10); // 'texto long...'
   * truncate(null);                 // null
   * truncate('curto', 150);         // 'curto'
   * ```
   */
  private truncate(text: string | null | undefined, max = 150): string | null {
    if (!text) return null;
    if (text.length <= max) return text;
    return text.slice(0, max) + '...';
  }
}

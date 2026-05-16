import {
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { EventProducerService } from '../eventos/core/event-producer.service';
import { CorrelationIdService } from '../common/services/correlation-id.service';
import { SeedBootstrapService } from './seed-bootstrap.service';
import { ProjectMembersService } from './project-members.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import {
  ProjectResponseDto,
  ListProjectResponseDto,
  ProjectStatsDto,
} from './dto/project-response.dto';
import { DeleteProjectResponseDto } from './dto/delete-project-response.dto';
import { fallbackSlug, slugify } from './utils/slugify';

/** idClasse de DProject no seed F1 (classes canônicas V2). */
const ID_CLASSE_PROJECT = BigInt(-153); // SCRUMBAN_PROJECT (seed classes.seed.ts)

/** idClasse de DVincula MANAGER de projeto (seed F1). */
const ID_CLASSE_PROJECT_MANAGER = BigInt(-171);
const ID_CLASSE_PROJECT_MEMBER = BigInt(-172);
const ID_CLASSE_PROJECT_VIEWER = BigInt(-173);

const PROJECT_ROLE_CLASSES = [
  ID_CLASSE_PROJECT_MANAGER,
  ID_CLASSE_PROJECT_MEMBER,
  ID_CLASSE_PROJECT_VIEWER,
];

/** idClasse de DEntidade TEAM (seed F1). */
const ID_CLASSE_TEAM = BigInt(-180);
/** idClasse de DVincula TEAM_MEMBERSHIP (cargo em metaDados). */
const ID_CLASSE_TEAM_MEMBERSHIP = BigInt(-181);
/** idClasse de DVincula PROJECT_TEAM_LINK (ADR-V2-029). */
const ID_CLASSE_PROJECT_TEAM_LINK = BigInt(-182);
/** idClasse de DVincula ORG_ROLE_ADMIN (seed F1). */
const ID_CLASSE_ORG_ADMIN = BigInt(-161);

/**
 * Opções para `findMany()`.
 *
 * @see ADR-V2-029 (teamId filter)
 * @see ADR-V2-042 (organizationId obrigatorio para isolamento multi-tenant)
 */
export interface FindManyProjectsOptions {
  cursor?: string;
  limit?: number;
  /** Filtra por DVincula -182 (PROJECT_TEAM_LINK). Ausente = todos. */
  teamId?: string;
  /**
   * `DEntidade.chave` da org ativa do JWT (`organizationId` do payload).
   * Quando informado, filtra para projetos com `DProject.idEstab === organizationId`.
   * Quando ausente (caso: MCP keys ou callers internos), retorna todos os
   * projetos onde o user e membro (sem cruzamento de org).
   *
   * **ADR-V2-042**: callers que servem JWT-authenticated requests DEVEM
   * passar `organizationId`. Caller responsavel decidir; service nao chama
   * `throw` quando ausente (mantem compat com MCP que e cross-org by design).
   */
  organizationId?: string;
}

/**
 * Service de projetos (DProject).
 *
 * Implementa CRUD completo de projetos usando Prisma direto em transactions.
 * Tabela estrutural — Pilar 1 NÃO se aplica (DProject não é DPedido).
 *
 * Ao criar um projeto, atomicamente:
 * 1. DProject
 * 2. DVincula -171 (PROJECT_ROLE_MANAGER) para o criador
 * 3. SeedBootstrapService.seedProject() → 9 statuses V3 + 1 sprint default
 * 4. DVincula -182 (PROJECT_TEAM_LINK) se `teamId` informado (ADR-V2-029)
 *
 * Audit DEvento -499 emitido APÓS commit. Eventos
 * `project.team.linked` / `project.team.unlinked` para mudanças de vínculo
 * de team (ADR-V2-029).
 *
 * @see PrismaService — acesso ao banco
 * @see SeedBootstrapService — seed de statuses + sprint
 * @see ProjectMembersService — gestão de membros
 * @see EventProducerService — emissão canônica de eventos (audit pós-commit)
 * @see ADR-V2-029 — Project ↔ Team via DVincula -182
 */
@Injectable()
export class ProjectsService implements OnModuleInit {
  private readonly logger = new Logger(ProjectsService.name);

  /** Tamanho de batch do backfill de slug em `onModuleInit`. */
  private static readonly BACKFILL_BATCH_SIZE = 100;

  constructor(
    private readonly prisma: PrismaService,
    private readonly seedBootstrap: SeedBootstrapService,
    private readonly projectMembers: ProjectMembersService,
    private readonly eventProducer: EventProducerService,
    private readonly correlationIdService: CorrelationIdService,
  ) {}

  /**
   * Lifecycle NestJS — executa backfill idempotente de `DProject.dados.slug`.
   *
   * Necessário para satisfazer a invariante `RemoteExecutionClient` exige
   * (Sub-tarefa 2.2): todo DProject usado em execução V2 tem `dados.slug`
   * não-vazio. Projetos criados antes da Sub-tarefa 2.3 não têm slug — este
   * hook materializa o slug para esses registros sem bloquear o boot do
   * processo por muito tempo (batches de 100 + skip por já-preenchido).
   *
   * Erros individuais são logados como warn e processamento continua —
   * preferimos boot bem-sucedido com N projetos sem slug a deixar o serviço
   * inteiro inacessível. Reviewer/Documenter validam que falhas reaparecem
   * em `DEvento` audit ou métricas.
   *
   * @see ADR-V2-030 — projectSlug é identidade técnica
   */
  async onModuleInit(): Promise<void> {
    try {
      await this.backfillSlugs();
    } catch (err) {
      this.logger.error(
        `backfill_slugs_failed: erro inesperado no backfill de slugs — boot prossegue. ${
          (err as Error).message
        }`,
      );
    }
  }

  /**
   * Cria projeto com seed completo, membership MANAGER e (opcional) vínculo
   * de time (ADR-V2-029).
   *
   * Transaction atômica (3–4 etapas):
   * 1. DProject (tabela canônica)
   * 2. DVincula -171 (MANAGER) para o criador
   * 3. seedProject(): 9 statuses V3 + 1 sprint default
   * 4. DVincula -182 (PROJECT_TEAM_LINK) se `dto.teamId` informado, após
   *    validar cross-org + permissão no time (LEAD ou ORG_ADMIN).
   *
   * Eventos emitidos APÓS commit:
   *  - `project.created` (sempre)
   *  - `project.team.linked` (apenas se `teamId` fornecido)
   *
   * @param dto - Dados do projeto (nome, prefix, description, orgId, teamId...)
   * @param userEntidadeId - Chave BigInt da DEntidade do criador
   * @returns ProjectResponseDto com memberCount=1 e `teamId` resolvido
   *
   * @throws {NotFoundException} Quando `teamId` inválido (time inexistente)
   * @throws {ForbiddenException} Cross-org leak ou sem permissão no time
   *
   * @example
   * ```typescript
   * const project = await service.create({ nome: 'Scrumban V2', teamId: '200' }, BigInt(userId));
   * ```
   */
  async create(dto: CreateProjectDto, userEntidadeId: bigint): Promise<ProjectResponseDto> {
    this.logger.log(
      `Criando projeto nome="${dto.nome}" para user=${userEntidadeId}` +
        (dto.teamId ? ` (team=${dto.teamId})` : ''),
    );

    const project = await this.prisma.$transaction(async (tx) => {
      // Derivar slug único antes de criar o projeto (ADR-V2-030).
      // Reutiliza tx para enxergar inserções desta mesma transação.
      const slug = await this.deriveUniqueSlug(tx, dto.nome);

      // Construir dados polimórficos — sem gitRepo (ADR-V2-043 limpeza dual-write).
      const dadosPayload: Record<string, unknown> = {
        prefix: dto.prefix ?? 'DEV',
        automationEnabled: dto.automationEnabled ?? false,
        slug,
        ...(dto.description ? { description: dto.description } : {}),
      };

      // 1. DProject
      const proj = await tx.dProject.create({
        data: {
          idClasse: ID_CLASSE_PROJECT,
          nome: dto.nome,
          ...(dto.description ? { descricao: dto.description } : {}),
          ...(dto.orgId ? { idEstab: BigInt(dto.orgId) } : {}),
          ...(dto.repoUrl ? { repoUrl: dto.repoUrl } : {}),
          dados: dadosPayload as Prisma.InputJsonValue,
        },
      });

      // 2. DVincula -171 (MANAGER): criador é MANAGER
      await this.projectMembers.createManagerLink(tx, proj.chave, userEntidadeId);

      // 3. Seed: 9 statuses V3 + 1 sprint default
      await this.seedBootstrap.seedProject(tx, proj.chave);

      // 4. (opcional) Vincular ao time (ADR-V2-029)
      if (dto.teamId) {
        await this.validateTeamForLink(
          tx,
          BigInt(dto.teamId),
          proj.idEstab ?? null,
          userEntidadeId,
        );
        await tx.dVincula.create({
          data: {
            idClasse: ID_CLASSE_PROJECT_TEAM_LINK,
            idLocEscritu: BigInt(dto.teamId),
            idEntidade: proj.chave,
          },
        });
      }

      return proj;
    });

    const correlationId = this.correlationIdService.getOrGenerate();

    // Audit APÓS commit — tipo project.created → idClasse=-499 PROJECT_LIFECYCLE (ADR-V2-027)
    await this.eventProducer.addInternalEvent(
      'project.created',
      {
        projectId: project.chave.toString(),
        nome: dto.nome,
        prefix: dto.prefix ?? 'DEV',
        userId: userEntidadeId.toString(),
      },
      correlationId,
      { source: ProjectsService.name },
    );

    // Audit APÓS commit — vínculo de team criado (ADR-V2-029)
    if (dto.teamId) {
      await this.eventProducer.addInternalEvent(
        'project.team.linked',
        {
          projectId: project.chave.toString(),
          teamId: dto.teamId,
          previousTeamId: null,
          userId: userEntidadeId.toString(),
        },
        correlationId,
        { source: ProjectsService.name },
      );
    }

    return this.buildResponse(project, 1, dto.teamId ?? null);
  }

  /**
   * Lista projetos onde o usuário é membro, com filtro opcional por time.
   *
   * Busca DVincula roles [-171,-172,-173] WHERE idEntidade=userEntidadeId
   * e retorna DProjects correspondentes. N+1 ZERO via batch paralelo:
   * 1 query para roles, 1 query pré-resolvendo teamProjectIds (se filtrado),
   * 3 queries em paralelo (DProjects, member counts, team links).
   *
   * Se `opts.teamId` informado, intersecta com projetos vinculados ao time
   * via DVincula -182 PROJECT_TEAM_LINK (ADR-V2-029). Implementa validação
   * de cross-org no service (soft-delete antes de create na mesma transação).
   *
   * Cursor pagination escalável. Bug crítico corrigido: ao combinar filtro
   * `teamId + cursor`, ambos ficam no mesmo `idLocEscritu` object para evitar
   * que spread consecutivo sobrescreva silenciosamente a condição de team.
   *
   * @param userEntidadeId - Chave BigInt da DEntidade do usuário logado
   * @param opts - Opções (cursor, limit, teamId)
   * @returns Promise com lista paginada de ProjectResponseDto (`teamId` resolvido)
   *
   * @throws {NotFoundException} Se time (ao filtrado) não existe
   *
   * @example
   * ```typescript
   * // Lista todos os projetos do usuário (primeira página)
   * const page1 = await service.findMany(BigInt(userId));
   *
   * // Filtra apenas projetos do time 200
   * const filtered = await service.findMany(BigInt(userId), { teamId: '200', limit: 20 });
   *
   * // Paginação com cursor
   * const page2 = await service.findMany(BigInt(userId), { cursor: '15' });
   * ```
   *
   * @see ADR-V2-029 — Project ↔ Team via DVincula -182
   * @see FindManyProjectsOptions — interface de opções
   */
  async findMany(
    userEntidadeId: bigint,
    opts: FindManyProjectsOptions = {},
  ): Promise<ListProjectResponseDto> {
    const { cursor, teamId, organizationId } = opts;
    const take = Math.min(opts.limit ?? 20, 100);

    // ADR-V2-042: organizationId vira filtro de tenant via DProject.idEstab.
    // Convertendo aqui para BigInt — strings invalidas (raras: JWT corrompido)
    // resultam em lista vazia em vez de quebrar.
    let orgIdBig: bigint | undefined;
    if (organizationId !== undefined) {
      if (!/^-?\d+$/.test(organizationId)) {
        this.logger.warn(`findMany: organizationId invalido="${organizationId}" — retorna vazio`);
        return { items: [], pagination: { hasMore: false, nextCursor: null } };
      }
      orgIdBig = BigInt(organizationId);
    }

    // 1) Se filtrado por team, pré-resolver os projectIds do time.
    let teamProjectIds: bigint[] | undefined;
    if (teamId) {
      const teamLinks = await this.prisma.dVincula.findMany({
        where: {
          idLocEscritu: BigInt(teamId),
          idClasse: ID_CLASSE_PROJECT_TEAM_LINK,
          excluido: false,
        },
        select: { idEntidade: true },
      });
      teamProjectIds = teamLinks.map((v) => v.idEntidade).filter((v): v is bigint => v !== null);

      if (teamProjectIds.length === 0) {
        return { items: [], pagination: { hasMore: false, nextCursor: null } };
      }
    }

    // 2) Query: DVincula das project-roles do usuário, intersectado opcionalmente
    //    com os projectIds do time.
    const vinculos = await this.prisma.dVincula.findMany({
      where: {
        idEntidade: userEntidadeId,
        idClasse: { in: PROJECT_ROLE_CLASSES },
        excluido: false,
        // Combina filtros de team + cursor no mesmo objeto idLocEscritu.
        // Spreads consecutivos com a mesma chave fazem o segundo sobrescrever
        // o primeiro silenciosamente — bug detectado no review da Task 19.
        ...(teamProjectIds && cursor
          ? { idLocEscritu: { in: teamProjectIds, lt: BigInt(cursor) } }
          : teamProjectIds
            ? { idLocEscritu: { in: teamProjectIds } }
            : cursor
              ? { idLocEscritu: { lt: BigInt(cursor) } }
              : {}),
      },
      select: {
        idLocEscritu: true,
      },
      take: take + 1,
      orderBy: { idLocEscritu: 'desc' },
    });

    const hasMore = vinculos.length > take;
    const pageVinculos = hasMore ? vinculos.slice(0, take) : vinculos;
    const projectIds = pageVinculos.map((v) => v.idLocEscritu);

    if (projectIds.length === 0) {
      return { items: [], pagination: { hasMore: false, nextCursor: null } };
    }

    // 3) Batch: DProjects + contagem de membros + vínculos de team (N+1 ZERO).
    //    ADR-V2-042: aplicar filtro de org em DProject.findMany. Projetos
    //    listados em memberships mas pertencentes a outra org NAO entram
    //    no resultado.
    const [projects, memberCounts, teamLinks] = await Promise.all([
      this.prisma.dProject.findMany({
        where: {
          chave: { in: projectIds },
          excluido: false,
          ...(orgIdBig !== undefined ? { idEstab: orgIdBig } : {}),
        },
        orderBy: { chave: 'desc' },
      }),
      this.prisma.dVincula.groupBy({
        by: ['idLocEscritu'],
        where: {
          idLocEscritu: { in: projectIds },
          idClasse: { in: PROJECT_ROLE_CLASSES },
          excluido: false,
        },
        _count: { chave: true },
      }),
      this.prisma.dVincula.findMany({
        where: {
          idEntidade: { in: projectIds },
          idClasse: ID_CLASSE_PROJECT_TEAM_LINK,
          excluido: false,
        },
        select: { idEntidade: true, idLocEscritu: true },
      }),
    ]);

    const countMap = new Map(
      memberCounts.map((mc) => [mc.idLocEscritu.toString(), mc._count.chave]),
    );
    const teamMap = new Map(
      teamLinks
        .filter((t) => t.idEntidade !== null)
        .map((t) => [(t.idEntidade as bigint).toString(), t.idLocEscritu.toString()]),
    );

    const items: ProjectResponseDto[] = projects.map((p) =>
      this.buildResponse(
        p,
        countMap.get(p.chave.toString()) ?? 0,
        teamMap.get(p.chave.toString()) ?? null,
      ),
    );

    // nextCursor segue o ultimo membership da pagina (nao o ultimo project),
    // pois o cursor controla iteracao em DVincula. Se org filtrou tudo desta
    // pagina, hasMore continua valido para que o client peca a proxima pagina.
    const nextCursor = hasMore
      ? pageVinculos[pageVinculos.length - 1].idLocEscritu.toString()
      : null;

    return { items, pagination: { hasMore, nextCursor } };
  }

  /**
   * Lista todos os IDs de projetos acessiveis ao usuario, opcionalmente
   * filtrados por organizacao (ADR-V2-042).
   *
   * Uso interno para callers que precisam aplicar escopo de projeto antes de
   * consultar outro agregado canonico, como tools MCP de tasks.
   *
   * Quando `organizationId` informado, retorna apenas projetos cujo
   * `DProject.idEstab === organizationId`. Quando omitido, retorna todos os
   * projetos onde o usuario e membro (modo MCP / cross-org by design).
   *
   * @param userEntidadeId - Chave BigInt da DEntidade do usuario
   * @param organizationId - `DEntidade.chave` da org ativa (string com BigInt). Opcional.
   * @returns IDs de projetos acessiveis, serializados como string
   */
  async findAccessibleProjectIds(
    userEntidadeId: bigint,
    organizationId?: string,
  ): Promise<string[]> {
    const vinculos = await this.prisma.dVincula.findMany({
      where: {
        idEntidade: userEntidadeId,
        idClasse: { in: PROJECT_ROLE_CLASSES },
        excluido: false,
      },
      select: { idLocEscritu: true },
      orderBy: { idLocEscritu: 'desc' },
    });

    const candidateIds = Array.from(new Set(vinculos.map((v) => v.idLocEscritu.toString())));

    // Sem org → comportamento legado (MCP keys, callers internos).
    if (!organizationId) {
      return candidateIds;
    }

    if (!/^-?\d+$/.test(organizationId)) {
      this.logger.warn(
        `findAccessibleProjectIds: organizationId invalido="${organizationId}" — retorna vazio`,
      );
      return [];
    }

    if (candidateIds.length === 0) {
      return [];
    }

    // Cruza com DProject.idEstab — UMA query batch, ZERO N+1.
    const orgIdBig = BigInt(organizationId);
    const scoped = await this.prisma.dProject.findMany({
      where: {
        chave: { in: candidateIds.map((s) => BigInt(s)) },
        idEstab: orgIdBig,
        excluido: false,
      },
      select: { chave: true },
    });

    return scoped.map((p) => p.chave.toString());
  }

  /**
   * Busca projeto por ID, verificando membership do usuário e (opcionalmente)
   * tenant do projeto.
   *
   * ADR-V2-042: quando `organizationId` informado, projetos de outras orgs
   * retornam 404 (mensagem identica a "nao encontrado" — anti enumeration
   * attack).
   *
   * @param id - Chave BigInt do projeto (string)
   * @param userEntidadeId - Chave BigInt do usuário (deve ser membro)
   * @param organizationId - `DEntidade.chave` da org ativa (string). Opcional.
   * @returns ProjectResponseDto (`teamId` resolvido)
   *
   * @throws {NotFoundException} Se projeto não encontrado OU em outra org
   * @throws {ForbiddenException} Se usuário não é membro
   *
   * @example
   * ```typescript
   * const project = await service.findOne('1', BigInt(userId), '50');
   * ```
   */
  async findOne(
    id: string,
    userEntidadeId: bigint,
    organizationId?: string,
  ): Promise<ProjectResponseDto> {
    const projectId = BigInt(id);

    const [project, vinculo, teamLink] = await Promise.all([
      this.prisma.dProject.findFirst({
        where: { chave: projectId, excluido: false },
      }),
      this.prisma.dVincula.findFirst({
        where: {
          idLocEscritu: projectId,
          idEntidade: userEntidadeId,
          idClasse: { in: PROJECT_ROLE_CLASSES },
          excluido: false,
        },
        select: { chave: true },
      }),
      this.prisma.dVincula.findFirst({
        where: {
          idEntidade: projectId,
          idClasse: ID_CLASSE_PROJECT_TEAM_LINK,
          excluido: false,
        },
        select: { idLocEscritu: true },
      }),
    ]);

    if (!project) {
      throw new NotFoundException(`Projeto ${id} não encontrado`);
    }
    // ADR-V2-042: cross-tenant via path param. Resposta 404 (nao 403) para
    // evitar enumeration ("este projeto existe mas nao e seu").
    if (organizationId && /^-?\d+$/.test(organizationId)) {
      const orgIdBig = BigInt(organizationId);
      if (project.idEstab === null || project.idEstab !== orgIdBig) {
        this.logger.warn(
          `tenant_mismatch_project_findOne projectId=${id} jwtOrg=${organizationId} projectOrg=${
            project.idEstab?.toString() ?? 'null'
          }`,
        );
        throw new NotFoundException(`Projeto ${id} não encontrado`);
      }
    }
    if (!vinculo) {
      throw new ForbiddenException('Acesso negado: você não é membro deste projeto');
    }

    const memberCount = await this.prisma.dVincula.count({
      where: {
        idLocEscritu: projectId,
        idClasse: { in: PROJECT_ROLE_CLASSES },
        excluido: false,
      },
    });

    return this.buildResponse(project, memberCount, teamLink?.idLocEscritu.toString() ?? null);
  }

  /**
   * Atualiza projeto (apenas MANAGER pode).
   *
   * Suporta atualização do vínculo de time (ADR-V2-029) via `dto.teamId`:
   *  - `'teamId' in dto === false` → vínculo inalterado.
   *  - `dto.teamId === null` → soft-delete do vínculo atual (desvincula).
   *  - `dto.teamId === string` → soft-delete antigo + cria novo (reatribui).
   *
   * Eventos emitidos APÓS commit:
   *  - `project.team.linked` (X→Y ou null→Y)
   *  - `project.team.unlinked` (X→null)
   *
   * @param id - Chave BigInt do projeto (string)
   * @param dto - Campos a atualizar
   * @param userEntidadeId - Chave BigInt do MANAGER executante
   * @returns ProjectResponseDto atualizada (`teamId` resolvido)
   *
   * @throws {NotFoundException} Se projeto não encontrado
   * @throws {ForbiddenException} Se usuário não é MANAGER, ou se time
   *   informado é de outra org ou sem permissão (LEAD/ADMIN).
   *
   * @example
   * ```typescript
   * await service.update('1', { teamId: '200' }, BigInt(managerId));     // reatribui
   * await service.update('1', { teamId: null }, BigInt(managerId));      // desvincula
   * ```
   */
  async update(
    id: string,
    dto: UpdateProjectDto,
    userEntidadeId: bigint,
    organizationId?: string,
  ): Promise<ProjectResponseDto> {
    const projectId = BigInt(id);

    // ADR-V2-042: tenant check ANTES de qualquer query/RBAC para evitar
    // enumeration de projetos via mensagem de erro RBAC.
    if (organizationId && /^-?\d+$/.test(organizationId)) {
      const orgIdBig = BigInt(organizationId);
      const peek = await this.prisma.dProject.findFirst({
        where: { chave: projectId, excluido: false },
        select: { idEstab: true },
      });
      if (!peek || peek.idEstab === null || peek.idEstab !== orgIdBig) {
        throw new NotFoundException(`Projeto ${id} não encontrado`);
      }
    }

    await this.requireManagerRole(projectId, userEntidadeId);

    const project = await this.prisma.dProject.findFirst({
      where: { chave: projectId, excluido: false },
    });

    if (!project) {
      throw new NotFoundException(`Projeto ${id} não encontrado`);
    }

    // Determinar se o teamId foi enviado pelo cliente (incluindo null
    // explícito). Não usar `dto.teamId !== undefined` — distinção pode ser
    // perdida por validators/serializers.
    const teamIdProvided = 'teamId' in dto;

    // Resolver teamId anterior (para audit de previousTeamId e detecção
    // no-op). Single query indexada.
    let previousTeamLinkId: bigint | null = null;
    let previousTeamId: string | null = null;
    if (teamIdProvided) {
      const existing = await this.prisma.dVincula.findFirst({
        where: {
          idEntidade: projectId,
          idClasse: ID_CLASSE_PROJECT_TEAM_LINK,
          excluido: false,
        },
        select: { chave: true, idLocEscritu: true },
      });
      previousTeamLinkId = existing?.chave ?? null;
      previousTeamId = existing?.idLocEscritu.toString() ?? null;
    }

    // repoUrl: undefined = não toca, null = limpa, string = novo valor (ADR-V2-043).
    const effectiveRepoUrl: string | null | undefined =
      'repoUrl' in dto ? (dto.repoUrl ?? null) : undefined;

    const dadosAtuais = (project.dados as Record<string, unknown>) ?? {};
    const novosDados: Record<string, unknown> = {
      ...dadosAtuais,
      ...(dto.prefix !== undefined ? { prefix: dto.prefix } : {}),
      ...(dto.automationEnabled !== undefined ? { automationEnabled: dto.automationEnabled } : {}),
      ...(dto.description !== undefined ? { description: dto.description } : {}),
    };

    const updated = await this.prisma.$transaction(async (tx) => {
      const u = await tx.dProject.update({
        where: { chave: projectId },
        data: {
          ...(dto.nome !== undefined ? { nome: dto.nome } : {}),
          ...(dto.description !== undefined ? { descricao: dto.description } : {}),
          ...(effectiveRepoUrl !== undefined ? { repoUrl: effectiveRepoUrl } : {}),
          dados: novosDados as Prisma.InputJsonValue,
        },
      });

      if (teamIdProvided) {
        // Soft-delete vínculo atual (se houver) ANTES de criar novo —
        // garante invariante N:1 mesmo em caso de race condition no
        // service (a transação serializa os UPDATEs).
        if (previousTeamLinkId !== null) {
          await tx.dVincula.update({
            where: { chave: previousTeamLinkId },
            data: { excluido: true },
          });
        }

        if (dto.teamId !== null && dto.teamId !== undefined) {
          await this.validateTeamForLink(tx, BigInt(dto.teamId), u.idEstab ?? null, userEntidadeId);
          await tx.dVincula.create({
            data: {
              idClasse: ID_CLASSE_PROJECT_TEAM_LINK,
              idLocEscritu: BigInt(dto.teamId),
              idEntidade: projectId,
            },
          });
        }
      }

      return u;
    });

    const memberCount = await this.prisma.dVincula.count({
      where: {
        idLocEscritu: projectId,
        idClasse: { in: PROJECT_ROLE_CLASSES },
        excluido: false,
      },
    });

    // Resolver teamId final para o response (após commit).
    let finalTeamId: string | null;
    if (teamIdProvided) {
      finalTeamId = dto.teamId ?? null;
    } else {
      const current = await this.prisma.dVincula.findFirst({
        where: {
          idEntidade: projectId,
          idClasse: ID_CLASSE_PROJECT_TEAM_LINK,
          excluido: false,
        },
        select: { idLocEscritu: true },
      });
      finalTeamId = current?.idLocEscritu.toString() ?? null;
    }

    // Audit APÓS commit (ADR-V2-029) — apenas se mudou de fato.
    if (teamIdProvided && previousTeamId !== finalTeamId) {
      const correlationId = this.correlationIdService.getOrGenerate();
      if (finalTeamId === null) {
        await this.eventProducer.addInternalEvent(
          'project.team.unlinked',
          {
            projectId: id,
            teamId: null,
            previousTeamId,
            userId: userEntidadeId.toString(),
          },
          correlationId,
          { source: ProjectsService.name },
        );
      } else {
        await this.eventProducer.addInternalEvent(
          'project.team.linked',
          {
            projectId: id,
            teamId: finalTeamId,
            previousTeamId,
            userId: userEntidadeId.toString(),
          },
          correlationId,
          { source: ProjectsService.name },
        );
      }
    }

    return this.buildResponse(updated, memberCount, finalTeamId);
  }

  /**
   * Soft-delete do projeto.
   *
   * Cascades em transaction:
   * - DVincula de membros do projeto (`idLocEscritu=projectId`)
   * - DTask do projeto (soft delete)
   * - DProject (soft delete)
   *
   * Vínculos `-182 PROJECT_TEAM_LINK` (`idEntidade=projectId`) também são
   * soft-deletados pelo `updateMany` por `idEntidade` — `excluido=true`
   * preserva o histórico.
   *
   * Audit project.deleted emitido APÓS commit.
   *
   * @param id - Chave BigInt do projeto (string)
   * @param userEntidadeId - Chave BigInt do MANAGER executante
   *
   * @throws {NotFoundException} Se projeto não encontrado
   * @throws {ForbiddenException} Se não é MANAGER
   *
   * @example
   * ```typescript
   * await service.delete('1', BigInt(managerId));
   * ```
   */
  async delete(
    id: string,
    userEntidadeId: bigint,
    organizationId?: string,
  ): Promise<DeleteProjectResponseDto> {
    const projectId = BigInt(id);

    // ADR-V2-042: tenant check ANTES de qualquer query/RBAC.
    if (organizationId && /^-?\d+$/.test(organizationId)) {
      const orgIdBig = BigInt(organizationId);
      const peek = await this.prisma.dProject.findFirst({
        where: { chave: projectId, excluido: false },
        select: { idEstab: true },
      });
      if (!peek || peek.idEstab === null || peek.idEstab !== orgIdBig) {
        throw new NotFoundException(`Projeto ${id} não encontrado`);
      }
    }

    await this.requireManagerRole(projectId, userEntidadeId);

    const project = await this.prisma.dProject.findFirst({
      where: { chave: projectId, excluido: false },
      select: { chave: true, nome: true },
    });

    if (!project) {
      throw new NotFoundException(`Projeto ${id} não encontrado`);
    }

    const counts = await this.prisma.$transaction(async (tx) => {
      // Cascade: DVincula dos membros (idLocEscritu=projectId).
      const membersResult = await tx.dVincula.updateMany({
        where: { idLocEscritu: projectId, excluido: false },
        data: { excluido: true },
      });

      // Cascade: DVincula -182 PROJECT_TEAM_LINK (idEntidade=projectId).
      await tx.dVincula.updateMany({
        where: {
          idEntidade: projectId,
          idClasse: ID_CLASSE_PROJECT_TEAM_LINK,
          excluido: false,
        },
        data: { excluido: true },
      });

      // Cascade: DTask do projeto
      const tasksResult = await tx.dTask.updateMany({
        where: { idProject: projectId, excluido: false },
        data: { excluido: true },
      });

      // Soft delete do projeto
      await tx.dProject.update({
        where: { chave: projectId },
        data: { excluido: true },
      });

      return { tasks: tasksResult.count, members: membersResult.count };
    });

    // Audit APÓS commit — tipo project.deleted → idClasse=-499 PROJECT_LIFECYCLE (ADR-V2-027)
    await this.eventProducer.addInternalEvent(
      'project.deleted',
      {
        projectId: id,
        nome: project.nome,
        userId: userEntidadeId.toString(),
      },
      this.correlationIdService.getOrGenerate(),
      { source: ProjectsService.name },
    );

    this.logger.log(`Projeto ${projectId} deletado por user=${userEntidadeId}`);

    return {
      deleted: true,
      id,
      projectName: project.nome,
      counts: {
        tasks: counts.tasks,
        members: counts.members,
        webhooks: 0,
        notifications: 0,
      },
    };
  }

  /**
   * Retorna contadores de tasks por status V3 do projeto.
   *
   * Busca DTask do projeto agrupando por idStatus.
   * N+1 ZERO — 1 query groupBy.
   *
   * @param id - Chave BigInt do projeto (string)
   * @param userEntidadeId - Chave BigInt do usuário (deve ser membro)
   * @returns Contadores por status + total
   *
   * @example
   * ```typescript
   * const stats = await service.getStats('1', BigInt(userId));
   * ```
   */
  async getStats(
    id: string,
    userEntidadeId: bigint,
    organizationId?: string,
  ): Promise<ProjectStatsDto> {
    // Verificar acesso (findOne ja inclui tenant check)
    await this.findOne(id, userEntidadeId, organizationId);

    const projectId = BigInt(id);

    // Buscar DTabela dos statuses V3 do projeto para montar mapa idStatus → nome
    const statusTabelas = await this.prisma.dTabela.findMany({
      where: {
        dEntidadeId: projectId,
        idClasse: {
          in: [
            BigInt(-441),
            BigInt(-442),
            BigInt(-443),
            BigInt(-444),
            BigInt(-445),
            BigInt(-446),
            BigInt(-447),
            BigInt(-448),
            BigInt(-449),
          ],
        },
        excluido: false,
      },
      select: { chave: true, nome: true, idClasse: true },
    });

    const statusIdToName = new Map(statusTabelas.map((s) => [s.chave.toString(), s.nome]));

    // Contar tasks por status
    const taskCounts = await this.prisma.dTask.groupBy({
      by: ['idStatus'],
      where: { idProject: projectId, excluido: false },
      _count: { chave: true },
    });

    const statusCounts: Record<string, number> = {};
    let totalTasks = 0;

    for (const tc of taskCounts) {
      const statusName = tc.idStatus
        ? (statusIdToName.get(tc.idStatus.toString()) ?? 'UNKNOWN')
        : 'NO_STATUS';
      statusCounts[statusName] = tc._count.chave;
      totalTasks += tc._count.chave;
    }

    return { statusCounts, totalTasks };
  }

  // ─── Slug derivation (ADR-V2-030) ────────────────────────────────────────

  /**
   * Deriva slug único para um projeto a partir do nome.
   *
   * Algoritmo:
   *  1. `slugify(nome)` — normaliza e produz candidato base.
   *  2. Se candidato vazio (nome só de símbolos), usa `fallbackSlug()`.
   *  3. Loop de colisão: se `<candidato>` já existe em `DProject.dados.slug`
   *     (excluido=false), tenta `<candidato>-2`, `<candidato>-3`... até livre.
   *
   * Detecção de colisão em DProject.dados (Json) usa Prisma `path` filter,
   * que mapeia para `dados->>'slug' = ?` no Postgres — coerente com o
   * índice expression único criado pela migration desta sub-tarefa.
   *
   * @param tx - Cliente Prisma (transação ou raiz). Permite reuso dentro
   *   do `$transaction` do `create()` sem nova conexão.
   * @param nome - Nome bruto do projeto.
   * @param ignoreProjectId - Quando informado, ignora colisão com este
   *   project específico (usado no backfill para não considerar o próprio
   *   projeto como conflito caso ele já tenha um slug parcial).
   * @returns Slug único pronto pra persistir em `dados.slug`.
   */
  private async deriveUniqueSlug(
    tx: Prisma.TransactionClient | PrismaService,
    nome: string,
    ignoreProjectId?: bigint,
  ): Promise<string> {
    const base = slugify(nome) || fallbackSlug();
    let candidate = base;
    let suffix = 2;

    // Loop de colisão. Bound superior defensivo (>1000 colisões é sinal de
    // bug ou ataque — abortar com erro alto pra investigar).
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (suffix > 1000) {
        throw new Error(
          `slug_collision_overflow: mais de 1000 colisões para base="${base}". Investigar.`,
        );
      }

      const conflict = await tx.dProject.findFirst({
        where: {
          dados: { path: ['slug'], equals: candidate },
          excluido: false,
          ...(ignoreProjectId !== undefined ? { chave: { not: ignoreProjectId } } : {}),
        },
        select: { chave: true },
      });

      if (!conflict) {
        return candidate;
      }

      candidate = `${base}-${suffix}`;
      suffix += 1;
    }
  }

  /**
   * Backfill idempotente: gera `dados.slug` para projetos sem slug.
   *
   * Estratégia:
   *  - Busca em batches de `BACKFILL_BATCH_SIZE` projetos com `dados.slug`
   *    ausente (Postgres `dados->>'slug' IS NULL`).
   *  - Para cada um, deriva slug único (respeitando colisão com projetos
   *    que já têm slug) e dá `dProject.update` mergeando em `dados`.
   *  - Log início e fim com contadores. Erros individuais como warn.
   *  - Idempotente: rodar 2× é no-op no segundo run (lista vazia).
   *
   * Inline no boot (não em job BullMQ) por simplicidade — DProject realista
   * tem <10k registros. Se passar disso e o boot ficar lento (>5s), mover
   * pra worker fica trivial (mesma lógica, só muda quem chama).
   */
  private async backfillSlugs(): Promise<void> {
    let totalProcessed = 0;
    let totalErrors = 0;
    let batchIndex = 0;

    // Loop até esgotar projetos sem slug.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const pending = await this.prisma.dProject.findMany({
        where: {
          excluido: false,
          OR: [
            { dados: { equals: Prisma.JsonNull } },
            { dados: { path: ['slug'], equals: Prisma.AnyNull } },
          ],
        },
        select: { chave: true, nome: true, dados: true },
        take: ProjectsService.BACKFILL_BATCH_SIZE,
        orderBy: { chave: 'asc' },
      });

      if (pending.length === 0) {
        break;
      }

      if (batchIndex === 0) {
        this.logger.log(
          `backfill_slugs_started: ${pending.length} projetos no primeiro batch (batchSize=${ProjectsService.BACKFILL_BATCH_SIZE})`,
        );
      }

      for (const proj of pending) {
        try {
          const slug = await this.deriveUniqueSlug(this.prisma, proj.nome, proj.chave);
          const dadosAtuais = (proj.dados as Record<string, unknown> | null) ?? {};
          const novosDados = { ...dadosAtuais, slug };
          await this.prisma.dProject.update({
            where: { chave: proj.chave },
            data: { dados: novosDados as Prisma.InputJsonValue },
          });
          totalProcessed += 1;
        } catch (err) {
          totalErrors += 1;
          this.logger.warn(
            `backfill_slug_skip projectId=${proj.chave.toString()} reason="${(err as Error).message}"`,
          );
        }
      }

      batchIndex += 1;

      // Defesa final: se o batch retornou menos que o tamanho, não há mais
      // o que buscar. Sai antes do próximo round-trip.
      if (pending.length < ProjectsService.BACKFILL_BATCH_SIZE) {
        break;
      }
    }

    if (totalProcessed > 0 || totalErrors > 0) {
      this.logger.log(
        `backfill_slugs_finished: processados=${totalProcessed} erros=${totalErrors} batches=${batchIndex}`,
      );
    }
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────

  /**
   * Valida que o usuário é MANAGER do projeto.
   *
   * Helper para autorização. Usado em operações que alteram projeto
   * (update, delete, etc.). Lança ForbiddenException se não é MANAGER.
   *
   * @param projectId - Chave BigInt do projeto
   * @param userId - Chave BigInt do usuário
   * @throws {ForbiddenException} Se não é MANAGER
   *
   * @private
   */
  private async requireManagerRole(projectId: bigint, userId: bigint): Promise<void> {
    const vinculo = await this.prisma.dVincula.findFirst({
      where: {
        idLocEscritu: projectId,
        idEntidade: userId,
        idClasse: ID_CLASSE_PROJECT_MANAGER,
        excluido: false,
      },
      select: { chave: true },
    });

    if (!vinculo) {
      throw new ForbiddenException('Acesso negado: requer role MANAGER no projeto');
    }
  }

  /**
   * Valida que o time pode ser vinculado ao projeto (ADR-V2-029):
   *  1. Team existe (DEntidade idClasse=-180, excluido=false).
   *  2. Cross-org: team.idEstab === projectOrgId (bloqueia leak entre orgs).
   *  3. Permissão: usuário é LEAD do time OU ORG_ADMIN da org.
   *
   * @param tx - Cliente de transação ou this.prisma (tipos compatíveis).
   * @param teamId - Chave BigInt do time.
   * @param projectOrgId - Chave BigInt da org do projeto (pode ser null se
   *   projeto sem org explícita — nesse caso só LEAD valida).
   * @param userId - Chave BigInt do usuário.
   *
   * @throws {NotFoundException} Time não encontrado.
   * @throws {ForbiddenException} Cross-org leak ou sem permissão.
   */
  private async validateTeamForLink(
    tx: Prisma.TransactionClient | PrismaService,
    teamId: bigint,
    projectOrgId: bigint | null,
    userId: bigint,
  ): Promise<void> {
    // 1. Team existe?
    const team = await tx.dEntidade.findFirst({
      where: {
        chave: teamId,
        idClasse: ID_CLASSE_TEAM,
        excluido: false,
      },
      select: { chave: true, idEstab: true },
    });

    if (!team) {
      throw new NotFoundException(`Time ${teamId} não encontrado`);
    }

    // 2. Cross-org: time e projeto têm de pertencer à mesma org.
    //    Se projeto tem orgId definido, team.idEstab DEVE bater.
    //    Se projeto não tem orgId (null), aceitamos apenas times sem org
    //    (caso raro — apenas para preservar fluxos legados).
    if (projectOrgId !== null) {
      if (team.idEstab !== projectOrgId) {
        throw new ForbiddenException('Time selecionado não pertence a esta organização');
      }
    } else if (team.idEstab !== null) {
      throw new ForbiddenException('Time selecionado não pertence a esta organização');
    }

    // 3. Permissão: LEAD do time OU ORG_ADMIN da org.
    const membership = await tx.dVincula.findFirst({
      where: {
        idLocEscritu: teamId,
        idEntidade: userId,
        idClasse: ID_CLASSE_TEAM_MEMBERSHIP,
        excluido: false,
      },
      select: { metaDados: true },
    });

    const meta = membership?.metaDados as Record<string, unknown> | null;
    const cargo = meta?.cargo as string | undefined;

    if (cargo === 'LEAD') {
      return; // LEAD do time — autorizado
    }

    if (team.idEstab) {
      const isOrgAdmin = await tx.dVincula.findFirst({
        where: {
          idLocEscritu: team.idEstab,
          idEntidade: userId,
          idClasse: ID_CLASSE_ORG_ADMIN,
          excluido: false,
        },
        select: { chave: true },
      });

      if (isOrgAdmin) {
        return; // ADMIN da org — autorizado
      }
    }

    throw new ForbiddenException(
      'Acesso negado: requer cargo LEAD no time ou ADMIN na organização',
    );
  }

  private buildResponse(
    project: {
      chave: bigint;
      nome: string;
      descricao?: string | null;
      idEstab?: bigint | null;
      dados?: unknown;
      repoUrl?: string | null;
      criadoEm: Date;
      atualizadoEm: Date;
    },
    memberCount: number,
    teamId: string | null,
  ): ProjectResponseDto {
    const dados = project.dados as Record<string, unknown> | null;

    return {
      id: project.chave.toString(),
      nome: project.nome,
      prefix: (dados?.prefix as string | null) ?? 'DEV',
      description: (dados?.description as string | null | undefined) ?? project.descricao ?? null,
      orgId: project.idEstab?.toString() ?? null,
      memberCount,
      repoUrl: project.repoUrl ?? null,
      teamId,
      criadoEm: project.criadoEm.toISOString(),
      atualizadoEm: project.atualizadoEm.toISOString(),
    };
  }

}

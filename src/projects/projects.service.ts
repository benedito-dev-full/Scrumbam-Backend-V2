import {
  BadRequestException,
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
import { validateNoCycle } from './utils/anti-cycle.util';
import { validateTableFields } from '../tasks/table-fields/table-fields.validator';

/** idClasse de DProject no seed F1 (classes canônicas V2). Fallback legado. */
const ID_CLASSE_PROJECT = BigInt(-153); // SCRUMBAN_PROJECT (seed classes.seed.ts)

/** idClasse DProject para SPACE (ADR-V2-051 §3.2). Raiz da hierarquia — sem pai. */
const ID_CLASSE_SPACE = BigInt(-350);

/** idClasse DProject para FOLDER (ADR-V2-051 §3.2). Filho de SPACE. */
const ID_CLASSE_FOLDER = BigInt(-351);

/**
 * idClasse DProject para LIST (ADR-V2-051 §3.2).
 * Apenas LISTs recebem seed de statuses V3 e sprint default —
 * SPACEs (-350) e FOLDERs (-351) são contêineres estruturais.
 */
const ID_CLASSE_LIST = BigInt(-352);

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
/** idClasse de DVincula FOLDER_PROJECT_LINK (ADR-V2-FOLDERS-001). */
const ID_CLASSE_FOLDER_PROJECT_LINK = BigInt(-183);
/** idClasse de DVincula ORG_ROLE_ADMIN (seed F1). */
const ID_CLASSE_ORG_ADMIN = BigInt(-161);
const ID_CLASSE_ORG_MEMBER = BigInt(-162);
const ID_CLASSE_ORG_VIEWER = BigInt(-163);

/** Todos os roles de org — qualquer um deles qualifica o usuário como membro. */
const ORG_ROLE_CLASSES = [ID_CLASSE_ORG_ADMIN, ID_CLASSE_ORG_MEMBER, ID_CLASSE_ORG_VIEWER];

/** Campos de DProject necessarios para montar ProjectResponseDto. */
const PROJECT_RESPONSE_SELECT = {
  chave: true,
  idClasse: true,
  idPai: true,
  nome: true,
  descricao: true,
  idEstab: true,
  dados: true,
  repoUrl: true,
  privado: true,
  tableFields: true,
  criadoEm: true,
  atualizadoEm: true,
} satisfies Prisma.DProjectSelect;

/**
 * Opções para `findMany()`.
 *
 * @see ADR-V2-029 (teamId filter)
 * @see ADR-V2-042 (organizationId obrigatorio para isolamento multi-tenant)
 * @see ADR-V2-051 (idClasse/idPai hierarquia Space/Folder/List)
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
  /**
   * Filtra por idClasse do DProject (ADR-V2-051 hierarquia Space/Folder/List).
   *
   * Valores canônicos:
   * - `-350` SPACE (raiz)
   * - `-351` FOLDER (filho de SPACE)
   * - `-352` LIST (contém tasks)
   * - `-353` DOC
   *
   * Quando ausente, retorna todos os projetos do usuário independente do tipo.
   */
  idClasse?: string;
  /**
   * Filtra DProjects cujo `idPai` é igual a este valor.
   *
   * Permite listar FOLDERs de um SPACE específico ou LISTs de um FOLDER.
   * Quando ausente, não filtra por pai (retorna raízes e filhos).
   */
  idPai?: string;

  /**
   * Filtra pelo campo `DProject.privado`.
   *
   * - `true`  → apenas projetos privados
   * - `false` → apenas projetos públicos
   * - ausente → sem filtro (retorna ambos)
   *
   * O membership (DVincula) já garante isolamento por usuário/org.
   * Este filtro é adicional para exibição seletiva no frontend
   * (ex: listar apenas Spaces públicos da sidebar).
   */
  privado?: boolean;
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
   * 3. seedProject(): 9 statuses V3 + 1 sprint default (apenas para LIST -352)
   *    - SPACE (-350) e FOLDER (-351) são contêineres estruturais, sem seed
   *    - ADR-V2-051 §12: seedBootstrap condicional por idClasse
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
   * // Criar um LIST (com seed de statuses + sprint)
   * const list = await service.create(
   *   { nome: 'Sprint 1', idClasse: '-352', idPai: '100' },
   *   BigInt(userId)
   * );
   *
   * // Criar um SPACE (sem seed, apenas container)
   * const space = await service.create(
   *   { nome: 'Workspace', idClasse: '-350' },
   *   BigInt(userId)
   * );
   * ```
   *
   * @see SeedBootstrapService — responsavel pelo seed de statuses V3 e sprint
   * @see validateNoCycle — validacao de ciclo em idPai realizada internamente
   */
  async create(dto: CreateProjectDto, userEntidadeId: bigint): Promise<ProjectResponseDto> {
    this.logger.log(
      `Criando projeto nome="${dto.nome}" para user=${userEntidadeId}` +
        (dto.teamId ? ` (team=${dto.teamId})` : ''),
    );

    // Resolver idClasse efetivo: DTO tem precedência; fallback para -153 (legado).
    const effectiveIdClasse = dto.idClasse ? BigInt(dto.idClasse) : ID_CLASSE_PROJECT;

    // Validação hierárquica: ANTES da transaction para fail-fast.
    // validateHierarchyRule rejeita: SPACE com qualquer pai, FOLDER com pai
    // que não seja SPACE, LIST com pai que não seja FOLDER nem SPACE.
    if (dto.idPai !== undefined && dto.idPai !== null) {
      await this.validateHierarchyRule(effectiveIdClasse, dto.idPai);
    }

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
        ...(dto.color !== undefined ? { color: dto.color } : {}),
        ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
      };

      // Resolver idPai: string → BigInt, null → null, undefined → omitir.
      const idPaiValue =
        dto.idPai !== undefined && dto.idPai !== null ? BigInt(dto.idPai) : undefined;

      // 1. DProject
      const proj = await tx.dProject.create({
        data: {
          idClasse: effectiveIdClasse,
          nome: dto.nome,
          ...(dto.description ? { descricao: dto.description } : {}),
          ...(dto.orgId ? { idEstab: BigInt(dto.orgId) } : {}),
          ...(dto.repoUrl ? { repoUrl: dto.repoUrl } : {}),
          ...(idPaiValue !== undefined ? { idPai: idPaiValue } : {}),
          ...(dto.privado !== undefined ? { privado: dto.privado } : {}),
          dados: dadosPayload as Prisma.InputJsonValue,
        },
        select: PROJECT_RESPONSE_SELECT,
      });

      // 2. DVincula -171 (MANAGER): criador é MANAGER
      await this.projectMembers.createManagerLink(tx, proj.chave, userEntidadeId);

      // 3. Seed: 9 statuses V3 + 1 sprint default — apenas para LIST (ADR-V2-051 §12).
      //    SPACE (-350) e FOLDER (-351) são contêineres estruturais e não precisam
      //    de seed de statuses/sprint. Apenas LIST (-352) contém tasks.
      if (proj.idClasse === ID_CLASSE_LIST) {
        await this.seedBootstrap.seedProject(tx, proj.chave);
      }

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
    const { cursor, teamId, organizationId, idClasse, idPai, privado } = opts;
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

    // 2) Visibilidade de projetos — duas camadas (ADR-V2-051 + privado flag):
    //
    //    Camada A — Espaços públicos: se orgIdBig está presente e o usuário
    //    tem qualquer DVincula de org (-161/-162/-163) nessa org, TODOS os
    //    DProjects com privado=false e idEstab=orgId são visíveis sem DVincula
    //    de projeto. Isso garante que usuários convidados (que só têm -162/-163)
    //    vejam os espaços públicos imediatamente.
    //
    //    Camada B — Projetos privados / acesso explícito: DVincula -171/-172/-173
    //    existente para aquele projeto específico (independente de privado).
    //
    //    União das duas camadas, deduplicada via Set<string>.

    // Camada B: IDs de projetos com DVincula explícita do usuário.
    const vinculosExplicitos = await this.prisma.dVincula.findMany({
      where: {
        idEntidade: userEntidadeId,
        idClasse: { in: PROJECT_ROLE_CLASSES },
        excluido: false,
        ...(teamProjectIds
          ? { idLocEscritu: { in: teamProjectIds } }
          : {}),
      },
      select: { idLocEscritu: true },
    });
    const explicitSet = new Set(
      vinculosExplicitos
        .map((v) => v.idLocEscritu?.toString())
        .filter((v): v is string => v !== undefined),
    );

    // Camada A: espaços públicos da org (apenas quando orgIdBig está presente).
    let publicProjectIds: bigint[] = [];
    if (orgIdBig !== undefined) {
      // Verifica se o usuário é membro da org (tem qualquer DVincula -161/-162/-163).
      const orgVinculo = await this.prisma.dVincula.findFirst({
        where: {
          idEntidade: userEntidadeId,
          idLocEscritu: orgIdBig,
          idClasse: { in: ORG_ROLE_CLASSES },
          excluido: false,
        },
        select: { chave: true },
      });

      if (orgVinculo) {
        const publicProjects = await this.prisma.dProject.findMany({
          where: {
            idEstab: orgIdBig,
            privado: false,
            excluido: false,
            ...(teamProjectIds ? { chave: { in: teamProjectIds } } : {}),
            ...(idClasse !== undefined ? { idClasse: BigInt(idClasse) } : {}),
            ...(idPai !== undefined ? { idPai: BigInt(idPai) } : {}),
          },
          select: { chave: true },
        });
        publicProjectIds = publicProjects.map((p) => p.chave);
      }
    }

    // União: projetos com DVincula explícita + projetos públicos da org.
    const allIds = new Set<string>([
      ...explicitSet,
      ...publicProjectIds.map((id) => id.toString()),
    ]);

    if (allIds.size === 0) {
      return { items: [], pagination: { hasMore: false, nextCursor: null } };
    }

    // Cursor pagination sobre o conjunto unido (ordenado desc por chave).
    // Converte Set para array de BigInt, aplica cursor se necessário.
    let allIdsBig = Array.from(allIds).map((id) => BigInt(id));
    if (cursor) {
      const cursorBig = BigInt(cursor);
      allIdsBig = allIdsBig.filter((id) => id < cursorBig);
    }
    allIdsBig.sort((a, b) => (b > a ? 1 : b < a ? -1 : 0));

    const hasMore = allIdsBig.length > take;
    const projectIds = (hasMore ? allIdsBig.slice(0, take) : allIdsBig) as bigint[];

    if (projectIds.length === 0) {
      return { items: [], pagination: { hasMore: false, nextCursor: null } };
    }

    // 3) Batch: DProjects + contagem de membros + vínculos de team + folder (N+1 ZERO).
    //    ADR-V2-042: aplicar filtro de org em DProject.findMany. Projetos
    //    listados em memberships mas pertencentes a outra org NAO entram
    //    no resultado.
    //    ADR-V2-FOLDERS-001: folderId resolvido via DVincula -183 em batch.
    const [projects, memberCounts, teamLinks, folderMap] = await Promise.all([
      this.prisma.dProject.findMany({
        where: {
          chave: { in: projectIds },
          excluido: false,
          ...(orgIdBig !== undefined ? { idEstab: orgIdBig } : {}),
          // ADR-V2-051: filtro hierárquico por tipo (SPACE/FOLDER/LIST/DOC)
          ...(idClasse !== undefined ? { idClasse: BigInt(idClasse) } : {}),
          // ADR-V2-051: filtro por pai direto (ex: FOLDERs de um SPACE)
          ...(idPai !== undefined ? { idPai: BigInt(idPai) } : {}),
          // C5: filtro de privacidade — apenas quando explicitamente enviado
          ...(privado !== undefined ? { privado } : {}),
        },
        orderBy: { chave: 'desc' },
        select: PROJECT_RESPONSE_SELECT,
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
      this.resolveFolderIdsForProjects(projectIds),
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
        folderMap.get(p.chave.toString()) ?? null,
      ),
    );

    const nextCursor = hasMore
      ? projectIds[projectIds.length - 1].toString()
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

    const [project, vinculo, teamLink, folderLink] = await Promise.all([
      this.prisma.dProject.findFirst({
        where: { chave: projectId, excluido: false },
        select: PROJECT_RESPONSE_SELECT,
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
      this.prisma.dVincula.findFirst({
        where: {
          idEntidade: projectId,
          idClasse: ID_CLASSE_FOLDER_PROJECT_LINK,
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

    return this.buildResponse(
      project,
      memberCount,
      teamLink?.idLocEscritu.toString() ?? null,
      folderLink?.idLocEscritu.toString() ?? null,
    );
  }

  /**
   * Atualiza projeto (apenas MANAGER pode).
   *
   * Suporta atualização de múltiplos campos com validações críticas:
   *  - `idPai` (opcional): Novo pai na hierarquia. Validação anti-ciclo
   *    via `validateNoCycle()` ocorre antes da transaction — impede ciclos
   *    A→B→A ou A→B→C→A (ADR-V2-051 §12).
   *  - `teamId` (opcional): Atualização do vínculo de time (ADR-V2-029):
   *    * Omissão (`'teamId' in dto === false`) → vínculo inalterado
   *    * `null` → soft-delete do vínculo atual (desvincula)
   *    * `string` → soft-delete antigo + cria novo (reatribui)
   *
   * Eventos emitidos APÓS commit (ADR-V2-029):
   *  - `project.team.linked` (X→Y ou null→Y)
   *  - `project.team.unlinked` (X→null)
   *
   * @param id - Chave BigInt do projeto (string)
   * @param dto - Campos a atualizar (idPai, teamId, nome, prefix, etc.)
   * @param userEntidadeId - Chave BigInt do MANAGER executante
   * @param organizationId - (Opcional) DEntidade.chave da org ativa (para tenant isolation)
   * @returns ProjectResponseDto atualizada (`teamId` e `folderId` resolvidos)
   *
   * @throws {NotFoundException} Se projeto não encontrado ou tenant mismatch
   * @throws {ForbiddenException} Se usuário não é MANAGER, ou se time
   *   informado é de outra org ou sem permissão (LEAD/ADMIN).
   * @throws {BadRequestException} Se validação anti-ciclo falhar
   *
   * @example
   * ```typescript
   * // Reatribuir time
   * await service.update('1', { teamId: '200' }, BigInt(managerId));
   *
   * // Desvincula time
   * await service.update('1', { teamId: null }, BigInt(managerId));
   *
   * // Mover na hierarquia (valida anti-ciclo)
   * await service.update('1', { idPai: '99' }, BigInt(managerId));
   *
   * // Atualizar múltiplos campos
   * await service.update(
   *   '1',
   *   { nome: 'Sprint 2', prefix: 'S2', idPai: '100', teamId: '200' },
   *   BigInt(managerId)
   * );
   * ```
   *
   * @see validateNoCycle — funcao que valida ciclo em hierarquia (chamada aqui)
   * @see ADR-V2-029 — Project ↔ Team via DVincula -182
   * @see ADR-V2-051 § 12 — Hierarquia Space/Folder/List com anti-ciclo
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

    // Pré-condição: validar anti-ciclo antes de qualquer UPDATE de idPai (ADR-V2-051 §12).
    // NOTA: NÃO usar `'idPai' in dto` — com transform:true o class-transformer
    // instancia o DTO com todas as props declaradas em undefined, tornando `in`
    // sempre true e apagando o idPai existente. Usar !== undefined é correto.
    const idPaiProvided = dto.idPai !== undefined;
    if (idPaiProvided) {
      const novoPaiId = dto.idPai !== null && dto.idPai !== undefined
        ? BigInt(dto.idPai)
        : null;
      await validateNoCycle(this.prisma, projectId, novoPaiId);
    }

    // Determinar se o teamId foi enviado pelo cliente (incluindo null explícito).
    // NOTA: mesmo motivo do idPai — class-transformer com transform:true adiciona
    // todas as props declaradas com undefined, então 'teamId' in dto é sempre true.
    const teamIdProvided = dto.teamId !== undefined;

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
      ...(dto.color !== undefined ? { color: dto.color } : {}),
      ...(dto.icon !== undefined ? { icon: dto.icon } : {}),
    };

    // Schema de colunas customizáveis da Lista (Fase 3 — Table View).
    // Write DIRETO na coluna própria `tableFields` (NÃO merge em `dados`):
    // o objeto é substituído por inteiro (replace). Validamos unicidade de
    // key/order/options.id ANTES de persistir; o `version` do envelope é
    // apenas gravado (concorrência otimista é fase futura — decisão #4).
    if (dto.tableFields !== undefined) {
      validateTableFields(dto.tableFields);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Resolver valor efetivo de idPai: undefined = não toca, null = remove pai,
      // BigInt = novo pai. A validação anti-ciclo já ocorreu antes da transaction.
      let effectiveIdPai: bigint | null | undefined;
      if (idPaiProvided) {
        effectiveIdPai = dto.idPai !== null && dto.idPai !== undefined
          ? BigInt(dto.idPai)
          : null;
      }

      const u = await tx.dProject.update({
        where: { chave: projectId },
        data: {
          ...(dto.nome !== undefined ? { nome: dto.nome } : {}),
          ...(dto.description !== undefined ? { descricao: dto.description } : {}),
          ...(effectiveRepoUrl !== undefined ? { repoUrl: effectiveRepoUrl } : {}),
          ...(effectiveIdPai !== undefined ? { idPai: effectiveIdPai } : {}),
          ...(dto.privado !== undefined ? { privado: dto.privado } : {}),
          ...(dto.tableFields !== undefined
            ? { tableFields: dto.tableFields as unknown as Prisma.InputJsonValue }
            : {}),
          dados: novosDados as Prisma.InputJsonValue,
        },
        select: PROJECT_RESPONSE_SELECT,
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

    // Resolve folderId atual para preservar a flag no response (ADR-V2-FOLDERS-001).
    const folderLink = await this.prisma.dVincula.findFirst({
      where: {
        idEntidade: projectId,
        idClasse: ID_CLASSE_FOLDER_PROJECT_LINK,
        excluido: false,
      },
      select: { idLocEscritu: true },
    });

    return this.buildResponse(
      updated,
      memberCount,
      finalTeamId,
      folderLink?.idLocEscritu.toString() ?? null,
    );
  }

  /**
   * Soft-delete em cascata hierárquica do projeto.
   *
   * Cascades em transaction atomica (bottom-up via CTE recursiva):
   * 1. DTask do projeto (soft delete)
   * 2. DVincula de membros do projeto (`idLocEscritu=projectId`)
   * 3. DVincula `-182 PROJECT_TEAM_LINK` (`idEntidade=projectId`)
   * 4. DProject filho-por-filho (se houver, validado por idPai)
   * 5. DProject pai (soft delete no final)
   *
   * A cascata respeita a hierarquia (ADR-V2-051): deletar um FOLDER
   * deleta todos os LISTs dentro, depois suas TASKs, depois o FOLDER.
   * Deletes BOTTOM-UP garantem que:
   * - FK constraints nao sao violadas
   * - Auditoria de exclusao e preservada (excluido=true, nao hard delete)
   * - Restauracao futura e possivel (soft delete, nao hard delete)
   *
   * Audit project.deleted emitido APÓS commit.
   *
   * @param id - Chave BigInt do projeto (string)
   * @param userEntidadeId - Chave BigInt do MANAGER executante
   * @param organizationId - (Opcional) DEntidade.chave da org ativa (tenant isolation)
   * @returns DeleteProjectResponseDto com confirmacao
   *
   * @throws {NotFoundException} Se projeto não encontrado ou tenant mismatch
   * @throws {ForbiddenException} Se não é MANAGER
   *
   * @example
   * ```typescript
   * // Deletar um LIST (cascata: TASKs → DVinculas → DProject)
   * await service.delete('100', BigInt(managerId));
   *
   * // Deletar um FOLDER (cascata: LISTs → TASKs → todos vinculos → FOLDER)
   * await service.delete('50', BigInt(managerId));
   * ```
   *
   * @see DELETE com CTE recursiva em /utils/anti-cycle.util.ts (padrão similar)
   * @see ADR-V2-051 § 12 — Hierarquia com validacao de ciclo e cascade
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
      // 1. Coletar todos os descendentes via CTE recursiva (Space + Folders + Lists).
      //    Inclui o próprio projeto na raiz da árvore.
      const descendants = await tx.$queryRaw<Array<{ chave: bigint }>>`
        WITH RECURSIVE tree AS (
          SELECT "chave" FROM "DProject"
          WHERE "chave" = ${projectId} AND "excluido" = false

          UNION ALL

          SELECT p."chave" FROM "DProject" p
          INNER JOIN tree t ON p."idPai" = t."chave"
          WHERE p."excluido" = false
        )
        SELECT "chave" FROM tree
      `;

      const ids = descendants.map((d) => d.chave);

      // 2. Cascade bottom-up: Tasks filhas de todas as Lists coletadas.
      const tasksResult = await tx.dTask.updateMany({
        where: { idProject: { in: ids }, excluido: false },
        data: { excluido: true },
      });

      // 3. Cascade: DVincula de membros de todos os projetos coletados.
      const membersResult = await tx.dVincula.updateMany({
        where: { idLocEscritu: { in: ids }, excluido: false },
        data: { excluido: true },
      });

      // 4. Cascade: DVincula PROJECT_TEAM_LINK de todos os projetos coletados.
      await tx.dVincula.updateMany({
        where: {
          idEntidade: { in: ids },
          idClasse: ID_CLASSE_PROJECT_TEAM_LINK,
          excluido: false,
        },
        data: { excluido: true },
      });

      // 5. Soft-delete de todos os DProject descendentes (Lists, Folders, Space).
      await tx.dProject.updateMany({
        where: { chave: { in: ids }, excluido: false },
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
   * Valida as regras de hierarquia Space/Folder/List (ADR-V2-051).
   *
   * Regras:
   * - SPACE (-350): idPai deve ser null — Space é sempre raiz.
   * - FOLDER (-351): idPai deve apontar para um SPACE (-350).
   * - LIST (-352): idPai deve apontar para FOLDER (-351) ou SPACE (-350).
   * - Outros (legado -153, DOC -353, etc.): sem restrição hierárquica nova.
   *
   * Faz 1 query `dProject.findUnique` para verificar o idClasse do pai
   * antes de persistir — fail-fast, fora da transaction.
   *
   * @param idClasse - idClasse BigInt do projeto a criar
   * @param idPai - ID string do projeto pai (obrigatório ter valor quando chamado)
   *
   * @throws {BadRequestException} Se a hierarquia for inválida
   */
  private async validateHierarchyRule(idClasse: bigint, idPai: string): Promise<void> {
    // SPACE nunca pode ter pai — é raiz por definição.
    if (idClasse === ID_CLASSE_SPACE) {
      throw new BadRequestException('SPACE não pode ter projeto pai (é sempre raiz da hierarquia)');
    }

    // Para FOLDER e LIST: verificar o tipo do pai.
    if (idClasse === ID_CLASSE_FOLDER || idClasse === ID_CLASSE_LIST) {
      const pai = await this.prisma.dProject.findFirst({
        where: { chave: BigInt(idPai), excluido: false },
        select: { chave: true, idClasse: true },
      });

      if (!pai) {
        throw new BadRequestException(`Projeto pai ${idPai} não encontrado`);
      }

      if (idClasse === ID_CLASSE_FOLDER) {
        // FOLDER deve ter pai do tipo SPACE.
        if (pai.idClasse !== ID_CLASSE_SPACE) {
          throw new BadRequestException(
            'FOLDER deve ter um SPACE como pai direto (hierarquia inválida)',
          );
        }
      } else if (idClasse === ID_CLASSE_LIST) {
        // LIST deve ter pai do tipo FOLDER ou SPACE.
        if (pai.idClasse !== ID_CLASSE_FOLDER && pai.idClasse !== ID_CLASSE_SPACE) {
          throw new BadRequestException(
            'LIST deve ter um FOLDER ou SPACE como pai direto (hierarquia inválida)',
          );
        }
      }
    }
    // Outros tipos (legado -153, DOC -353, etc.): sem restrição — aceitar qualquer pai.
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
      idClasse: bigint;
      idPai?: bigint | null;
      nome: string;
      descricao?: string | null;
      idEstab?: bigint | null;
      dados?: unknown;
      repoUrl?: string | null;
      privado?: boolean;
      tableFields?: unknown;
      criadoEm: Date;
      atualizadoEm: Date;
    },
    memberCount: number,
    teamId: string | null,
    folderId: string | null = null,
  ): ProjectResponseDto {
    const dados = project.dados as Record<string, unknown> | null;

    return {
      id: project.chave.toString(),
      idClasse: project.idClasse.toString(),
      idPai: project.idPai?.toString() ?? null,
      nome: project.nome,
      prefix: (dados?.prefix as string | null) ?? 'DEV',
      description: (dados?.description as string | null | undefined) ?? project.descricao ?? null,
      orgId: project.idEstab?.toString() ?? null,
      memberCount,
      repoUrl: project.repoUrl ?? null,
      privado: project.privado ?? false,
      color: (dados?.color as string | null) ?? null,
      icon: (dados?.icon as string | null) ?? null,
      tableFields: (project.tableFields as ProjectResponseDto['tableFields'] | undefined) ?? null,
      teamId,
      folderId,
      criadoEm: project.criadoEm.toISOString(),
      atualizadoEm: project.atualizadoEm.toISOString(),
    };
  }

  /**
   * Resolve `folderId` para um lote de projects via DVincula -183.
   *
   * Uma única query indexada (idClasse + idEntidade IN). N+1 ZERO.
   * Retorna `Map<projectIdString, folderIdString | null>` com todos os
   * projects pré-inicializados como null (= limbo, sem pasta).
   *
   * @param projectIds - Chaves BigInt dos projects (pode ser vazio)
   * @returns Map de folderId resolvido por projectId
   *
   * @see ADR-V2-FOLDERS-001
   */
  private async resolveFolderIdsForProjects(
    projectIds: ReadonlyArray<bigint>,
  ): Promise<Map<string, string | null>> {
    const map = new Map<string, string | null>();
    if (projectIds.length === 0) {
      return map;
    }
    for (const pid of projectIds) {
      map.set(pid.toString(), null);
    }

    const links = await this.prisma.dVincula.findMany({
      where: {
        idClasse: ID_CLASSE_FOLDER_PROJECT_LINK,
        idEntidade: { in: [...projectIds] },
        excluido: false,
      },
      select: { idEntidade: true, idLocEscritu: true },
    });

    // Defesa contra mocks de testes legados que não retornam array para a
    // 4ª chamada de findMany; manter projects como null (limbo) sem crashar.
    if (Array.isArray(links)) {
      for (const link of links) {
        if (link.idEntidade !== null) {
          map.set(link.idEntidade.toString(), link.idLocEscritu.toString());
        }
      }
    }

    return map;
  }
}

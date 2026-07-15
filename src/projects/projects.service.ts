import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
  Optional,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { MetricsService } from '../common/observability/metrics.service';
import { AUTH_ERROR_CODES } from '../common/errors/error-codes';
import { EventProducerService } from '../eventos/core/event-producer.service';
import { CorrelationIdService } from '../common/services/correlation-id.service';
import { SeedBootstrapService } from './seed-bootstrap.service';
import { ProjectMembersService } from './project-members.service';
import { ProjectRefService } from './project-ref.service';
import { TasksIdentifierService } from '../tasks/tasks-identifier.service';
import { RoleResolverService } from '../auth/services/role-resolver.service';
import { parseTaskDados } from '../tasks/schemas/task-dados.schema';
import { CreateProjectDto } from './dto/create-project.dto';
import { CreateFromTemplateDto } from './dto/create-from-template.dto';
import { PromoteToTemplateDto } from './dto/promote-to-template.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import {
  ProjectResponseDto,
  ListProjectResponseDto,
  ProjectStatsDto,
} from './dto/project-response.dto';
import { DeleteProjectResponseDto } from './dto/delete-project-response.dto';
import { fallbackSlug, slugify } from './utils/slugify';
import { validateNoCycle } from './utils/anti-cycle.util';
import {
  isProjectPubliclyVisible,
  listPublicSpaceProjectIds,
  listPublicSpaceProjectIdsForOrgs,
} from './utils/public-space.util';
import { validateTableFields } from '../tasks/table-fields/table-fields.validator';
import { mergeBuiltinColumns } from '../tasks/table-fields/builtin-columns';
import {
  ID_CLASSE_TEMPLATE_LIST,
  ID_CLASSE_TEMPLATE_SPACE,
  TEMPLATE_CLASSES,
} from './constants/template-classes.const';

/** idClasse de DProject no seed F1 (classes canônicas V2). Fallback legado. */
const ID_CLASSE_PROJECT = BigInt(-153); // SCRUMBAN_PROJECT (seed classes.seed.ts)

/** idClasse DProject para SPACE (ADR-V2-051 §3.2). Raiz da hierarquia — sem pai. */
const ID_CLASSE_SPACE = BigInt(-350);

/** idClasse DProject para FOLDER (ADR-V2-051 §3.2). Filho de SPACE. */
const ID_CLASSE_FOLDER = BigInt(-351);

/**
 * idClasse DProject para LIST (ADR-V2-051 §3.2).
 * Apenas LISTs recebem seed de statuses V3 —
 * SPACEs (-350) e FOLDERs (-351) são contêineres estruturais.
 */
const ID_CLASSE_LIST = BigInt(-352);

/**
 * DClasses de template (`ID_CLASSE_TEMPLATE_LIST` -401, `ID_CLASSE_TEMPLATE_SPACE`
 * -402) e o conjunto `TEMPLATE_CLASSES` são importados da fonte única
 * `./constants/template-classes.const` (ADR-V2-061). `ID_CLASSE_TEMPLATE_LIST`
 * é remapeado para -352 LIST no clone (`cloneTree` com `fromTemplate=true`)
 * ANTES do seed/`if LIST`; `ID_CLASSE_TEMPLATE_SPACE` para -350 SPACE.
 */

/**
 * Mapa de remap de DClasse template→real aplicado a CADA nó do clone quando
 * `opts.fromTemplate === true` (feature Templates): -401→-352, -402→-350.
 * Aplicado ANTES de `tx.dProject.create` e ANTES do teste `=== ID_CLASSE_LIST`,
 * para que `seedProject`/`copyPhases` disparem na List materializada e o editor
 * (liga telas por -352/-350) reconheça o nó. Classes não-template ficam
 * inalteradas (Folders -351 e Lists -352 dentro de um Space-template).
 */
const TEMPLATE_CLASS_REMAP: ReadonlyMap<bigint, bigint> = new Map([
  [ID_CLASSE_TEMPLATE_LIST, ID_CLASSE_LIST],
  [ID_CLASSE_TEMPLATE_SPACE, ID_CLASSE_SPACE],
]);

/**
 * Mapa de remap de DClasse real→template aplicado a CADA nó do clone quando
 * `opts.toTemplate === true` (extensão da feature Templates — ADR-V2-062):
 * -352→-401, -350→-402. Construído como o INVERSO de `TEMPLATE_CLASS_REMAP`
 * (fonte única de verdade — evita hardcode duplicado).
 *
 * Só contém as chaves -352 (LIST) e -350 (SPACE) — logo um Folder (-351)
 * filho NUNCA é remapeado (não está no mapa), e uma List (-352) filha DENTRO
 * de um Space promovido É remapeada para -401 também, no mesmo padrão
 * simétrico já usado por `TEMPLATE_CLASS_REMAP` (aplicado a QUALQUER
 * profundidade da árvore, não só à raiz).
 */
const REAL_TO_TEMPLATE_CLASS_REMAP: ReadonlyMap<bigint, bigint> = new Map(
  [...TEMPLATE_CLASS_REMAP].map(([templateClasse, realClasse]) => [realClasse, templateClasse]),
);

/**
 * `true` quando o `idClasse` (string do query) referencia um template
 * (-401/-402). No catálogo de templates o caminho de visibilidade é dedicado
 * (bypassa DVincula/público); nas demais listagens os templates são excluídos.
 */
function isTemplateClasseFilter(idClasse: string | undefined): boolean {
  if (idClasse === undefined) return false;
  if (!/^-?\d+$/.test(idClasse)) return false;
  const v = BigInt(idClasse);
  return v === ID_CLASSE_TEMPLATE_LIST || v === ID_CLASSE_TEMPLATE_SPACE;
}

/**
 * idClasse de DTask FASE/BLOCO (ADR-V2-050). Estrutura organizacional dentro
 * de uma List (pode ter sub-fases via idPai). Copiada na duplicação de projeto;
 * tasks de trabalho (-154) NÃO são copiadas.
 */
const ID_CLASSE_PHASE = BigInt(-200);

/**
 * idClasse de DTask TASK de trabalho (card Scrumban). Copiada apenas no clone
 * de templates (`cloneTree` com `includeTasks=true`); a duplicação simples
 * (`duplicate()`) NÃO copia tasks -154.
 */
const ID_CLASSE_TASK = BigInt(-154);

/**
 * idClasse de DTabela INBOX (status V3 inicial) escopado por projeto
 * (`dEntidadeId = E`). Toda task clonada nasce neste status (reset molde-limpo).
 */
const ID_CLASSE_STATUS_INBOX = BigInt(-441);

/**
 * idClasses de DTabela PRIORITY (HIGH/MEDIUM/LOW/URGENT) escopadas por projeto.
 * Usadas para montar o mapa código→chave da List clone e remapear `idPriority`
 * das tasks copiadas (a List clone tem suas próprias priorities via seed).
 */
const PRIORITY_CLASSES = [BigInt(-421), BigInt(-422), BigInt(-423), BigInt(-424)];

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
   * Filtra templates por `dados.categoria` (catálogo — ADR-V2-061).
   *
   * Só tem efeito quando `idClasse` é um template (-401/-402); ignorado nas
   * listagens normais de projeto. Filtra por igualdade exata do JSON-path
   * `dados->>'categoria'`.
   */
  categoria?: string;

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
 * Opções do motor de deep-clone `cloneTree` (extraído de `duplicate`).
 *
 * Opções do motor de clone para a feature Templates (ver
 * `workspace/plans/plan-templates-feature.md`). Os defaults de cada opção
 * reproduzem EXATAMENTE o comportamento de `duplicate()` (esqueleto sem tasks,
 * raiz nasce ao lado com sufixo " (cópia)").
 *
 * `includeTasks=true` (Sub-fase 3) aciona a cópia das tasks de trabalho (-154)
 * via `copyTasks`. `novoNome`/`novoIcone`/`idPaiDestino` parametrizam a raiz.
 * A rota `from-template` e o remap de classe template→real são Sub-fase 4.
 */
interface CloneTreeOptions {
  /**
   * Copiar as tasks de trabalho (-154) além dos blocos/fases (-200).
   *
   * Default `false` = comportamento atual (esqueleto sem tasks). O caminho
   * `true` é implementado pela Sub-fase 3 (Templates). Declarado aqui apenas
   * como contrato forward-compat.
   */
  includeTasks?: boolean;

  /**
   * Sobrescreve o nome da raiz. Se ausente, usa `${node.nome} (cópia)` —
   * comportamento idêntico ao `duplicate()` atual.
   */
  novoNome?: string;

  /**
   * Sobrescreve `dados.icon` da raiz. Se ausente, não toca o ícone herdado —
   * comportamento idêntico ao `duplicate()` atual.
   */
  novoIcone?: string;

  /**
   * idPai onde a raiz da cópia nasce.
   *
   * - `'SAME'` (default) → raiz mantém o `idPai` original (nasce ao lado),
   *   exatamente como o `duplicate()` atual.
   * - `bigint | null` → raiz usa esse idPai (plumbing para Sub-fase 4). A
   *   validação de destino/tenant fica para a Sub-fase 4; aqui só o default
   *   `'SAME'` é exercitado.
   */
  idPaiDestino?: bigint | null | 'SAME';

  /**
   * Ativa a materialização de template (feature Templates — ADR-V2-061).
   *
   * Default `false` = comportamento de `duplicate()` (idEstab cru, sem remap de
   * classe). Quando `true`:
   *  - **Remap de DClasse por nó** (-401→-352 LIST, -402→-350 SPACE) ANTES de
   *    gravar o DProject e ANTES do teste `=== ID_CLASSE_LIST`, para o seed V3
   *    disparar na List materializada.
   *  - O `cloneTree` NÃO exige MANAGER na ORIGEM (usar um template ≠ gerenciá-lo;
   *    o controle de acesso é validado no DESTINO pelo `createFromTemplate`).
   *
   * O `cloneTree` não relaxa o gate tenant sozinho — o caller (`createFromTemplate`)
   * já validou acesso ao template e ao destino antes de invocar o motor.
   */
  fromTemplate?: boolean;

  /**
   * Carimba `idEstab` de TODOS os nós do clone com a org de destino, em vez de
   * herdar `node.idEstab` cru (feature Templates — ADR-V2-061).
   *
   * Default ausente = comportamento de `duplicate()` (copia `node.idEstab`).
   * Essencial para template global (`idEstab` NULL) não nascer órfão de org, e
   * correto já no caminho org-scoped (Sub-fase 4a).
   */
  idEstabDestino?: bigint;

  /**
   * Ativa o remap INVERSO de DClasse (real→template — extensão da feature
   * Templates, ADR-V2-062): -352→-401 LIST, -350→-402 SPACE. Mutuamente
   * exclusivo com `fromTemplate` (promoção é o caminho oposto de uso de
   * template).
   *
   * Aplicado por nó (raiz e descendentes) — mesmo padrão simétrico de
   * `fromTemplate`. Se a origem for um SPACE com Folders/Lists filhas, os
   * Folders (-351) NÃO são remapeados (fora do mapa) mas Lists (-352) filhas
   * SÃO remapeadas para -401 também, reproduzindo a mesma árvore "toda
   * template" que `fromTemplate` já produz no sentido contrário.
   *
   * Default `false` = comportamento de `duplicate()`/`createFromTemplate()`
   * (sem remap real→template).
   */
  toTemplate?: boolean;

  /**
   * Valor gravado em `dados.categoria` da raiz materializada quando
   * `toTemplate === true` (extensão da feature Templates — ADR-V2-062).
   * Usado por `GET /projects?idClasse=-401&categoria=X` para popular a
   * galeria de templates. Sem efeito quando `toTemplate` é falso/ausente.
   */
  categoriaTemplate?: string;
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
 * 3. SeedBootstrapService.seedProject() → 9 statuses V3
 * 4. DVincula -182 (PROJECT_TEAM_LINK) se `teamId` informado (ADR-V2-029)
 *
 * Audit DEvento -499 emitido APÓS commit. Eventos
 * `project.team.linked` / `project.team.unlinked` para mudanças de vínculo
 * de team (ADR-V2-029).
 *
 * @see PrismaService — acesso ao banco
 * @see SeedBootstrapService — seed de statuses V3
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
    private readonly projectRef: ProjectRefService,
    private readonly identifierService: TasksIdentifierService,
    // F0 — Observabilidade. `@Optional()`: instrumentacao nunca quebra o service.
    @Optional() private readonly metrics?: MetricsService,
    // F1 (item 1.6) — mudanças no PROJETO (visibilidade, exclusão) alteram o
    // role herdado (Camada A de espaço público, ADR-V2-051) de TODOS os
    // usuários: o cache do projeto precisa cair junto.
    @Optional() private readonly roleResolver?: RoleResolverService,
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
   * 3. seedProject(): 9 statuses V3 (apenas para LIST -352)
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
   * // Criar um LIST (com seed de statuses V3)
   * const list = await service.create(
   *   { nome: 'Backlog', idClasse: '-352', idPai: '100' },
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
   * @see SeedBootstrapService — responsavel pelo seed de statuses V3
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

      // 2. DEntidade-espelho -158 PROJECT_REF (handle canônico em DVincula).
      //    ADR-V2-058: DVincula.idLocEscritu/idEntidade são FKs para
      //    DEntidade.chave — gravar DProject.chave ali quebrava a FK (500) ou
      //    colidia silenciosamente. O espelho é criado ANTES de qualquer
      //    vínculo project-scoped, na MESMA transação. `E` é a chave da espelho.
      const refId = await this.projectRef.ensureEntidadeRef(tx, proj);

      // 3. DVincula -171 (MANAGER): criador é MANAGER — aponta para E, não P.
      await this.projectMembers.createManagerLink(tx, refId, userEntidadeId);

      // 4. Seed: 9 statuses V3 — apenas para LIST (ADR-V2-051 §12).
      //    SPACE (-350) e FOLDER (-351) são contêineres estruturais e não precisam
      //    de seed de statuses. Apenas LIST (-352) contém tasks.
      //    ADR-V2-058/059: DTabela.dEntidadeId é FK para DEntidade.chave — gravar
      //    `refId` (E, a DEntidade-espelho criada na etapa 2), NÃO `proj.chave` (P),
      //    senão a FK DTabela_dEntidadeId_fkey é violada (500 em POST /projects).
      //    A leitura desses lookups (tasks.service) resolve P→E via ProjectRefService,
      //    mantendo escrita e leitura no mesmo espaço.
      if (proj.idClasse === ID_CLASSE_LIST) {
        await this.seedBootstrap.seedProject(tx, refId);
      }

      // 5. (opcional) Vincular ao time (ADR-V2-029).
      //    idLocEscritu = teamId (DEntidade -180, já canônico).
      //    idEntidade = E (espelho do projeto), não P — ADR-V2-058.
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
            idEntidade: refId,
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

    // O criador recebe DVincula -171 (MANAGER) na transação acima.
    return this.buildResponse(
      project,
      1,
      dto.teamId ?? null,
      null,
      undefined,
      undefined,
      'MANAGER',
    );
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
    const { cursor, teamId, organizationId, idClasse, idPai, privado, categoria } = opts;
    const take = Math.min(opts.limit ?? 20, 100);

    // ADR-V2-042: organizationId vira filtro de tenant via DProject.idEstab.
    //
    // F4 (item 4.2): claim malformado NÃO é mais lista vazia silenciosa — é
    // 401 ORG_CONTEXT_STALE (o token não serve para escopar nada; o frontend
    // renova e retenta). `throwOrgContextStale` emite o contador da F0.
    let orgIdBig: bigint | undefined;
    if (organizationId !== undefined) {
      if (!/^-?\d+$/.test(organizationId)) {
        this.logger.warn(`findMany: organizationId invalido="${organizationId}" — 401 stale`);
        this.throwOrgContextStale(
          userEntidadeId,
          organizationId,
          'invalid_org_claim',
          'projects.findMany',
        );
      }
      orgIdBig = BigInt(organizationId);
    }

    // CATÁLOGO de templates (ADR-V2-061, Sub-fase 5): quando o filtro `idClasse`
    // é um template (-401/-402) a visibilidade é DIFERENTE da normal — um
    // template é listável se for da org ativa (org-scoped) OU GLOBAL (idEstab
    // NULL, criado por seed/plataforma e visível a todas as orgs). Templates
    // globais NÃO têm DVincula, então a união Camada A/B não os enxergaria —
    // caminho dedicado que bypassa membership/público. Qualquer membro da org
    // pode VER o catálogo (não exige MANAGER — usar ≠ gerenciar).
    if (isTemplateClasseFilter(idClasse)) {
      return this.listTemplates(BigInt(idClasse as string), orgIdBig, {
        cursor,
        take,
        categoria,
      });
    }

    // 1) Se filtrado por team, pré-resolver os projetos do time.
    //    ADR-V2-058: o -182 grava idEntidade = chave da espelho (-158), não
    //    DProject.chave. `teamRefIds` (E) é usado em filtros DVincula;
    //    `teamProjectIds` (P) é usado em filtros DProject (.chave) — derivado
    //    via reverse E→P.
    let teamRefIds: bigint[] | undefined;
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
      teamRefIds = teamLinks.map((v) => v.idEntidade).filter((v): v is bigint => v !== null);

      if (teamRefIds.length === 0) {
        return { items: [], pagination: { hasMore: false, nextCursor: null } };
      }
      const teamProjectIdStrs = await this.projectRef.refsToProjectIds(teamRefIds);
      teamProjectIds = teamProjectIdStrs.map((s) => BigInt(s));
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
    //    idLocEscritu desses vínculos é a chave da espelho (E) — filtramos por
    //    teamRefIds (E) e revertemos E→P para montar o set de projectIds.
    const vinculosExplicitos = await this.prisma.dVincula.findMany({
      where: {
        idEntidade: userEntidadeId,
        idClasse: { in: PROJECT_ROLE_CLASSES },
        excluido: false,
        ...(teamRefIds ? { idLocEscritu: { in: teamRefIds } } : {}),
      },
      select: { idLocEscritu: true, idClasse: true },
    });
    const explicitProjectIds = await this.projectRef.refsToProjectIds(
      vinculosExplicitos.map((v) => v.idLocEscritu),
    );
    const explicitSet = new Set(explicitProjectIds);

    // Papel explícito por projectId (P), para preencher `myRole` no response sem
    // N+1. `refsToProjectIds` preserva a ordem dos refs (E), então pareamos por
    // índice o idClasse de cada vínculo com o projectId resolvido.
    const explicitRoleByProjectId = new Map<string, ProjectResponseDto['myRole']>();
    vinculosExplicitos.forEach((v, i) => {
      const pid = explicitProjectIds[i];
      if (pid !== undefined) {
        explicitRoleByProjectId.set(pid, this.classeToProjectRole(v.idClasse));
      }
    });

    // ADR-V2 herança: ADMIN da org dona é MANAGER em qualquer projeto dela.
    // Conjunto de orgs onde o usuário é ADMIN — usado por-projeto na montagem do
    // `myRole` (um projeto herda MANAGER se sua `idEstab` está aqui). No caminho
    // HTTP (org-present) há no máximo 1 org; no MCP (no-org) pode haver várias.
    const adminOrgIdsSet = new Set<string>();

    // Camada A: espaços públicos.
    let publicProjectIds: bigint[] = [];
    if (orgIdBig !== undefined) {
      // HTTP (ADR-V2-042): org ativa vem do token. Comportamento inalterado.
      // Verifica se o usuário é membro da org (tem qualquer DVincula -161/-162/-163).
      const orgVinculo = await this.prisma.dVincula.findFirst({
        where: {
          idEntidade: userEntidadeId,
          idLocEscritu: orgIdBig,
          idClasse: { in: ORG_ROLE_CLASSES },
          excluido: false,
        },
        select: { idClasse: true },
      });

      if (orgVinculo?.idClasse === ID_CLASSE_ORG_ADMIN) {
        adminOrgIdsSet.add(orgIdBig.toString());
      }

      if (orgVinculo) {
        const publicProjects = await this.prisma.dProject.findMany({
          where: {
            idEstab: orgIdBig,
            privado: false,
            excluido: false,
            ...(teamProjectIds ? { chave: { in: teamProjectIds } } : {}),
            // ADR-V2-061 (blindagem): templates -401/-402 nunca entram nas
            // visões normais. Quando `idClasse` é específico, o filtro abaixo já
            // exclui templates; quando ausente, excluímos explicitamente.
            ...(idClasse !== undefined
              ? { idClasse: BigInt(idClasse) }
              : { idClasse: { notIn: TEMPLATE_CLASSES } }),
            ...(idPai !== undefined ? { idPai: BigInt(idPai) } : {}),
          },
          select: { chave: true },
        });
        publicProjectIds = publicProjects.map((p) => p.chave);
      }
    } else {
      // MCP / cross-org (ADR-V2-069): sem org ativa de token. Deriva as orgs das
      // memberships do usuário e liga a Camada A pública de TODAS elas — paridade
      // plena com o HTTP (qualquer membro vê espaços públicos; ADMIN herda
      // MANAGER). Leak-free: só projetos `privado=false` de orgs às quais o
      // usuário pertence — privados de terceiros e orgs alheias nunca entram.
      const orgIds = await this.resolveOrgIdsForUser(userEntidadeId);
      if (orgIds.length > 0) {
        const adminOrgIds = await this.resolveOrgIdsForUser(userEntidadeId, { adminOnly: true });
        adminOrgIds.forEach((oid) => adminOrgIdsSet.add(oid.toString()));

        const publicProjects = await this.prisma.dProject.findMany({
          where: {
            idEstab: { in: orgIds },
            privado: false,
            excluido: false,
            ...(teamProjectIds ? { chave: { in: teamProjectIds } } : {}),
            ...(idClasse !== undefined
              ? { idClasse: BigInt(idClasse) }
              : { idClasse: { notIn: TEMPLATE_CLASSES } }),
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
      // "Os projetos sumiram, mas não deslogou". Lista vazia aqui pode ser
      // (a) usuário legitimamente sem projetos ou (b) `organizationId` STALE no
      // JWT (org da qual ele não é mais membro). São indistinguíveis PELA LISTA
      // — a membership de org é que separa os dois (ver assertOrgContextFresh).
      //
      // F4 (item 4.2): (b) vira 401 ORG_CONTEXT_STALE. (a) — inclusive o
      // usuário NOVO de uma org NOVA, sem nenhum projeto — continua **200 com
      // lista vazia**. A query só roda neste caminho (lista já vazia), então o
      // fluxo normal não paga por ela.
      const ctx = await this.assertOrgContextFresh(
        userEntidadeId,
        orgIdBig?.toString(),
        'projects.findMany',
      );
      if (ctx === 'fresh') {
        this.metrics?.increment(
          'auth.org_context_empty_scope',
          { source: 'projects.findMany' },
          { silent: true },
        );
      }
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

    // ADR-V2-058: para os vínculos project-scoped (-171/-172/-173, -182) o
    // handle é a chave da espelho (E). Resolve E para a página atual e prepara
    // a inversão E→P (ref→project) usada na montagem dos maps.
    const pageRefMap = await this.projectRef.resolveEntidadeRefs(projectIds);
    const pageRefIds = Array.from(pageRefMap.values());
    const pageRefToProject = new Map<string, string>();
    for (const [pidStr, refId] of pageRefMap) {
      pageRefToProject.set(refId.toString(), pidStr);
    }

    // 3) Batch: DProjects + contagem de membros + vínculos de team + folder (N+1 ZERO).
    //    ADR-V2-042: aplicar filtro de org em DProject.findMany. Projetos
    //    listados em memberships mas pertencentes a outra org NAO entram
    //    no resultado.
    //    ADR-V2-FOLDERS-001: folderId resolvido via DVincula -183 em batch.
    const [projects, memberCounts, teamLinks, folderMap, totalCounts, doneStatusRows] =
      await Promise.all([
        this.prisma.dProject.findMany({
          where: {
            chave: { in: projectIds },
            excluido: false,
            ...(orgIdBig !== undefined ? { idEstab: orgIdBig } : {}),
            // ADR-V2-051: filtro hierárquico por tipo (SPACE/FOLDER/LIST/DOC)
            // ADR-V2-061 (blindagem): quando `idClasse` é específico, o filtro
            // já exclui templates -401/-402; quando ausente, excluímos
            // explicitamente (o caminho de catálogo retornou antes deste ponto).
            ...(idClasse !== undefined
              ? { idClasse: BigInt(idClasse) }
              : { idClasse: { notIn: TEMPLATE_CLASSES } }),
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
            idLocEscritu: { in: pageRefIds },
            idClasse: { in: PROJECT_ROLE_CLASSES },
            excluido: false,
          },
          _count: { chave: true },
        }),
        this.prisma.dVincula.findMany({
          where: {
            idEntidade: { in: pageRefIds },
            idClasse: ID_CLASSE_PROJECT_TEAM_LINK,
            excluido: false,
          },
          select: { idEntidade: true, idLocEscritu: true },
        }),
        this.resolveFolderIdsForProjects(projectIds),
        // Progresso: total de tarefas por projeto (N+1 ZERO — 1 groupBy em batch).
        // Conta apenas TASK raiz (idClasse -154, sem pai) — espelha o card que o
        // board/lista exibe: exclui FASES/blocos (-200) e subtarefas (idPai != null).
        this.prisma.dTask.groupBy({
          by: ['idProject'],
          where: {
            idProject: { in: projectIds },
            idClasse: BigInt(-154),
            idPai: null,
            excluido: false,
          },
          _count: { chave: true },
        }),
        // Progresso: DTask.idStatus aponta para DTabela (status por projeto).
        // Buscamos as chaves das DTabelas DONE(-444) destes
        // projetos para depois contar as tasks concluídas por elas.
        this.prisma.dTabela.findMany({
          where: {
            dEntidadeId: { in: projectIds },
            idClasse: { in: [BigInt(-444)] },
            excluido: false,
          },
          select: { chave: true },
        }),
      ]);

    // Progresso: contagem de tarefas concluídas por projeto (DONE).
    // Depende das chaves resolvidas acima — 1 groupBy adicional, ainda em batch.
    const doneStatusChaves = doneStatusRows.map((r) => r.chave);
    const doneCounts = doneStatusChaves.length
      ? await this.prisma.dTask.groupBy({
          by: ['idProject'],
          where: {
            idProject: { in: projectIds },
            idClasse: BigInt(-154),
            idPai: null,
            idStatus: { in: doneStatusChaves },
            excluido: false,
          },
          _count: { chave: true },
        })
      : [];

    const totalTaskMap = new Map<string, number>();
    for (const tc of totalCounts) {
      if (tc.idProject != null) {
        totalTaskMap.set(tc.idProject.toString(), tc._count.chave);
      }
    }
    const doneTaskMap = new Map<string, number>();
    for (const dc of doneCounts) {
      if (dc.idProject != null) {
        doneTaskMap.set(dc.idProject.toString(), dc._count.chave);
      }
    }

    // countMap e teamMap são chaveados por projectId (P) — invertendo E→P.
    const countMap = new Map<string, number>();
    for (const mc of memberCounts) {
      const pidStr = pageRefToProject.get(mc.idLocEscritu.toString());
      if (pidStr) {
        countMap.set(pidStr, mc._count.chave);
      }
    }
    const teamMap = new Map<string, string>();
    for (const t of teamLinks) {
      if (t.idEntidade === null) continue;
      const pidStr = pageRefToProject.get((t.idEntidade as bigint).toString());
      if (pidStr) {
        teamMap.set(pidStr, t.idLocEscritu.toString());
      }
    }

    const items: ProjectResponseDto[] = projects.map((p) => {
      const pidStr = p.chave.toString();
      // Papel do usuário: herança ORG_ADMIN→MANAGER tem precedência (admin da
      // org dona — `p.idEstab` ∈ orgs-admin do usuário); senão o papel explícito
      // do vínculo; senão MEMBER (chegou aqui só via Camada A, espaço público —
      // edita tasks mas não faz ops estruturais). A checagem por-projeto suporta
      // o caminho MCP cross-org (vários `idEstab` na mesma página); no HTTP toda
      // a página tem `idEstab=orgIdBig`, então é equivalente ao antigo booleano.
      const inheritsManager = p.idEstab !== null && adminOrgIdsSet.has(p.idEstab.toString());
      const myRole: ProjectResponseDto['myRole'] = inheritsManager
        ? 'MANAGER'
        : (explicitRoleByProjectId.get(pidStr) ?? 'MEMBER');
      return this.buildResponse(
        p,
        countMap.get(pidStr) ?? 0,
        teamMap.get(pidStr) ?? null,
        folderMap.get(pidStr) ?? null,
        doneTaskMap.get(pidStr) ?? 0,
        totalTaskMap.get(pidStr) ?? 0,
        myRole,
      );
    });

    const nextCursor = hasMore ? projectIds[projectIds.length - 1].toString() : null;

    return { items, pagination: { hasMore, nextCursor } };
  }

  /**
   * Decide se o `organizationId` do JWT ainda corresponde à realidade — e
   * **lança 401 `ORG_CONTEXT_STALE`** quando não corresponde (F4, item 4.2).
   *
   * ## O problema que isto resolve
   *
   * Até a F3, um JWT com `organizationId` de uma org da qual o usuário **não é
   * mais membro** produzia **200 com lista vazia**, silenciosamente. Do ponto de
   * vista do usuário: "sumiram todos os meus projetos" — e nada no sistema
   * acusava. Agora esse caso vira 401 + `code: ORG_CONTEXT_STALE`, e o
   * frontend faz refresh silencioso (reemite o token com a org correta, ou
   * órfão conforme ADR-V2-038) e **repete** o request. Zero logout.
   *
   * ## Como se distingue "org stale" de "usuário novo sem projetos"
   *
   * A distinção **não** é feita pela lista vazia (os dois casos produzem lista
   * vazia — por isso o bug durou tanto). É feita pela **membership de org**:
   *
   * | Situação                                     | `organizationId` | DVincula -161/-162/-163 | Resultado |
   * |----------------------------------------------|------------------|--------------------------|-----------|
   * | Usuário órfão (ADR-V2-038)                   | ausente          | —                        | `'orphan'` — 200 `[]` |
   * | **Usuário novo, org válida, zero projetos**  | presente         | **EXISTE**               | `'fresh'` — **200 `[]`** |
   * | Removido da org / org apagada / claim podre  | presente         | **NÃO existe**           | **401 ORG_CONTEXT_STALE** |
   *
   * O que torna essa inferência **segura** é a origem do claim: o
   * `organizationId` só é emitido no token a partir de uma DVincula de org
   * **existente** (`AuthService.login`/`refresh` resolvem a org via
   * `DVincula in [-161,-162,-163]`). Logo, "claim presente + membership
   * ausente" só pode significar que a membership foi revogada **depois** da
   * emissão do token — ou seja, o token está desatualizado. Não há caminho
   * legítimo em que um usuário ativo de uma org válida fique sem essa DVincula.
   *
   * ## Fail-open deliberado
   *
   * Se a query de membership falhar (banco lento, pool esgotado), **não**
   * lançamos: um blip de infra jamais pode virar 401 (é exatamente a lição da
   * F1/D4 — infra não é `invalid_token`). Nesse caso devolvemos `'fresh'` e o
   * comportamento anterior (200 `[]`) é preservado.
   *
   * @param userEntidadeId - DEntidade (-150) do usuário
   * @param organizationId - claim `organizationId` do JWT (string BigInt) ou `undefined`
   * @param source - rótulo do call-site (telemetria)
   * @returns `'orphan'` (sem claim) ou `'fresh'` (claim confere)
   *
   * @throws {UnauthorizedException} `{ code: 'ORG_CONTEXT_STALE' }` — claim
   *   malformado ou apontando para org sem membership real.
   *
   * @see AUTH_ERROR_CODES.ORG_CONTEXT_STALE — ação esperada do cliente
   */
  async assertOrgContextFresh(
    userEntidadeId: bigint,
    organizationId: string | undefined,
    source: string,
  ): Promise<'orphan' | 'fresh'> {
    if (organizationId === undefined || organizationId === '') {
      // Órfão é estado VÁLIDO (ADR-V2-038) — quem responde é o
      // RequireWorkspaceGuard (403 NO_WORKSPACE), não este método.
      return 'orphan';
    }

    if (!/^-?\d+$/.test(organizationId)) {
      this.throwOrgContextStale(userEntidadeId, organizationId, 'invalid_org_claim', source);
    }

    let membership: { chave: bigint } | null;
    try {
      membership = await this.prisma.dVincula.findFirst({
        where: {
          idEntidade: userEntidadeId,
          idLocEscritu: BigInt(organizationId),
          idClasse: { in: ORG_ROLE_CLASSES },
          excluido: false,
        },
        select: { chave: true },
      });
    } catch (err) {
      // Fail-open: infraestrutura instável NUNCA vira 401 (RFC 6750).
      this.logger.warn(
        `assertOrgContextFresh: falha ao verificar membership (fail-open) — ${(err as Error).message}`,
      );
      return 'fresh';
    }

    if (!membership) {
      this.throwOrgContextStale(userEntidadeId, organizationId, 'membership_missing', source);
    }

    return 'fresh';
  }

  /**
   * Emite o contador `auth.org_context_stale` (instrumentado na F0) e lança o
   * 401 com o `code` do contrato.
   *
   * @throws {UnauthorizedException} sempre
   */
  private throwOrgContextStale(
    userEntidadeId: bigint,
    organizationId: string,
    reason: 'invalid_org_claim' | 'membership_missing',
    source: string,
  ): never {
    this.metrics?.increment(
      'auth.org_context_stale',
      {
        reason,
        userEntidadeId: userEntidadeId.toString(),
        organizationId,
        source,
      },
      { level: 'warn' },
    );

    throw new UnauthorizedException({
      code: AUTH_ERROR_CODES.ORG_CONTEXT_STALE,
      message: 'Contexto de organização desatualizado. Renove a sessão e tente novamente.',
    });
  }

  /**
   * Lista o catálogo de templates (-401 TEMPLATE_LIST / -402 TEMPLATE_SPACE).
   *
   * Visibilidade DEDICADA, diferente da listagem normal (ADR-V2-061, Sub-fase 5):
   * um template é listável se for da org ativa (`idEstab = orgAtiva`, org-scoped)
   * **OU** GLOBAL (`idEstab IS NULL`, criado por seed/plataforma e visível a
   * todas as orgs). Templates globais NÃO têm DVincula, então a união
   * membership/público de `findMany` não os enxergaria — por isso o caminho é
   * direto (bypassa Camada A/B). Qualquer membro autenticado com org ativa pode
   * VER o catálogo (não exige MANAGER — usar um template ≠ gerenciá-lo).
   *
   * Resposta FLAT (Pilar 2): cada item já expõe `dados.categoria` em
   * `ProjectResponseDto.categoria` — o agrupamento por categoria é feito no
   * cliente. Uma única query (N+1 ZERO) ordenada de forma estável por
   * `idClasse, chave desc` com cursor.
   *
   * @param templateClasse - -401 ou -402 (validado pelo caller via `isTemplateClasseFilter`)
   * @param orgIdBig - org ativa (BigInt). Ausente = sem org → retorna apenas globais
   * @param opts - cursor/take/categoria
   * @returns Lista paginada de templates (flat, com `categoria`)
   *
   * @see findMany — encaminha o caminho de catálogo para cá
   * @see ADR-V2-061 — alcance dois níveis (global idEstab NULL + por-org)
   */
  private async listTemplates(
    templateClasse: bigint,
    orgIdBig: bigint | undefined,
    opts: { cursor?: string; take: number; categoria?: string },
  ): Promise<ListProjectResponseDto> {
    const { cursor, take, categoria } = opts;

    // Acesso: template da org ativa OU global (idEstab NULL). Sem org ativa,
    // só globais são visíveis (caller MCP/cross-org — raro para catálogo).
    const orgScope =
      orgIdBig !== undefined ? [{ idEstab: orgIdBig }, { idEstab: null }] : [{ idEstab: null }];

    const projects = await this.prisma.dProject.findMany({
      where: {
        idClasse: templateClasse,
        excluido: false,
        OR: orgScope,
        // Filtro opcional por categoria via JSON-path dados->>'categoria'.
        // Normalizado para minúsculo (dados.categoria é sempre gravado em
        // minúsculo — ver promoteToTemplate) para tolerar variação de caixa
        // vinda do cliente sem depender de `mode: 'insensitive'` (não
        // suportado pelo Prisma em filtros de JSON path).
        ...(categoria !== undefined
          ? { dados: { path: ['categoria'], equals: categoria.toLowerCase() } }
          : {}),
        // Cursor: chave estritamente menor (ordenação desc por chave).
        ...(cursor ? { chave: { lt: BigInt(cursor) } } : {}),
      },
      // Ordenação estável: por chave desc (cursor-friendly). O agrupamento por
      // categoria é responsabilidade do cliente (resposta flat).
      orderBy: { chave: 'desc' },
      take: take + 1,
      select: PROJECT_RESPONSE_SELECT,
    });

    const hasMore = projects.length > take;
    const page = hasMore ? projects.slice(0, take) : projects;

    // Templates não têm membros/team/folder/progresso relevantes para o catálogo.
    // Não emitimos myRole (catálogo é read-only; materialização exige RBAC no
    // destino, validada em createFromTemplate).
    const items = page.map((p) => this.buildResponse(p, 0, null, null, undefined, undefined, null));

    const nextCursor = hasMore ? page[page.length - 1].chave.toString() : null;
    return { items, pagination: { hasMore, nextCursor } };
  }

  /**
   * Lista todos os IDs de projetos acessiveis ao usuario, opcionalmente
   * filtrados por organizacao (ADR-V2-042).
   *
   * Uso interno para callers que precisam aplicar escopo de projeto antes de
   * consultar outro agregado canonico, como tools MCP de tasks.
   *
   * Quando `organizationId` informado, retorna a UNIÃO de:
   *  - projetos com DVincula explícita do usuário (`idEstab === organizationId`); e
   *  - todos os projetos dentro de SPACEs públicos da org (Camada A, ADR-V2-051
   *    §8) — se o usuário for membro da org. Isso garante que as tasks de listas
   *    em espaços públicos sejam visíveis sem DVincula de projeto (simetria com
   *    `findOne`). Quando omitido, retorna todos os projetos onde o usuario e
   *    membro (modo MCP / cross-org by design — sem Camada A).
   *
   * @param userEntidadeId - Chave BigInt da DEntidade do usuario
   * @param organizationId - `DEntidade.chave` da org ativa (string com BigInt). Opcional.
   * @returns IDs de projetos acessiveis, serializados como string
   *
   * @see listPublicSpaceProjectIds — projetos de SPACEs públicos da org
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

    // ADR-V2-058: idLocEscritu desses vínculos é a chave da espelho (-158).
    // Reverter E→P para obter os DProject.chave reais.
    const candidateIds = await this.projectRef.refsToProjectIds(
      vinculos.map((v) => v.idLocEscritu),
    );

    // Sem org (caminho MCP / cross-org by design): não há "org ativa" de token.
    // ADR-V2-069 — em vez de exigir DVincula explícita (que deixava ADMIN/membro
    // de org sem ver espaços públicos via MCP), liga a Camada A derivando as orgs
    // das MEMBERSHIPS do usuário. União: Camada B (membership direto, já em
    // `candidateIds`) ∪ Camada A (projetos de SPACEs públicos de TODAS as orgs do
    // usuário). Leak-free: só públicos (privado=false) e só de orgs às quais o
    // usuário pertence — privados de terceiros e orgs alheias nunca entram.
    if (!organizationId) {
      const accessible = new Set<string>(candidateIds);
      const orgIds = await this.resolveOrgIdsForUser(userEntidadeId);
      if (orgIds.length > 0) {
        const publicIds = await listPublicSpaceProjectIdsForOrgs(this.prisma, orgIds);
        publicIds.forEach((id) => accessible.add(id.toString()));
      }
      return Array.from(accessible);
    }

    if (!/^-?\d+$/.test(organizationId)) {
      this.logger.warn(
        `findAccessibleProjectIds: organizationId invalido="${organizationId}" — retorna vazio`,
      );
      return [];
    }

    const orgIdBig = BigInt(organizationId);

    // Camada B: DVincula explícita cruzada com DProject.idEstab (ZERO N+1).
    const accessible = new Set<string>();
    if (candidateIds.length > 0) {
      const scoped = await this.prisma.dProject.findMany({
        where: {
          chave: { in: candidateIds.map((s) => BigInt(s)) },
          idEstab: orgIdBig,
          excluido: false,
        },
        select: { chave: true },
      });
      scoped.forEach((p) => accessible.add(p.chave.toString()));
    }

    // Camada A: projetos dentro de SPACEs públicos da org — apenas se o usuário
    // for membro da org (qualquer role -161/-162/-163).
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
      const publicIds = await listPublicSpaceProjectIds(this.prisma, orgIdBig);
      publicIds.forEach((id) => accessible.add(id.toString()));
    }

    return Array.from(accessible);
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

    // ADR-V2-058: o handle do projeto em DVincula é a chave da DEntidade-espelho
    // (-158), não DProject.chave. Resolve E (lazy-create idempotente p/ legados).
    const refId = await this.projectRef.resolveEntidadeRef(projectId);

    const [project, vinculo, teamLink, folderLink] = await Promise.all([
      this.prisma.dProject.findFirst({
        where: { chave: projectId, excluido: false },
        select: PROJECT_RESPONSE_SELECT,
      }),
      this.prisma.dVincula.findFirst({
        where: {
          idLocEscritu: refId,
          idEntidade: userEntidadeId,
          idClasse: { in: PROJECT_ROLE_CLASSES },
          excluido: false,
        },
        select: { chave: true, idClasse: true },
      }),
      this.prisma.dVincula.findFirst({
        where: {
          idEntidade: refId,
          idClasse: ID_CLASSE_PROJECT_TEAM_LINK,
          excluido: false,
        },
        select: { idLocEscritu: true },
      }),
      this.prisma.dVincula.findFirst({
        where: {
          idEntidade: refId,
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
    // Papel do usuário neste projeto (para o front habilitar/desabilitar ações
    // estruturais sem precisar tentar e tomar 403). Reusa o vínculo já buscado.
    let myRole = this.classeToProjectRole(vinculo?.idClasse ?? null);

    if (!vinculo) {
      // ADR-V2-051 §8 — Camada A (espaços públicos): membros da org têm
      // acesso a qualquer projeto cujo SPACE raiz seja público (privado=false),
      // SEM precisar de DVincula de projeto. Simetria com list() — sem isso,
      // listas/pastas filhas de um espaço público davam 403 ao abrir (bug de
      // acesso negado indevidamente).
      const publicAccess = await this.hasPublicSpaceAccess(project, userEntidadeId, organizationId);
      if (!publicAccess) {
        throw new ForbiddenException('Acesso negado: você não é membro deste projeto');
      }
      // Sem DVincula explícita mas com acesso herdado: ORG_ADMIN vira MANAGER
      // (decisão CEO 2026-06-02); demais membros da org de espaço público são
      // MEMBER (editam tasks, não ops estruturais).
      myRole = (await this.isOrgAdminForProject(project, userEntidadeId, organizationId))
        ? 'MANAGER'
        : 'MEMBER';
    } else if (myRole !== 'MANAGER') {
      // Tem vínculo MEMBER/VIEWER, mas se também é ADMIN da org dona herda MANAGER.
      if (await this.isOrgAdminForProject(project, userEntidadeId, organizationId)) {
        myRole = 'MANAGER';
      }
    }

    const memberCount = await this.prisma.dVincula.count({
      where: {
        idLocEscritu: refId,
        idClasse: { in: PROJECT_ROLE_CLASSES },
        excluido: false,
      },
    });

    return this.buildResponse(
      project,
      memberCount,
      teamLink?.idLocEscritu.toString() ?? null,
      folderLink?.idLocEscritu.toString() ?? null,
      undefined,
      undefined,
      myRole,
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
   *   { nome: 'Backlog Q2', prefix: 'BQ2', idPai: '100', teamId: '200' },
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

    await this.requireManagerRole(projectId, userEntidadeId, organizationId);

    const project = await this.prisma.dProject.findFirst({
      where: { chave: projectId, excluido: false },
    });

    if (!project) {
      throw new NotFoundException(`Projeto ${id} não encontrado`);
    }

    // ADR-V2-058: handle do projeto em DVincula = chave da espelho (-158).
    // Usado nos vínculos -182 (team) e na contagem de membros -171/-172/-173.
    // `ensureEntidadeRefById` (write-safe): garante DEntidade real mesmo para
    // projeto legado (evita reintroduzir a violação de FK ao gravar o -182).
    const refId = await this.projectRef.ensureEntidadeRefById(projectId);

    // Pré-condição: validar anti-ciclo antes de qualquer UPDATE de idPai (ADR-V2-051 §12).
    // NOTA: NÃO usar `'idPai' in dto` — com transform:true o class-transformer
    // instancia o DTO com todas as props declaradas em undefined, tornando `in`
    // sempre true e apagando o idPai existente. Usar !== undefined é correto.
    const idPaiProvided = dto.idPai !== undefined;
    if (idPaiProvided) {
      const novoPaiId = dto.idPai !== null && dto.idPai !== undefined ? BigInt(dto.idPai) : null;
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
          idEntidade: refId,
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
    let tableFieldsToPersist: UpdateProjectDto['tableFields'];
    if (dto.tableFields !== undefined) {
      validateTableFields(dto.tableFields);
      tableFieldsToPersist =
        project.idClasse === ID_CLASSE_LIST
          ? mergeBuiltinColumns(dto.tableFields)
          : dto.tableFields;
      validateTableFields(tableFieldsToPersist);
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      // Resolver valor efetivo de idPai: undefined = não toca, null = remove pai,
      // BigInt = novo pai. A validação anti-ciclo já ocorreu antes da transaction.
      let effectiveIdPai: bigint | null | undefined;
      if (idPaiProvided) {
        effectiveIdPai = dto.idPai !== null && dto.idPai !== undefined ? BigInt(dto.idPai) : null;
      }

      const u = await tx.dProject.update({
        where: { chave: projectId },
        data: {
          ...(dto.nome !== undefined ? { nome: dto.nome } : {}),
          ...(dto.description !== undefined ? { descricao: dto.description } : {}),
          ...(effectiveRepoUrl !== undefined ? { repoUrl: effectiveRepoUrl } : {}),
          ...(effectiveIdPai !== undefined ? { idPai: effectiveIdPai } : {}),
          ...(dto.privado !== undefined ? { privado: dto.privado } : {}),
          ...(tableFieldsToPersist !== undefined
            ? { tableFields: tableFieldsToPersist as unknown as Prisma.InputJsonValue }
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
              idEntidade: refId,
            },
          });
        }
      }

      return u;
    });

    const memberCount = await this.prisma.dVincula.count({
      where: {
        idLocEscritu: refId,
        idClasse: { in: PROJECT_ROLE_CLASSES },
        excluido: false,
      },
    });

    // F1 (1.6): visibilidade é insumo do role herdado de espaço público
    // (ADR-V2-051 §8). Trocar público↔privado sem invalidar deixaria o acesso
    // antigo valendo por até 5 min — para conceder E para revogar.
    if (dto.privado !== undefined) {
      this.roleResolver?.invalidateProject(projectId);
    }

    // Resolver teamId final para o response (após commit).
    let finalTeamId: string | null;
    if (teamIdProvided) {
      finalTeamId = dto.teamId ?? null;
    } else {
      const current = await this.prisma.dVincula.findFirst({
        where: {
          idEntidade: refId,
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
        idEntidade: refId,
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
      undefined,
      undefined,
      // Quem chega aqui passou por requireManagerRole → é MANAGER por definição.
      'MANAGER',
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

    await this.requireManagerRole(projectId, userEntidadeId, organizationId);

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

      // ADR-V2-058: os vínculos project-scoped (-171/-172/-173 e -182) usam a
      // chave da DEntidade-espelho (-158), não DProject.chave. Resolver os
      // handles E de todos os descendentes para cascatear corretamente.
      const refMap = await this.projectRef.resolveEntidadeRefs(ids);
      const refIds = Array.from(refMap.values());

      // 2. Cascade bottom-up: Tasks filhas de todas as Lists coletadas.
      //    DTask.idProject referencia DProject.chave (P) — permanece em P.
      const tasksResult = await tx.dTask.updateMany({
        where: { idProject: { in: ids }, excluido: false },
        data: { excluido: true },
      });

      // 3. Cascade: DVincula de membros (-171/-172/-173) — idLocEscritu = E.
      const membersResult = await tx.dVincula.updateMany({
        where: {
          idLocEscritu: { in: refIds },
          idClasse: { in: PROJECT_ROLE_CLASSES },
          excluido: false,
        },
        data: { excluido: true },
      });

      // 4. Cascade: DVincula PROJECT_TEAM_LINK (-182) — idEntidade = E.
      await tx.dVincula.updateMany({
        where: {
          idEntidade: { in: refIds },
          idClasse: ID_CLASSE_PROJECT_TEAM_LINK,
          excluido: false,
        },
        data: { excluido: true },
      });

      // 4b. Cascade: DVincula FOLDER_PROJECT_LINK (-183) — idEntidade = E.
      //     Sem isto, ao deletar o projeto o vínculo folder→project fica zumbi.
      await tx.dVincula.updateMany({
        where: {
          idEntidade: { in: refIds },
          idClasse: ID_CLASSE_FOLDER_PROJECT_LINK,
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

    // F1 (1.6): projeto excluído — nenhum role cacheado dele pode sobreviver.
    this.roleResolver?.invalidateProject(projectId);

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
   * Duplica um projeto (Space/Folder/List) como esqueleto: copia a hierarquia
   * inteira abaixo do nó + os BLOCOS/FASES (-200), mas NÃO as tasks de
   * trabalho (-154) (decisão do produto 2026-06-03).
   *
   * Comportamento:
   *  - A cópia nasce no MESMO nível do original (mesmo `idPai`); o nó raiz da
   *    cópia ganha o sufixo " (cópia)" no nome. Descendentes mantêm os nomes.
   *  - Cada nova List recebe o seed de statuses V3 (igual ao `create`) — sem
   *    isso a List copiada não funcionaria.
   *  - O executante vira MANAGER de cada novo DProject (DVincula -171), via a
   *    DEntidade-espelho (-158) — mesmo padrão de `create`.
   *  - Fases (-200) de cada List são copiadas preservando a hierarquia de
   *    sub-fases (remapeando `idPai`). Vínculos de team (-182) NÃO são copiados.
   *
   * Permissão: exige MANAGER (ação estrutural — mesma regra de update/delete).
   *
   * @param id - Chave BigInt do projeto raiz a duplicar (string)
   * @param userEntidadeId - Chave BigInt do MANAGER executante
   * @param organizationId - (Opcional) DEntidade.chave da org ativa (tenant isolation)
   * @returns ProjectResponseDto do novo projeto raiz (com myRole=MANAGER)
   *
   * @throws {NotFoundException} Se projeto não encontrado ou tenant mismatch
   * @throws {ForbiddenException} Se não é MANAGER
   *
   * @see delete — fonte do padrão de CTE recursiva sobre a hierarquia
   * @see create — fonte do padrão espelho + DVincula MANAGER + seed
   * @see cloneTree — motor genérico de deep-clone (esta rota é um caso particular)
   */
  async duplicate(
    id: string,
    userEntidadeId: bigint,
    organizationId?: string,
  ): Promise<ProjectResponseDto> {
    // Casca fina sobre o motor genérico: todos os defaults de `cloneTree`
    // reproduzem EXATAMENTE o comportamento legado de duplicação (raiz nasce
    // ao lado com sufixo " (cópia)", sem tasks de trabalho, idEstab cru, gate
    // tenant-rígido). Zero regressão — ver suíte `duplicate()` em
    // projects.service.spec.ts.
    return this.cloneTree(id, userEntidadeId, organizationId, {});
  }

  /**
   * Motor genérico de deep-clone de uma subárvore DProject (Space/Folder/List)
   * + seus blocos/fases (-200). Extraído de `duplicate()` na Sub-fase 2 da
   * feature Templates como seam para as Sub-fases 3/4 (ver
   * `workspace/plans/plan-templates-feature.md`).
   *
   * Comportamento (com `opts = {}`, idêntico ao `duplicate()` legado):
   *  - Coleta a subárvore via CTE recursiva (pai antes do filho por `depth`).
   *  - A raiz nasce ao lado (mesmo `idPai`) com nome `${node.nome} (cópia)`;
   *    descendentes mantêm nome e apontam para a cópia do seu pai.
   *  - Cada nova List (-352) recebe seed de statuses V3 + cópia dos blocos -200.
   *  - O executante vira MANAGER de cada novo DProject (espelho -158 + DVincula
   *    -171).
   *  - Emite `project.created` (com `duplicatedFrom`) APÓS persistir.
   *
   * Opções (`CloneTreeOptions`): `novoNome`/`novoIcone`/`idPaiDestino`
   * parametrizam a raiz (defaults reproduzem o comportamento legado);
   * `includeTasks=true` copia as tasks de trabalho (-154) via `copyTasks`.
   *
   * Permissão: exige MANAGER (ação estrutural — mesma regra de update/delete).
   *
   * @param id - Chave BigInt do projeto raiz a clonar (string)
   * @param userEntidadeId - Chave BigInt do MANAGER executante
   * @param organizationId - (Opcional) DEntidade.chave da org ativa (tenant isolation)
   * @param opts - Opções do clone (ver {@link CloneTreeOptions})
   * @returns ProjectResponseDto do novo projeto raiz (com myRole=MANAGER)
   *
   * @throws {NotFoundException} Se projeto não encontrado ou tenant mismatch
   * @throws {ForbiddenException} Se não é MANAGER
   *
   * @see duplicate — rota pública que delega a este motor com defaults
   * @see copyPhases — cópia dos blocos -200 (retorna o phaseIdMap p/ Sub-fase 3)
   */
  private async cloneTree(
    id: string,
    userEntidadeId: bigint,
    organizationId: string | undefined,
    opts: CloneTreeOptions,
  ): Promise<ProjectResponseDto> {
    const projectId = BigInt(id);

    // ADR-V2-042: tenant check ANTES de qualquer query/RBAC.
    //
    // No caminho `fromTemplate` (feature Templates) o gate tenant-rígido e o
    // RBAC de ORIGEM são PULADOS: o template não tem MANAGER de origem (usar ≠
    // gerenciar) e o acesso (org-scoped na Sub-fase 4a) já foi validado pelo
    // `createFromTemplate` ANTES de invocar este motor. A autorização que vale
    // é a do DESTINO (também validada lá). Sem esse pulo, o gate barraria a
    // materialização legítima. O caminho `duplicate` (sem fromTemplate) mantém
    // o gate tenant-rígido + RBAC de origem intactos — zero regressão.
    if (!opts.fromTemplate) {
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

      await this.requireManagerRole(projectId, userEntidadeId, organizationId);
    }

    // Coletar a subárvore completa (raiz + descendentes) com os campos a copiar.
    // ORDER BY profundidade garante que o pai é criado antes do filho — assim o
    // remapeamento de idPai sempre encontra o novo id do pai já materializado.
    const nodes = await this.prisma.$queryRaw<
      Array<{
        chave: bigint;
        idClasse: bigint;
        idPai: bigint | null;
        nome: string;
        descricao: string | null;
        idEstab: bigint | null;
        repoUrl: string | null;
        privado: boolean;
        dados: unknown;
        tableFields: unknown;
        depth: number;
      }>
    >`
      WITH RECURSIVE tree AS (
        SELECT p.*, 0 AS depth FROM "DProject" p
        WHERE p."chave" = ${projectId} AND p."excluido" = false

        UNION ALL

        SELECT c.*, t.depth + 1 FROM "DProject" c
        INNER JOIN tree t ON c."idPai" = t."chave"
        WHERE c."excluido" = false
      )
      SELECT "chave", "idClasse", "idPai", "nome", "descricao", "idEstab",
             "repoUrl", "privado", "dados", "tableFields", depth
      FROM tree
      ORDER BY depth ASC, "chave" ASC
    `;

    if (nodes.length === 0) {
      throw new NotFoundException(`Projeto ${id} não encontrado`);
    }

    const rootNode = nodes[0];

    // Default 'SAME' → raiz nasce ao lado (idPai original). Plumbing para a
    // Sub-fase 4: bigint|null faz a raiz nascer sob um destino (não exercitado
    // aqui além do default).
    const idPaiDestino = opts.idPaiDestino ?? 'SAME';

    const created = await this.prisma.$transaction(async (tx) => {
      // Mapa old DProject.chave (P) → new DProject.chave (P).
      const idMap = new Map<string, bigint>();

      for (const node of nodes) {
        const isRoot = node.chave === rootNode.chave;

        // Remap de DClasse template→real (feature Templates — ADR-V2-061).
        // SOMENTE no caminho `fromTemplate`: -401→-352 LIST, -402→-350 SPACE,
        // por nó (raiz e descendentes). Classes não-template (Folders -351,
        // Lists -352 dentro de um Space-template) ficam inalteradas. CRÍTICO:
        // gravar a classe REAL faz o `if (novo.idClasse === ID_CLASSE_LIST)`
        // abaixo disparar `seedProject`/`copyPhases` na List materializada — sem
        // isso a List nasceria sem statuses V3 e o editor não a reconheceria.
        //
        // Remap INVERSO real→template (ADR-V2-062) SOMENTE no caminho
        // `toTemplate`: -352→-401 LIST, -350→-402 SPACE, aplicado por nó (não
        // só a raiz) — ver JSDoc de `CloneTreeOptions.toTemplate`.
        const idClasseMaterializada = opts.fromTemplate
          ? (TEMPLATE_CLASS_REMAP.get(node.idClasse) ?? node.idClasse)
          : opts.toTemplate
            ? (REAL_TO_TEMPLATE_CLASS_REMAP.get(node.idClasse) ?? node.idClasse)
            : node.idClasse;

        // idEstab: carimbo da org de DESTINO em TODOS os nós quando
        // `idEstabDestino` é fornecido (feature Templates); caso contrário,
        // herda `node.idEstab` cru (comportamento legado de `duplicate`). O
        // carimbo evita que um clone de template global (idEstab NULL) nasça
        // órfão de org.
        const idEstabMaterializado = opts.idEstabDestino ?? node.idEstab;

        // idPai novo: raiz mantém o pai original (nasce ao lado, default 'SAME')
        // ou nasce sob `idPaiDestino` quando fornecido; descendentes apontam
        // para a cópia do seu pai (já criada por causa do ORDER BY depth).
        let newIdPai: bigint | null;
        if (isRoot) {
          newIdPai = idPaiDestino === 'SAME' ? node.idPai : idPaiDestino;
        } else {
          newIdPai = node.idPai ? (idMap.get(node.idPai.toString()) ?? null) : null;
        }

        // Nome da raiz: override explícito (`novoNome`) ou o sufixo legado
        // " (cópia)". Descendentes mantêm o nome original.
        const nome = isRoot ? (opts.novoNome ?? `${node.nome} (cópia)`) : node.nome;

        // Slug é UNIQUE case-insensitive (lower(dados->>'slug')). Copiar `dados`
        // cru arrastaria o slug do original → colisão (500). Derivamos um slug
        // novo a partir do nome da cópia, reusando a tx para enxergar os nós já
        // inseridos nesta mesma duplicação. Sobrescreve o slug herdado.
        const dadosOriginais = (node.dados ?? {}) as Record<string, unknown>;
        const slug = await this.deriveUniqueSlug(tx, nome);
        const dadosCopia: Record<string, unknown> = { ...dadosOriginais, slug };

        // Ícone: só a raiz é afetada e somente quando `novoIcone` é fornecido.
        // Sem ele, o ícone herdado (se houver em `dados`) é preservado intacto —
        // comportamento legado.
        if (isRoot && opts.novoIcone !== undefined) {
          dadosCopia.icon = opts.novoIcone;
        }

        // Categoria do catálogo de templates: só a raiz recebe (ADR-V2-062).
        // A própria idClasse -401/-402 já identifica "é template" — não requer
        // flag adicional, mesmo padrão já usado pelo catálogo (ADR-V2-061).
        if (isRoot && opts.toTemplate && opts.categoriaTemplate) {
          // Normalizado para minúsculo — consistente com o filtro de leitura
          // em listTemplates (evita templates "invisíveis" no catálogo por
          // diferença de caixa entre o valor gravado e o filtro do cliente).
          dadosCopia.categoria = opts.categoriaTemplate.toLowerCase();
        }

        const novo = await tx.dProject.create({
          data: {
            idClasse: idClasseMaterializada,
            nome,
            ...(node.descricao ? { descricao: node.descricao } : {}),
            ...(idEstabMaterializado !== null ? { idEstab: idEstabMaterializado } : {}),
            ...(node.repoUrl ? { repoUrl: node.repoUrl } : {}),
            ...(newIdPai !== null ? { idPai: newIdPai } : {}),
            privado: node.privado,
            dados: dadosCopia as Prisma.InputJsonValue,
            ...(node.tableFields !== null
              ? { tableFields: node.tableFields as Prisma.InputJsonValue }
              : {}),
          },
          select: { chave: true, idClasse: true, nome: true, idEstab: true, dados: true },
        });

        idMap.set(node.chave.toString(), novo.chave);

        // Espelho (-158) + DVincula MANAGER (-171) — executante vira dono.
        const refId = await this.projectRef.ensureEntidadeRef(tx, novo);
        await this.projectMembers.createManagerLink(tx, refId, userEntidadeId);

        // Gate "é uma List (para fins de seed V3 + cópia de blocos)":
        //  - Caminhos padrão/`fromTemplate`: testar a classe MATERIALIZADA
        //    (`novo.idClasse`) — já é -352 real nesses casos (comportamento
        //    legado intacto, coberto por `duplicate()`/`createFromTemplate()`).
        //  - Caminho `toTemplate` (ADR-V2-062): a classe materializada da
        //    List promovida é -401 (template), NUNCA -352 — testar a classe
        //    ORIGINAL do nó (`node.idClasse`) para não perder o gate. Sem
        //    isso, `copyPhases`/`seedProject` nunca rodam ao promover uma
        //    List (ou uma List filha de um Space) a template, e o molde nasce
        //    sem blocos — violação do MUST HAVE do plano (blocos copiados,
        //    tasks não).
        const eraListOriginalmente = opts.toTemplate
          ? node.idClasse === ID_CLASSE_LIST
          : novo.idClasse === ID_CLASSE_LIST;

        // Seed de statuses V3 (bootstrap de status) só faz sentido quando o
        // RESULTADO é uma List REAL (-352) — uma List-template (-401) não usa
        // status V3 (o editor de templates não os exibe). No caminho
        // `toTemplate` o resultado é -401, então `seedProject` é pulado ali;
        // `copyPhases` (estrutura de blocos) roda de qualquer forma.
        if (eraListOriginalmente) {
          if (novo.idClasse === ID_CLASSE_LIST) {
            await this.seedBootstrap.seedProject(tx, refId);
          }

          // Copiar as FASES/BLOCOS (-200) da List original para a nova.
          // `copyPhases` retorna o phaseIdMap (old -200 → new -200); consumido
          // por `copyTasks` (abaixo) para remapear `dados.idBloco`. O caminho
          // `duplicate` (includeTasks=false) ignora o retorno.
          const phaseIdMap = await this.copyPhases(tx, node.chave, novo.chave);

          // ┌─ Sub-fase 3 (Templates) — cópia das tasks de trabalho (-154) ─────
          // │ Só quando `opts.includeTasks === true` (rota from-template). A
          // │ duplicação simples (`duplicate()`) NÃO entra aqui — comportamento
          // │ legado intacto. `refId` é o handle canônico (E) da List clone,
          // │ usado como counterScope (counter -475), escopo de INBOX/priorities
          // │ e mantém a paridade write/read com `tasks.service`.
          // └──────────────────────────────────────────────────────────────────
          if (opts.includeTasks === true) {
            const prefixDaListaClone =
              ((novo.dados as Record<string, unknown> | null)?.prefix as string | undefined) ??
              'DEV';
            await this.copyTasks(
              tx,
              node.chave,
              novo.chave,
              phaseIdMap,
              refId,
              prefixDaListaClone,
              userEntidadeId,
            );
          }
        }
      }

      const newRootId = idMap.get(rootNode.chave.toString());
      if (!newRootId) {
        // Defesa: a raiz é sempre o 1º item — não deve acontecer.
        throw new BadRequestException('Falha ao duplicar: raiz não materializada');
      }
      return tx.dProject.findFirstOrThrow({
        where: { chave: newRootId },
        select: PROJECT_RESPONSE_SELECT,
      });
    });

    await this.eventProducer.addInternalEvent(
      'project.created',
      {
        projectId: created.chave.toString(),
        nome: created.nome,
        prefix: (created.dados as Record<string, unknown> | null)?.prefix ?? 'DEV',
        userId: userEntidadeId.toString(),
        duplicatedFrom: id,
        // Feature Templates: distingue uma materialização from-template de uma
        // duplicação comum no audit (evento único agregado, não N task.created).
        ...(opts.fromTemplate ? { fromTemplate: true } : {}),
        // Extensão Templates (ADR-V2-062): distingue uma promoção real→template
        // de uma duplicação/materialização comum no audit trail.
        ...(opts.toTemplate ? { promotedToTemplate: true } : {}),
      },
      this.correlationIdService.getOrGenerate(),
      { source: ProjectsService.name },
    );

    this.logger.log(`Projeto ${projectId} duplicado por user=${userEntidadeId} → ${created.chave}`);

    // Executante é MANAGER da cópia (criou os DVincula -171 acima).
    return this.buildResponse(created, 1, null, null, undefined, undefined, 'MANAGER');
  }

  /**
   * Materializa um projeto (List/Space) a partir de um TEMPLATE (feature
   * Templates — ADR-V2-061). O `:id` é um DProject-template (`idClasse` -401
   * TEMPLATE_LIST ou -402 TEMPLATE_SPACE); o resultado é a árvore inteira
   * clonada com a DClasse remapeada para a real (-401→-352 LIST, -402→-350
   * SPACE), blocos e tasks copiados (molde-limpo) e `idEstab` carimbado com a
   * org ativa em TODOS os nós.
   *
   * Acesso ao template:
   *  - Usável se for da org ativa (`idEstab = organizationId`) OU GLOBAL
   *    (`idEstab` NULL — template padrão de plataforma, visível a todas as orgs).
   *    Template de OUTRA org → 404 (não vaza existência cross-tenant). O clone
   *    de um template global nasce carimbado na org ativa (nunca herda NULL).
   *  - Permissão no DESTINO: se `dto.idPai` é fornecido, o usuário deve ser
   *    MANAGER do destino (ou ORG_ADMIN); o destino deve ser da mesma org e do
   *    tipo compatível (LIST-template nasce sob SPACE/FOLDER). Se `idPai` é
   *    ausente e o template é SPACE (-402), o SPACE nasce como raiz e basta ser
   *    membro da org.
   *  - O executante vira MANAGER de cada nó materializado (o `cloneTree` cria os
   *    DVincula -171). O `cloneTree` PULA o RBAC de origem (usar template ≠
   *    gerenciá-lo) — a autorização é a do destino, validada aqui.
   *
   * @param id - Chave BigInt do template (string).
   * @param userEntidadeId - Chave BigInt da DEntidade do executante.
   * @param organizationId - `DEntidade.chave` da org ativa (string).
   * @param dto - Opções de materialização (ver {@link CreateFromTemplateDto}).
   * @returns ProjectResponseDto do nó raiz materializado (classe já -350/-352,
   *   myRole=MANAGER).
   *
   * @throws {BadRequestException} Se `:id` não é um template, destino
   *   incompatível, ou org ausente no token.
   * @throws {ForbiddenException} Se o usuário não é MANAGER do destino (ou
   *   membro da org quando nasce como raiz).
   * @throws {NotFoundException} Se o template/destino não existe ou pertence a
   *   outra org (template não-global de outra org → 404). Templates GLOBAIS
   *   (idEstab NULL) são aceitos por qualquer org (Sub-fase 4b).
   *
   * @see cloneTree — motor de deep-clone (acionado com fromTemplate+idEstabDestino)
   * @see ADR-V2-061 — marcação por DClasse -401/-402 + remap obrigatório
   */
  async createFromTemplate(
    id: string,
    userEntidadeId: bigint,
    organizationId: string | undefined,
    dto: CreateFromTemplateDto,
  ): Promise<ProjectResponseDto> {
    // Org ativa é obrigatória no caminho org-scoped (Sub-fase 4a).
    if (!organizationId || !/^-?\d+$/.test(organizationId)) {
      throw new BadRequestException('Org ativa ausente no token (necessária para from-template)');
    }
    const orgIdBig = BigInt(organizationId);
    const templateId = BigInt(id);

    // 1) Carregar o template e validar que É um template DA org ativa.
    const template = await this.prisma.dProject.findFirst({
      where: { chave: templateId, excluido: false },
      select: { chave: true, idClasse: true, idEstab: true },
    });
    if (!template) {
      throw new NotFoundException(`Template ${id} não encontrado`);
    }
    const isTemplateClasse =
      template.idClasse === ID_CLASSE_TEMPLATE_LIST ||
      template.idClasse === ID_CLASSE_TEMPLATE_SPACE;
    if (!isTemplateClasse) {
      throw new BadRequestException(`Projeto ${id} não é um template (idClasse -401/-402)`);
    }
    // Acesso ao template (Sub-fase 4b): um template é usável se for da org ativa
    // (org-scoped) OU GLOBAL (idEstab NULL — visível a todas as orgs, criado por
    // seed/plataforma). Template de OUTRA org → 404 (não vaza existência). O clone
    // resultante é sempre carimbado com a org ativa via `idEstabDestino` (passo 3),
    // então um template global materializa dentro da org ativa.
    if (template.idEstab !== null && template.idEstab !== orgIdBig) {
      throw new NotFoundException(`Template ${id} não encontrado`);
    }

    // 2) Destino + permissão.
    const isTemplateList = template.idClasse === ID_CLASSE_TEMPLATE_LIST;
    let idPaiDestino: bigint | null | 'SAME';

    if (dto.idPai) {
      const paiId = BigInt(dto.idPai);
      // Destino existe e é da mesma org (tenant).
      const destino = await this.prisma.dProject.findFirst({
        where: { chave: paiId, excluido: false },
        select: { chave: true, idClasse: true, idEstab: true },
      });
      if (!destino || destino.idEstab === null || destino.idEstab !== orgIdBig) {
        throw new NotFoundException(`Destino ${dto.idPai} não encontrado`);
      }
      // Tipo compatível: LIST-template nasce sob SPACE/FOLDER; SPACE-template
      // não pode nascer sob outro nó (Space é sempre raiz — ADR-V2-051).
      if (isTemplateList) {
        if (destino.idClasse !== ID_CLASSE_SPACE && destino.idClasse !== ID_CLASSE_FOLDER) {
          throw new BadRequestException(
            'Template de Lista deve nascer sob um SPACE ou FOLDER (hierarquia inválida)',
          );
        }
      } else {
        // TEMPLATE_SPACE → materializa SPACE, que é sempre raiz.
        throw new BadRequestException('Template de Espaço nasce como raiz (não informe idPai)');
      }
      // Permissão no DESTINO: MANAGER do destino (ou ORG_ADMIN herdado).
      await this.requireManagerRole(paiId, userEntidadeId, organizationId);
      idPaiDestino = paiId;
    } else {
      // Sem destino: só TEMPLATE_SPACE pode nascer como raiz; LIST exige destino.
      if (isTemplateList) {
        throw new BadRequestException('Template de Lista requer um destino (idPai)');
      }
      // SPACE como raiz → exigir que o usuário seja MEMBRO da org (mínimo).
      const orgMember = await this.prisma.dVincula.findFirst({
        where: {
          idEntidade: userEntidadeId,
          idLocEscritu: orgIdBig,
          idClasse: { in: ORG_ROLE_CLASSES },
          excluido: false,
        },
        select: { chave: true },
      });
      if (!orgMember) {
        throw new ForbiddenException('Acesso negado: requer ser membro da org');
      }
      idPaiDestino = null;
    }

    // 3) Materializar via motor genérico. `fromTemplate` pula o RBAC de origem e
    //    aciona o remap de classe; `idEstabDestino` carimba a org ativa em todos
    //    os nós; `includeTasks` default true (molde completo).
    return this.cloneTree(id, userEntidadeId, organizationId, {
      includeTasks: dto.includeTasks ?? true,
      novoNome: dto.novoNome,
      novoIcone: dto.novoIcone,
      idPaiDestino,
      fromTemplate: true,
      idEstabDestino: orgIdBig,
    });
  }

  /**
   * Promove um projeto real (List/Space) a Template reutilizável (extensão da
   * feature Templates — ADR-V2-062). O `:id` é um DProject real (`idClasse`
   * -352 LIST ou -350 SPACE); o resultado é uma CÓPIA da árvore inteira, com a
   * DClasse remapeada para o template (-352→-401 TEMPLATE_LIST, -350→-402
   * TEMPLATE_SPACE), blocos copiados, tasks de trabalho NÃO copiadas
   * (molde-limpo), `dados.categoria` carimbado na raiz e `idEstab` carimbado
   * com a org ativa.
   *
   * **Decisão: CÓPIA, não mutação** — o projeto original permanece intacto
   * (idClasse, tasks, tudo), consistente com o padrão já estabelecido por
   * `duplicate()`/`createFromTemplate()` (ver seção 2 do plano de
   * implementação, `workspace/plans/plan-templates-promote-to-template-task7.md`).
   *
   * Permissão: `requireManagerRole` roda DENTRO de `cloneTree` (gate
   * tenant-rígido + RBAC de ORIGEM ATIVOS, pois `opts.fromTemplate` está
   * ausente) — exige MANAGER na origem, sem reimplementar nada aqui.
   *
   * Evento emitido `project.created` (via `cloneTree`) com discriminador
   * `promotedToTemplate: true` para rastreabilidade no audit trail.
   *
   * @param id - Chave BigInt do projeto (List -352 ou Space -350) a promover (string)
   * @param userEntidadeId - Chave BigInt do MANAGER executante
   * @param organizationId - `DEntidade.chave` da org ativa (string) — usada
   *   para carimbar `idEstab` do template resultante (nunca nasce global)
   * @param dto - Categoria obrigatória + nome opcional (ver {@link PromoteToTemplateDto})
   * @returns ProjectResponseDto do template resultante (já -401/-402, myRole=MANAGER)
   *
   * @throws {BadRequestException} Se org ativa ausente no token, ou origem não
   *   é List (-352) nem Space (-350)
   * @throws {NotFoundException} Se o projeto de origem não existe ou está excluído
   * @throws {ForbiddenException} Se o usuário não é MANAGER na origem
   *
   * @example
   * ```typescript
   * const template = await service.promoteToTemplate(
   *   '108',
   *   BigInt(userId),
   *   '5',
   *   { categoria: 'Desenvolvimento', novoNome: 'Molde QA E2E' },
   * );
   * ```
   *
   * @see cloneTree — motor de deep-clone (acionado com toTemplate+idEstabDestino)
   * @see ADR-V2-061 — marcação por DClasse -401/-402 + catálogo via dados.categoria
   */
  async promoteToTemplate(
    id: string,
    userEntidadeId: bigint,
    organizationId: string | undefined,
    dto: PromoteToTemplateDto,
  ): Promise<ProjectResponseDto> {
    // Org ativa é obrigatória — o template resultante nasce escopado a ela
    // (nunca global), mesmo padrão de `createFromTemplate`.
    if (!organizationId || !/^-?\d+$/.test(organizationId)) {
      throw new BadRequestException(
        'Org ativa ausente no token (necessária para promote-to-template)',
      );
    }
    const orgIdBig = BigInt(organizationId);

    // Validar que a origem é LIST (-352) ou SPACE (-350) — não faz sentido
    // promover um Folder (-351) isolado ou um template já existente (-401/-402).
    const projectId = BigInt(id);
    const origem = await this.prisma.dProject.findFirst({
      where: { chave: projectId, excluido: false },
      select: { idClasse: true },
    });
    if (!origem) {
      throw new NotFoundException(`Projeto ${id} não encontrado`);
    }
    if (origem.idClasse !== ID_CLASSE_LIST && origem.idClasse !== ID_CLASSE_SPACE) {
      throw new BadRequestException(
        'Somente List (-352) ou Space (-350) podem ser promovidos a template',
      );
    }

    // requireManagerRole roda DENTRO de cloneTree (opts.fromTemplate ausente
    // → gate tenant-rígido + RBAC de origem ATIVOS, igual a duplicate()).
    return this.cloneTree(id, userEntidadeId, organizationId, {
      novoNome: dto.novoNome,
      toTemplate: true,
      categoriaTemplate: dto.categoria,
      idEstabDestino: orgIdBig,
      // includeTasks ausente/false (default) → molde-limpo, SEM as tasks.
    });
  }

  /**
   * Copia as FASES/BLOCOS (-200) de uma List para outra, preservando a
   * hierarquia de sub-fases (remapeando `idPai`). Tasks de trabalho (-154) NÃO
   * são copiadas. Chamado dentro da transaction de `cloneTree`.
   *
   * @param tx - Prisma transaction client
   * @param sourceProjectId - Chave BigInt da List de origem (P)
   * @param targetProjectId - Chave BigInt da List de destino (P)
   * @returns Mapa `old -200 chave (string)` → `new -200 chave (bigint)`
   *   (`phaseIdMap`). Consumido pelo `copyTasks` na Sub-fase 3 (Templates) para
   *   remapear `dados.idBloco` das tasks clonadas. O caminho `duplicate`
   *   (Sub-fase 2) ignora o retorno. Mapa vazio quando a List não tem fases.
   */
  private async copyPhases(
    tx: Prisma.TransactionClient,
    sourceProjectId: bigint,
    targetProjectId: bigint,
  ): Promise<Map<string, bigint>> {
    // Buscar fases ordenadas por hierarquia: raízes (idPai null) antes das
    // sub-fases. `chave ASC` como desempate estável dentro de cada nível.
    const phases = await tx.dTask.findMany({
      where: {
        idProject: sourceProjectId,
        idClasse: ID_CLASSE_PHASE,
        excluido: false,
      },
      select: {
        chave: true,
        idPai: true,
        nome: true,
        descricao: true,
        dados: true,
      },
      orderBy: [{ idPai: { sort: 'asc', nulls: 'first' } }, { chave: 'asc' }],
    });

    const phaseIdMap = new Map<string, bigint>();

    if (phases.length === 0) return phaseIdMap;

    for (const phase of phases) {
      // Sub-fase: pai já foi copiado (ordem nulls-first + chave asc garante isso
      // para árvores bem-formadas). Se o pai não estiver no mapa (caso raro de
      // ordenação não-topológica), cria como raiz para não perder o bloco.
      const newIdPai = phase.idPai ? (phaseIdMap.get(phase.idPai.toString()) ?? null) : null;

      const novaFase = await tx.dTask.create({
        data: {
          idClasse: ID_CLASSE_PHASE,
          idProject: targetProjectId,
          nome: phase.nome,
          ...(phase.descricao ? { descricao: phase.descricao } : {}),
          ...(newIdPai !== null ? { idPai: newIdPai } : {}),
          dados: (phase.dados ?? {}) as Prisma.InputJsonValue,
        },
        select: { chave: true },
      });

      phaseIdMap.set(phase.chave.toString(), novaFase.chave);
    }

    return phaseIdMap;
  }

  /**
   * Reseta o `dados` de uma task para o estado "molde limpo" no clone de
   * template (Sub-fase 3 — Templates). Helper puro (sem I/O), testável
   * isoladamente.
   *
   * Transformações (decisões TRAVADAS — ver
   * `workspace/plans/plan-templates-feature.md` §"DECISÕES TRAVADAS" #4):
   *  - `identifier` ← `novoIdentifier` (novo DEV-N do counter da List clone).
   *  - `v3` ← `{ state: 'INBOX', movedAt, movedBy }` (mesma forma de
   *    {@link buildInitialTaskDados}; a task nasce no início do fluxo).
   *  - `telemetry` ← `{}` (zera `workSessions[]` de IA E `manualTimers[]`
   *    humano — ADR-V2-057; um molde não carrega tempo gasto).
   *  - remove `automation` e `capture` (dados de instância, não de molde).
   *  - **remapeia `dados.idBloco`** via `blocoIdMap` (old -200 → new -200): se a
   *    task aponta a um bloco copiado, troca pelo novo id; se o bloco não está
   *    no mapa (órfão — bloco excluído), grava `null` + `logger.warn` (não
   *    quebra o clone).
   *  - **COPIA `dados.fields`** (valores de colunas customizadas = parte do
   *    molde — Decisão #4). Mantido intacto.
   *
   * @param rawDados - Valor bruto do campo `dados` (Json) da task de origem.
   * @param novoIdentifier - Identifier DEV-N recém-gerado para a task clonada.
   * @param blocoIdMap - Mapa `old -200 chave (string)` → `new -200 chave`
   *   (o `phaseIdMap` de {@link copyPhases}).
   * @param movedBy - DEntidade.chave (string) do executante — vira `v3.movedBy`.
   * @returns `dados` resetado pronto para persistir.
   */
  private resetTaskDados(
    rawDados: unknown,
    novoIdentifier: string,
    blocoIdMap: Map<string, bigint>,
    movedBy: string,
  ): Record<string, unknown> {
    const original = parseTaskDados(rawDados) as Record<string, unknown>;

    // Partir do original para PRESERVAR campos de molde (ex.: fields, taskType,
    // assigneeTeamId) e então sobrescrever/limpar o que é de instância.
    const novo: Record<string, unknown> = { ...original };

    novo.identifier = novoIdentifier;
    novo.v3 = {
      state: 'INBOX',
      movedAt: new Date().toISOString(),
      movedBy,
    };
    // Zera telemetria por inteiro: workSessions (IA) + manualTimers (humano).
    novo.telemetry = {};
    // Dados de instância — não fazem parte do molde.
    delete novo.automation;
    delete novo.capture;

    // Remap de `idBloco` (task → bloco -200). `fields` é COPIADO (parte do
    // molde) e portanto NÃO é tocado aqui.
    const idBlocoOriginal = original.idBloco;
    if (idBlocoOriginal !== undefined && idBlocoOriginal !== null) {
      const novoIdBloco = blocoIdMap.get(idBlocoOriginal.toString());
      if (novoIdBloco !== undefined) {
        novo.idBloco = novoIdBloco.toString();
      } else {
        this.logger.warn(
          `resetTaskDados: idBloco órfão (${String(idBlocoOriginal)}) não está no ` +
            `phaseIdMap — task clonada nasce sem bloco (idBloco=null)`,
        );
        novo.idBloco = null;
      }
    }

    return novo;
  }

  /**
   * Copia as TASKS de trabalho (-154) de uma List para outra no clone de
   * template (Sub-fase 3 — Templates). Chamado dentro da transaction de
   * {@link cloneTree} APÓS {@link copyPhases}, apenas quando
   * `opts.includeTasks === true`.
   *
   * Leituras em **batch fixo** (ZERO N+1 de leitura):
   *  1. todas as tasks -154 da List origem (1 query, ordenadas pai-antes-da-
   *     subtarefa via `idPai nulls-first, chave asc`);
   *  2. o status INBOX da List clone (1 query — `counterScope = E` da clone);
   *  3. as priorities da List clone (1 query) → mapa código→chave para remapear
   *     `idPriority` (o `seedProject` cria priorities -421..-424 por projeto).
   *
   * No loop, por task: gera um novo `identifier` DEV-N atômico (counter -475 da
   * clone — incremento sequencial, requisito funcional, NÃO N+1 de leitura),
   * reseta o `dados` (molde limpo via {@link resetTaskDados}) e cria a DTask.
   *
   * Reset molde-limpo (decisões TRAVADAS): `idStatus = INBOX` da clone;
   * `idPriority` remapeado por código (ou `null`); `idPai` task→task remapeado
   * (pai já criado pela ordem nulls-first); `idAssignee = null` e
   * `dueDate = null` (molde não carrega responsável nem prazo); `idCreator =`
   * executante (quem clonou cria).
   *
   * @param tx - Prisma transaction client.
   * @param sourceListId - Chave BigInt (P) da List de origem.
   * @param targetListId - Chave BigInt (P) da List de destino (a clone).
   * @param blocoIdMap - `phaseIdMap` de {@link copyPhases} (old -200 → new -200).
   * @param counterScope - Handle canônico (E) da List clone — usado no counter
   *   -475 e como `dEntidadeId` de INBOX/priorities (ADR-V2-058/059).
   * @param prefix - Prefixo do identifier da List clone (`dados.prefix ?? 'DEV'`).
   * @param creatorId - DEntidade.chave do executante (vira `idCreator`/`movedBy`).
   * @returns Número de tasks copiadas.
   */
  private async copyTasks(
    tx: Prisma.TransactionClient,
    sourceListId: bigint,
    targetListId: bigint,
    blocoIdMap: Map<string, bigint>,
    counterScope: bigint,
    prefix: string,
    creatorId: bigint,
  ): Promise<number> {
    // 1) Batch: todas as tasks -154 da List origem. Ordem nulls-first em idPai
    //    garante que a task-pai é criada ANTES da subtarefa — o remap de idPai
    //    sempre encontra o novo id do pai já materializado.
    const tasks = await tx.dTask.findMany({
      where: {
        idProject: sourceListId,
        idClasse: ID_CLASSE_TASK,
        excluido: false,
      },
      select: {
        chave: true,
        idPai: true,
        nome: true,
        descricao: true,
        idPriority: true,
        dados: true,
      },
      orderBy: [{ idPai: { sort: 'asc', nulls: 'first' } }, { chave: 'asc' }],
    });

    if (tasks.length === 0) return 0;

    // 2) Batch: status INBOX da List clone (escopo E). Toda task nasce aqui.
    const inbox = await tx.dTabela.findFirst({
      where: {
        idClasse: ID_CLASSE_STATUS_INBOX,
        dEntidadeId: counterScope,
        excluido: false,
      },
      select: { chave: true },
    });

    // 3) Batch: priorities da List clone (escopo E) → mapa idClasse→chave. O
    //    `seedProject` já criou as 4 priorities (-421..-424) da clone. Mapeamos
    //    a PRIORITY da task origem para a DA CLONE pela MESMA idClasse (cada
    //    código de prioridade tem idClasse fixo: HIGH=-421, etc.).
    const clonePriorities = await tx.dTabela.findMany({
      where: {
        idClasse: { in: PRIORITY_CLASSES },
        dEntidadeId: counterScope,
        excluido: false,
      },
      select: { chave: true, idClasse: true },
    });
    const clonePriorityByClasse = new Map<string, bigint>(
      clonePriorities.map((p) => [p.idClasse.toString(), p.chave]),
    );

    // Para remapear idPriority por código precisamos da idClasse da priority de
    // ORIGEM (que carrega o código). 1 query batch resolve todas as priorities
    // de origem referenciadas pelas tasks (ZERO N+1).
    const sourcePriorityIds = Array.from(
      new Set(
        tasks
          .map((t) => t.idPriority)
          .filter((v): v is bigint => v !== null && v !== undefined)
          .map((v) => v.toString()),
      ),
    ).map((s) => BigInt(s));
    const sourcePriorityClasseById = new Map<string, bigint>();
    if (sourcePriorityIds.length > 0) {
      const sourcePriorities = await tx.dTabela.findMany({
        where: { chave: { in: sourcePriorityIds } },
        select: { chave: true, idClasse: true },
      });
      for (const sp of sourcePriorities) {
        sourcePriorityClasseById.set(sp.chave.toString(), sp.idClasse);
      }
    }

    // Mapa old DTask.chave (string) → new DTask.chave — remap de idPai task→task.
    const taskIdMap = new Map<string, bigint>();
    let copied = 0;

    for (const t of tasks) {
      // Incremento atômico sequencial do counter -475 da clone (requisito
      // funcional — NÃO é N+1 de leitura).
      const novoIdentifier = await this.identifierService.getNextIdentifier(
        tx,
        counterScope,
        prefix,
      );

      const dadosNovo = this.resetTaskDados(
        t.dados,
        novoIdentifier,
        blocoIdMap,
        creatorId.toString(),
      );

      // Remap idPriority por CÓDIGO (via idClasse): resolve a idClasse da
      // priority de origem e busca a priority de mesma idClasse na clone.
      let idPriorityNovo: bigint | null = null;
      if (t.idPriority !== null && t.idPriority !== undefined) {
        const classe = sourcePriorityClasseById.get(t.idPriority.toString());
        idPriorityNovo = classe ? (clonePriorityByClasse.get(classe.toString()) ?? null) : null;
      }

      // Remap idPai task→task (pai já criado pela ordem nulls-first).
      const novoIdPai = t.idPai ? (taskIdMap.get(t.idPai.toString()) ?? null) : null;

      const novaTask = await tx.dTask.create({
        data: {
          idClasse: ID_CLASSE_TASK,
          idProject: targetListId,
          nome: t.nome,
          ...(t.descricao ? { descricao: t.descricao } : {}),
          idStatus: inbox?.chave ?? null,
          idPriority: idPriorityNovo,
          // Molde limpo: template não carrega responsável nem prazo.
          idAssignee: null,
          dueDate: null,
          idCreator: creatorId,
          ...(novoIdPai !== null ? { idPai: novoIdPai } : {}),
          dados: dadosNovo as Prisma.InputJsonValue,
        },
        select: { chave: true },
      });

      taskIdMap.set(t.chave.toString(), novaTask.chave);
      copied++;
    }

    return copied;
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
          in: [BigInt(-441), BigInt(-442), BigInt(-443), BigInt(-444), BigInt(-445)],
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
   * Valida que o usuário pode gerir o projeto (update, delete, etc.).
   *
   * Helper para autorização. Concede acesso por DUAS vias:
   *
   *  1. **MANAGER explícito** — DVincula -171 (PROJECT_MANAGER) do usuário
   *     naquele projeto (criador do projeto, ou promovido a manager).
   *  2. **Herança ORG_ADMIN → MANAGER** — admin da workspace (DVincula -161
   *     ORG_ADMIN na org informada) tem poder de gestão sobre TODOS os projetos
   *     da própria org, mesmo sem vínculo -171 explícito. Só se aplica quando
   *     `organizationId` está presente (paths HTTP autenticados); como os
   *     callers (`update`/`delete`) já validaram tenant (`idEstab === org`)
   *     ANTES desta chamada, o projeto comprovadamente pertence à org — logo o
   *     ORG_ADMIN dessa org é legítimo gestor. Callers internos/MCP sem org
   *     continuam exigindo -171 explícito (comportamento conservador).
   *
   * Lança ForbiddenException se nenhuma via concede acesso.
   *
   * @param projectId - Chave BigInt do projeto
   * @param userId - Chave BigInt do usuário
   * @param organizationId - (Opcional) DEntidade.chave da org ativa (JWT). Habilita
   *   a herança ORG_ADMIN → MANAGER quando presente e numérico.
   * @throws {ForbiddenException} Se não é MANAGER nem ORG_ADMIN da org
   *
   * @private
   */
  private async requireManagerRole(
    projectId: bigint,
    userId: bigint,
    organizationId?: string,
  ): Promise<void> {
    // ADR-V2-058: handle do projeto em DVincula = chave da espelho (-158).
    const refId = await this.projectRef.resolveEntidadeRef(projectId);
    const vinculo = await this.prisma.dVincula.findFirst({
      where: {
        idLocEscritu: refId,
        idEntidade: userId,
        idClasse: ID_CLASSE_PROJECT_MANAGER,
        excluido: false,
      },
      select: { chave: true },
    });

    if (vinculo) {
      return;
    }

    // Herança ORG_ADMIN → MANAGER: admin da workspace gere qualquer projeto da org.
    if (organizationId && /^-?\d+$/.test(organizationId)) {
      const orgAdmin = await this.prisma.dVincula.findFirst({
        where: {
          idEntidade: userId,
          idLocEscritu: BigInt(organizationId),
          idClasse: ID_CLASSE_ORG_ADMIN,
          excluido: false,
        },
        select: { chave: true },
      });

      if (orgAdmin) {
        return;
      }
    }

    throw new ForbiddenException('Acesso negado: requer role MANAGER no projeto');
  }

  /**
   * Determina se um usuário tem acesso a um projeto por herança de espaço
   * público (ADR-V2-051 §8 — Camada A).
   *
   * Sobe a hierarquia (`idPai`) via CTE recursiva até o SPACE raiz da cadeia.
   * Se esse SPACE é público (`privado=false`) e o usuário é membro da org dona
   * (qualquer role -161/-162/-163), o acesso é concedido SEM DVincula de
   * projeto — exatamente como faz `list()` (Camada A). É o que garante que
   * pastas e listas filhas de um espaço público sejam abríveis por qualquer
   * membro do workspace, não apenas pelo criador.
   *
   * Se a cadeia não tem SPACE (anomalia de dados / projeto órfão), faz fallback
   * para o flag `privado` do próprio projeto.
   *
   * Org-alvo (ADR-V2-069): vem do `organizationId` do token (HTTP) ou, na sua
   * ausência (caminho MCP/cross-org), é DERIVADA de `project.idEstab`. Assim a
   * Camada A passa a funcionar para chaves MCP — mas continua leak-free: exige
   * que o SPACE raiz seja público E que o usuário seja membro da org DONA do
   * projeto (`idEstab`). Projeto privado, ou de org alheia, segue negado.
   *
   * @param project - Projeto-alvo (precisa de `chave`; `idEstab` usado no MCP)
   * @param userEntidadeId - Chave BigInt da DEntidade do usuário
   * @param organizationId - `DEntidade.chave` da org ativa (string). Opcional.
   * @returns `true` se o acesso público herdado se aplica; `false` caso contrário
   *
   * @see findOne — consumidor desta verificação (Camada A)
   * @see isProjectPubliclyVisible — fonte de verdade da visibilidade hierárquica
   * @see ADR-V2-051 §8 — Visibilidade de espaços
   * @see ADR-V2-069 — Camada A no caminho MCP (org derivada de idEstab)
   */
  private async hasPublicSpaceAccess(
    project: { chave: bigint; idEstab?: bigint | null },
    userEntidadeId: bigint,
    organizationId?: string,
  ): Promise<boolean> {
    // Org-alvo: token (HTTP) ou, sem token, derivada de project.idEstab (MCP).
    // Sem nenhuma das duas (projeto órfão sem idEstab) → não aplica Camada A.
    let orgIdBig: bigint | null = null;
    if (organizationId && /^-?\d+$/.test(organizationId)) {
      orgIdBig = BigInt(organizationId);
    } else if (project.idEstab !== null && project.idEstab !== undefined) {
      orgIdBig = project.idEstab;
    }
    if (orgIdBig === null) {
      return false;
    }

    // 1) Visibilidade efetiva: o SPACE raiz da cadeia é público?
    const publicVisible = await isProjectPubliclyVisible(this.prisma, project.chave);
    if (!publicVisible) {
      return false;
    }

    // 2) Usuário precisa ser membro da org dona (qualquer role de org).
    const orgVinculo = await this.prisma.dVincula.findFirst({
      where: {
        idEntidade: userEntidadeId,
        idLocEscritu: orgIdBig,
        idClasse: { in: ORG_ROLE_CLASSES },
        excluido: false,
      },
      select: { chave: true },
    });

    return orgVinculo !== null;
  }

  /**
   * Converte o `idClasse` de um DVincula de projeto no `ProjectRole` do DTO.
   *
   * @param idClasse - idClasse do vínculo (-171/-172/-173) ou null
   * @returns 'MANAGER' | 'MEMBER' | 'VIEWER' ou null se sem vínculo
   */
  private classeToProjectRole(idClasse: bigint | null): ProjectResponseDto['myRole'] {
    if (idClasse === ID_CLASSE_PROJECT_MANAGER) return 'MANAGER';
    if (idClasse === ID_CLASSE_PROJECT_MEMBER) return 'MEMBER';
    if (idClasse === ID_CLASSE_PROJECT_VIEWER) return 'VIEWER';
    return null;
  }

  /**
   * Verifica se o usuário é ADMIN da org dona do projeto — herança que o
   * promove a MANAGER (decisão CEO 2026-06-02, espelha `requireManagerRole`).
   *
   * Usa `project.idEstab` como org-alvo para garantir escopo de tenant: admin
   * da org A nunca herda MANAGER em projeto da org B. No HTTP exige coerência
   * com o `organizationId` do token; no caminho MCP/cross-org (ADR-V2-069), sem
   * token, a org-alvo é a própria `idEstab` do projeto.
   *
   * @param project - Projeto com `idEstab` (org dona)
   * @param userEntidadeId - Chave BigInt do usuário
   * @param organizationId - DEntidade.chave da org ativa (JWT). Opcional.
   * @returns `true` se o usuário é ADMIN da org dona
   *
   * @see ADR-V2-069 — herança ORG_ADMIN no caminho MCP (org derivada de idEstab)
   */
  private async isOrgAdminForProject(
    project: { idEstab?: bigint | null },
    userEntidadeId: bigint,
    organizationId?: string,
  ): Promise<boolean> {
    // Sem org dona (projeto órfão) → nunca há admin a herdar.
    if (project.idEstab === null || project.idEstab === undefined) {
      return false;
    }
    // Org-alvo: token (com coerência de tenant) ou, sem token, a idEstab.
    let orgIdBig: bigint;
    if (organizationId && /^-?\d+$/.test(organizationId)) {
      orgIdBig = BigInt(organizationId);
      // Coerência de tenant: a org do token tem que ser a org dona do projeto.
      if (project.idEstab !== orgIdBig) {
        return false;
      }
    } else {
      orgIdBig = project.idEstab;
    }
    const orgAdmin = await this.prisma.dVincula.findFirst({
      where: {
        idEntidade: userEntidadeId,
        idLocEscritu: orgIdBig,
        idClasse: ID_CLASSE_ORG_ADMIN,
        excluido: false,
      },
      select: { chave: true },
    });
    return orgAdmin !== null;
  }

  /**
   * Resolve as orgs (DEntidade ORGANIZATION) às quais um usuário pertence,
   * via DVincula de role de org (ADR-V2-003).
   *
   * É a fonte de "contexto de tenant" para o caminho MCP/cross-org (ADR-V2-069),
   * onde não há `organizationId` de token: deriva as orgs das memberships do
   * próprio usuário. 1 query (N+1 ZERO), resultado distinct por `idLocEscritu`.
   *
   * Sem cache (vs. {@link RoleResolverService}): mudanças de papel refletem na
   * próxima chamada imediatamente — preferível para uma decisão de visibilidade.
   *
   * @param userEntidadeId - Chave BigInt da DEntidade (-150 USER)
   * @param opts.adminOnly - Quando `true`, restringe às orgs onde o usuário é
   *   ADMIN (-161). Default `false` (qualquer role de org -161/-162/-163),
   *   alinhando a Camada A do MCP à do HTTP (qualquer membro vê públicos).
   * @returns Lista distinct de `DEntidade.chave` (BigInt) das orgs do usuário
   *
   * @see ADR-V2-069 — Camada A no caminho MCP (sem token de org)
   * @see ADR-V2-070 — consumido pela tool MCP `create_project` para resolver a
   *   org de destino de um SPACE (o adaptador MCP não tem org de token); é a
   *   única autoridade de membership — SPACE nunca nasce em org alheia.
   * @see ORG_ROLE_CLASSES — roles de org consultadas
   */
  async resolveOrgIdsForUser(
    userEntidadeId: bigint,
    opts: { adminOnly?: boolean } = {},
  ): Promise<bigint[]> {
    const orgVinculos = await this.prisma.dVincula.findMany({
      where: {
        idEntidade: userEntidadeId,
        idClasse: opts.adminOnly ? ID_CLASSE_ORG_ADMIN : { in: ORG_ROLE_CLASSES },
        excluido: false,
      },
      select: { idLocEscritu: true },
    });

    // BigInt é comparado por valor em Set → dedupe direto, sem stringify.
    return Array.from(new Set(orgVinculos.map((v) => v.idLocEscritu)));
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
    doneCount?: number,
    totalCount?: number,
    myRole: ProjectResponseDto['myRole'] = null,
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
      // Progresso: preenchido apenas pela listagem (findMany). undefined em
      // respostas de item único — JSON.stringify omite os campos nesse caso.
      doneCount,
      totalCount,
      repoUrl: project.repoUrl ?? null,
      privado: project.privado ?? false,
      color: (dados?.color as string | null) ?? null,
      icon: (dados?.icon as string | null) ?? null,
      // ADR-V2-061: categoria do catálogo de templates (dados.categoria).
      // Presente para qualquer projeto que a tenha; relevante para -401/-402.
      categoria: (dados?.categoria as string | null | undefined) ?? null,
      tableFields:
        project.idClasse === ID_CLASSE_LIST
          ? mergeBuiltinColumns(project.tableFields)
          : ((project.tableFields as ProjectResponseDto['tableFields'] | undefined) ?? null),
      teamId,
      folderId,
      myRole,
      canManage: myRole === 'MANAGER',
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

    // ADR-V2-058: o -183 aponta para a espelho (-158), não DProject.chave.
    // Resolve E de cada projeto e inverte (E→P) para remapear ao projectId.
    const refMap = await this.projectRef.resolveEntidadeRefs(projectIds);
    const refToProject = new Map<string, string>();
    for (const [pidStr, refId] of refMap) {
      refToProject.set(refId.toString(), pidStr);
    }
    const refIds = Array.from(refMap.values());
    if (refIds.length === 0) {
      return map;
    }

    const links = await this.prisma.dVincula.findMany({
      where: {
        idClasse: ID_CLASSE_FOLDER_PROJECT_LINK,
        idEntidade: { in: refIds },
        excluido: false,
      },
      select: { idEntidade: true, idLocEscritu: true },
    });

    // Defesa contra mocks de testes legados que não retornam array para a
    // 4ª chamada de findMany; manter projects como null (limbo) sem crashar.
    if (Array.isArray(links)) {
      for (const link of links) {
        if (link.idEntidade !== null) {
          const pidStr = refToProject.get(link.idEntidade.toString());
          if (pidStr) {
            map.set(pidStr, link.idLocEscritu.toString());
          }
        }
      }
    }

    return map;
  }
}

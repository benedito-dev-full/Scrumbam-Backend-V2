import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { EventProducerService } from '../eventos/core/event-producer.service';
import { CorrelationIdService } from '../common/services/correlation-id.service';
import { TimezoneService } from '../common/services/timezone.service';
import { TasksIdentifierService } from './tasks-identifier.service';
import { ProjectRefService } from '../projects/project-ref.service';
import { TEMPLATE_CLASSES } from '../projects/constants/template-classes.const';
import { PhaseHierarchyService } from './services/phase-hierarchy.service';
import { validateTransition, isValidState } from './tasks-state-machine';
import { TaskStatus, buildInitialTaskDados, ManualTimerSession } from './schemas/task-dados.schema';
import { PhaseMetricsService } from './services/phase-metrics.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { TaskResponseDto, ListTasksResponseDto, ActiveExecutionDto } from './dto/task-response.dto';
import { TaskTimerStateDto } from './dto/task-timer-response.dto';
import { TaskTimerService, TimerAction } from './services/task-timer.service';
import { ColumnDefDto, TableFieldsDto } from './table-fields/column-def.dto';
import {
  assertRequiredFieldValues,
  validateFieldValues,
} from './table-fields/field-value.validator';

/**
 * idClasse de DTask no seed F1 (classes canônicas V2).
 *
 * ADR-V2-050: deixou de ser usado diretamente no `create()` (substituído pelo
 * `idClasseBigInt` resolvido a partir de `dto.idClasse ?? '-154'`). Mantida
 * como constante semântica de referência — descrita pelo prefixo `_` para
 * evitar TS6133 sem perder a documentação canônica do valor (-154 = SCRUMBAN_TASK
 * no seed F1).
 */
const _ID_CLASSE_TASK = BigInt(-154); // SCRUMBAN_TASK (seed classes.seed.ts)
void _ID_CLASSE_TASK;

/** idClasse PHASE (-200) — agrupador hierárquico de tasks (ADR-V2-047). */
const ID_CLASSE_PHASE = BigInt(-200);

/**
 * Constrói o payload mínimo de `DTask.dados` para uma FASE (idClasse=-200).
 *
 * ADR-V2-050: fase é agrupador hierárquico sem intention própria. Não recebe
 * identifier DEV-N (sequence intacta), não inicializa `v3.state` (sem state
 * machine — status agregado via PhaseMetricsService) e não recebe telemetry
 * ou capture. Apenas `kind` (discriminador) e `createdBy` para audit barato.
 *
 * Mantido como função top-level (não método) para isolar dos helpers de TASK
 * (`buildInitialTaskDados`) e facilitar evolução independente.
 *
 * @param creatorId - chave (string) da DEntidade do criador
 * @returns objeto mínimo a ser serializado em `DTask.dados` (Json)
 */
function buildPhaseDados(creatorId: string): Record<string, unknown> {
  return {
    kind: 'phase',
    createdBy: creatorId,
  };
}

/** Mapa de status string → idClasse DTabela (seed F1). */
const STATUS_TO_TABELA_CLASSE: Record<string, bigint> = {
  INBOX: BigInt(-441),
  READY: BigInt(-442),
  EXECUTING: BigInt(-443),
  DONE: BigInt(-444),
  FAILED: BigInt(-445),
  CANCELLED: BigInt(-446),
  DISCARDED: BigInt(-447),
  VALIDATING: BigInt(-448),
  VALIDATED: BigInt(-449),
};

/**
 * Mapa de priority enum → idClasse DTabela (seed F1).
 * Cada projeto tem 4 DTabelas (uma por idClasse), criadas no bootstrap.
 * Lookup dinâmico via `(idClasse, dEntidadeId=projectId)` resolve a chave runtime.
 */
const PRIORITY_TO_TABELA_CLASSE: Record<string, bigint> = {
  HIGH: BigInt(-421),
  MEDIUM: BigInt(-422),
  LOW: BigInt(-423),
  URGENT: BigInt(-424),
};

/** Inverso de PRIORITY_TO_TABELA_CLASSE — mapeia idClasse string → enum para buildResponse. */
const TABELA_CLASSE_TO_PRIORITY: Record<string, string> = {
  '-421': 'HIGH',
  '-422': 'MEDIUM',
  '-423': 'LOW',
  '-424': 'URGENT',
};

/**
 * idClasses de DPedido que representam executions Claude Code via VPS.
 * -300 = EXECUTION (agrupador), -301 = LOW, -302 = MEDIUM, -303 = HIGH,
 * -304 reservado para variantes futuras. ADR-V2-005 / ADR-V2-006.
 *
 * Usado em `findActiveExecutionsForTasks` para filtrar DPedido cujo
 * `dados.taskId` aponta para uma task carregada. `baixado=false` é o
 * sinal de execução "ainda ativa" — quando o agente conclui (sucesso
 * ou falha), o DPedido é marcado como baixado.
 */
const EXECUTION_CLASS_IDS = [BigInt(-300), BigInt(-301), BigInt(-302), BigInt(-303), BigInt(-304)];

/** Retorna true quando o valor e um objeto JSON simples. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Retorna true quando o objeto possui a chave diretamente no payload. */
function hasOwnKey(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

/** Extrai `columns[]` de `DProject.tableFields` com fallback seguro para schema vazio. */
function extractTableFieldColumns(tableFields: unknown): ColumnDefDto[] {
  if (!isRecord(tableFields)) {
    return [];
  }

  const dto = tableFields as Partial<TableFieldsDto>;
  return Array.isArray(dto.columns) ? (dto.columns as ColumnDefDto[]) : [];
}

/** Extrai `DTask.dados.fields` preservando valores orfaos ja existentes. */
function extractCurrentFields(dados: Record<string, unknown>): Record<string, unknown> {
  return isRecord(dados.fields) ? { ...dados.fields } : {};
}

/**
 * Deriva o `riskLevel` (LOW/MEDIUM/HIGH) a partir do `idClasse` do DPedido.
 * Pedidos -300 (agrupador) e -304 (reservado) caem em LOW como fallback
 * conservador — na prática `OperacaoExecucaoClaude` só cria -301/-302/-303.
 *
 * @param idClasse - chave da DClasse do DPedido (BigInt)
 * @returns enum `LOW` | `MEDIUM` | `HIGH`
 */
function deriveRiskLevel(idClasse: bigint): 'LOW' | 'MEDIUM' | 'HIGH' {
  if (idClasse === BigInt(-302)) return 'MEDIUM';
  if (idClasse === BigInt(-303)) return 'HIGH';
  return 'LOW';
}

/**
 * Deriva o `status` simplificado da execução a partir do DPedido.
 *
 * Verdade canônica V2: `dados.approval.status` (Risk Gate ADR-V2-006/048).
 * Possíveis valores persistidos pelo Engine:
 * - `queued` → LOW risk, já liberado, aguardando agente VPS pegar (não bloqueia ação humana)
 * - `awaiting_approval` → MEDIUM/HIGH risk, requer aprovação humana antes de rodar
 * - `approved` → foi aprovado e está rodando no agente
 * - `rejected`/`expired` → não devem chegar aqui (baixado=true filtra)
 *
 * Fallback legado: se `dados.approval.status` ausente (DPedido antigo),
 * usa o campo raw `aprovado` — semântica histórica do Engine. Mantido
 * pra não quebrar dados pré-existentes.
 *
 * Pedidos com `baixado=true` NÃO entram aqui — filtrados no batch lookup.
 *
 * @param row - linha do DPedido com `aprovado`, `baixado` e `dados`
 * @returns enum de status simplificado para o frontend
 */
function deriveExecutionStatus(row: {
  aprovado: boolean | null;
  baixado: boolean | null;
  dados: unknown;
}): 'queued' | 'running' | 'awaiting_approval' {
  const dados = (row.dados ?? null) as Record<string, unknown> | null;
  const approval = (dados?.approval ?? null) as Record<string, unknown> | null;
  const approvalStatus = approval?.status;

  if (approvalStatus === 'queued') return 'queued';
  if (approvalStatus === 'approved') return 'running';
  if (approvalStatus === 'awaiting_approval') return 'awaiting_approval';

  // Fallback legado: DPedido sem dados.approval.status
  if (row.aprovado === false || row.aprovado === null) return 'awaiting_approval';
  return 'running';
}

/**
 * Service de tasks (DTask).
 *
 * Implementa CRUD completo de tasks com:
 * - Identifier atômico DEV-N via TasksIdentifierService
 * - V3 Intentions: 9 estados + state machine
 * - Telemetria: timestamps de transições + workSessions
 * - Auditoria: DEvento -497 (task.created) + -498 (status.changed)
 *
 * Tabela estrutural — Pilar 1 NÃO se aplica (DTask não é DPedido).
 *
 * @see PrismaService — acesso ao banco
 * @see TasksIdentifierService — geração atômica de identifiers
 * @see validateTransition — state machine V3
 * @see EventProducerService — emissão canônica de eventos (audit pós-commit)
 */
@Injectable()
export class TasksService {
  private readonly logger = new Logger(TasksService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly identifierService: TasksIdentifierService,
    private readonly eventProducer: EventProducerService,
    private readonly correlationIdService: CorrelationIdService,
    private readonly phaseHierarchy: PhaseHierarchyService,
    private readonly phaseMetrics: PhaseMetricsService,
    private readonly timezoneService: TimezoneService,
    private readonly taskTimerService: TaskTimerService,
    private readonly projectRef: ProjectRefService,
  ) {}

  /**
   * Mescla valores de colunas customizaveis em `DTask.dados.fields`.
   *
   * Busca o schema da Lista uma unica vez via `DProject.tableFields`, valida os
   * valores recebidos contra os 8 tipos suportados e retorna o objeto final de
   * `fields`. Chaves desconhecidas no payload sao ignoradas e valores `null`
   * removem a celula quando a coluna nao e obrigatoria.
   *
   * @param projectId - ID da Lista/Projeto dono da task.
   * @param dadosAtuais - JSON atual de `DTask.dados`.
   * @param incomingFields - Payload recebido em `dto.dados.fields`.
   * @returns Objeto final de `DTask.dados.fields` pronto para persistencia.
   *
   * @throws {BadRequestException} Quando `fields` e enviado em task sem projeto
   * ou quando algum valor conhecido viola o tipo da coluna.
   */
  private async mergeCustomFieldValues(
    projectId: bigint | null,
    dadosAtuais: Record<string, unknown>,
    incomingFields: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    if (!projectId) {
      throw new BadRequestException('Task sem projeto nao aceita dados.fields customizaveis');
    }

    const project = await this.prisma.dProject.findFirst({
      where: { chave: projectId, excluido: false },
      select: { tableFields: true },
    });

    if (!project) {
      throw new BadRequestException(
        `Projeto ${projectId.toString()} da task nao foi encontrado para validar fields`,
      );
    }

    const columns = extractTableFieldColumns(project.tableFields);
    const mergedFields = extractCurrentFields(dadosAtuais);
    const { values, clearedKeys } = validateFieldValues(columns, incomingFields);

    Object.assign(mergedFields, values);
    for (const key of clearedKeys) {
      delete mergedFields[key];
    }

    assertRequiredFieldValues(columns, mergedFields);
    return mergedFields;
  }

  /**
   * Cria task com identifier atômico DEV-N e estado inicial INBOX.
   *
   * Transaction atômica:
   * 1. Buscar prefix do DProject.dados
   * 2. identifierService.getNextIdentifier() — incremento atômico em DTabela -475
   * 3. DTask.create() com dados.identifier e dados.v3.state=INBOX
   *
   * Audit DEvento -497 emitido APÓS commit.
   *
   * @param dto - Dados da task (nome, projectId, priority, assigneeId)
   * @param creatorId - Chave BigInt da DEntidade do criador
   * @returns TaskResponseDto com identifier e status=INBOX
   *
   * @throws {NotFoundException} Se projeto não encontrado
   *
   * @example
   * ```typescript
   * const task = await service.create({ nome: 'Task 1', projectId: '1' }, BigInt(100));
   * // task.identifier = "DEV-1"
   * // task.status = "INBOX"
   * ```
   */
  async create(
    dto: CreateTaskDto,
    creatorId: bigint,
    accessibleProjectIds?: string[],
  ): Promise<TaskResponseDto> {
    // ADR-V2-050: idClasse opcional no DTO, default -154 (TASK). Whitelist no
    // DTO (`@IsIn(['-154','-200'])`) já bloqueia valores fora do range; aqui
    // resolvemos para BigInt e ramificamos comportamento (PHASE pula identifier,
    // status INBOX e priority; ignora silenciosamente assignee/taskType).
    const idClasseRequested = dto.idClasse ?? '-154';
    const idClasseBigInt = BigInt(idClasseRequested);
    const isPhase = idClasseBigInt === ID_CLASSE_PHASE;

    if (isPhase) {
      this.logger.log(
        `Criando FASE nome="${dto.nome}" projeto=${dto.projectId} idPai=${dto.idPai ?? 'raiz'}`,
      );
    } else {
      this.logger.log(`Criando task nome="${dto.nome}" no projeto=${dto.projectId}`);
    }

    // ADR-V2-042: validar que o projectId esta no scope autorizado
    // ANTES de qualquer query — anti enumeration.
    if (accessibleProjectIds !== undefined && !accessibleProjectIds.includes(dto.projectId)) {
      this.logger.warn(
        `tenant_mismatch_task_create projectId=${dto.projectId} fora do scope do user=${creatorId}`,
      );
      throw new NotFoundException(`Projeto ${dto.projectId} não encontrado`);
    }

    const projectId = BigInt(dto.projectId);

    // Buscar prefix do projeto
    const project = await this.prisma.dProject.findFirst({
      where: { chave: projectId, excluido: false },
      select: { dados: true },
    });

    if (!project) {
      throw new NotFoundException(`Projeto ${dto.projectId} não encontrado`);
    }

    // Validar idPai (ADR-V2-047): pai deve existir, mesmo projeto, sem ciclo.
    // ADR-V2-050: quando filha é PHASE, pai TAMBÉM deve ser PHASE (sub-fase).
    // No create taskId ainda nao existe, entao usamos newParentId apenas
    // para descer a cadeia ascendente e validar profundidade.
    let idPaiBigInt: bigint | null = null;
    if (dto.idPai !== undefined && dto.idPai !== null) {
      idPaiBigInt = BigInt(dto.idPai);

      const paiExiste = await this.prisma.dTask.findFirst({
        where: { chave: idPaiBigInt, excluido: false },
        select: { idProject: true, idClasse: true },
      });
      if (!paiExiste) {
        throw new NotFoundException(`Pai ${dto.idPai} nao encontrado`);
      }

      const paiProjectId = paiExiste.idProject?.toString() ?? null;
      if (paiProjectId !== projectId.toString()) {
        throw new BadRequestException(
          `Cross-project parent nao permitido: task.idProject=${projectId} vs pai.idProject=${paiProjectId}`,
        );
      }

      // ADR-V2-050: sub-fase requer pai com idClasse=-200.
      // (TASK como filha de PHASE OU de TASK é permitida; apenas PHASE como
      // filha de TASK é proibida — fase é macro-estrutural acima da task.)
      if (isPhase && paiExiste.idClasse !== ID_CLASSE_PHASE) {
        throw new BadRequestException(
          `Sub-fase requer pai com idClasse=-200 (recebido idClasse=${paiExiste.idClasse}).`,
        );
      }

      // Profundidade: validateNoCycle aceita newParentId arbitrario e sobe
      // a cadeia ascendente — taskId sentinela aqui e BigInt(0) (nao existe
      // como chave real, portanto nunca colide). Garante MAX_DEPTH.
      await this.phaseHierarchy.validateNoCycle(BigInt(0), idPaiBigInt);
    }

    const projectDados = project.dados as Record<string, unknown> | null;
    const prefix = (projectDados?.prefix as string | null) ?? 'DEV';

    // Identifier escopado fora da transaction para usar no evento de audit.
    // Para FASE permanece null (ADR-V2-050 — sequence DEV-N intacta).
    let createdIdentifier: string | null = isPhase ? null : `${prefix}-?`;

    // ADR-V2-050: logger.warn (telemetria barata) quando frontend manda campos
    // que não fazem sentido para fase. Não bloqueia (reduz fricção de clients
    // genéricos como Telegram/MCP).
    if (
      isPhase &&
      (dto.assigneeId || dto.priority || dto.taskType || dto.assigneeTeamId)
    ) {
      this.logger.warn(
        `create_phase_ignored_fields projectId=${dto.projectId} ` +
          `assignee=${!!dto.assigneeId} ` +
          `priority=${!!dto.priority} taskType=${!!dto.taskType} ` +
          `assigneeTeamId=${!!dto.assigneeTeamId}`,
      );
    }

    const task = await this.prisma.$transaction(async (tx) => {
      // TaskDados (ramo TASK) e Record<string, unknown> (ramo PHASE) são
      // serializados igual via `Prisma.InputJsonValue`; ambos são objetos
      // simples. `unknown` aqui evita conflito de Index signature entre os
      // dois shapes; o cast final para InputJsonValue resolve o tipo.
      let dadosPayload: unknown;
      let inboxStatusChave: bigint | null = null;
      let idPriority: bigint | null = null;

      if (isPhase) {
        // ADR-V2-050: ramo FASE — pula identifier (sequence intacta), pula
        // INBOX status (status agregado via PhaseMetricsService), pula priority.
        dadosPayload = buildPhaseDados(creatorId.toString());
      } else {
        // Ramo TASK — comportamento legado preservado.
        // ADR-V2-058/059: o counter -475 também grava DTabela.dEntidadeId
        // (FK → DEntidade.chave). Resolver P→E (legacy-safe) — mesma correção
        // aplicada a statuses/priorities no passo 1-2; este write-site
        // ficou fora do escopo daquele commit e quebrava a FK ao criar o
        // counter de um projeto NOVO (cujo P não existe em DEntidade).
        const counterScope = await this.projectRef.resolveEntidadeRef(projectId);
        const identifier = await this.identifierService.getNextIdentifier(tx, counterScope, prefix);
        createdIdentifier = identifier;

        // Construir dados V3 iniciais
        const taskDados = buildInitialTaskDados(
          identifier,
          creatorId.toString(),
          dto.rawText || dto.source
            ? {
                rawText: dto.rawText,
                source: dto.source as 'telegram' | 'web' | 'api' | 'mcp' | undefined,
              }
            : undefined,
        );

        // Injetar taskType (mantém signature de buildInitialTaskDados inalterada — ADR-V2-001)
        if (dto.taskType) {
          taskDados.taskType = dto.taskType;
        }

        // Opção A — idBloco: referência ao bloco (idClasse=-200) sem usar idPai.
        // Tasks mantêm idPai=null e aparecem em List/Kanban normalmente.
        if (dto.dados?.idBloco) {
          (taskDados as Record<string, unknown>).idBloco = dto.dados.idBloco;
        }

        // assigneeTeamId — atribuição de time (dados.assigneeTeamId).
        // Fase ignora este campo (ramo acima retorna antes de chegar aqui).
        if (dto.assigneeTeamId) {
          (taskDados as Record<string, unknown>).assigneeTeamId = dto.assigneeTeamId;
        }

        dadosPayload = taskDados;

        // Buscar idStatus para INBOX (DTabela -441 do projeto).
        // ADR-V2-058/059: statuses são gravados com a DEntidade-espelho (E);
        // resolver P→E (legacy-safe: devolve P para projetos sem espelho).
        const inboxScope = await this.projectRef.resolveEntidadeRef(projectId);
        const inboxStatus = await tx.dTabela.findFirst({
          where: {
            idClasse: BigInt(-441),
            dEntidadeId: inboxScope,
            excluido: false,
          },
          select: { chave: true },
        });
        inboxStatusChave = inboxStatus?.chave ?? null;

        // Resolver idPriority (lookup DTabela -42X escopado pelo projeto)
        idPriority = dto.priority
          ? await this.resolvePriorityId(tx, projectId, dto.priority)
          : null;
      }

      // Criar DTask
      return tx.dTask.create({
        data: {
          idClasse: idClasseBigInt,
          idProject: projectId,
          nome: dto.nome,
          descricao: dto.descricao ?? null,
          idStatus: isPhase ? null : inboxStatusChave,
          idPriority: isPhase ? null : idPriority,
          idAssignee: isPhase ? null : dto.assigneeId ? BigInt(dto.assigneeId) : null,
          idCreator: creatorId,
          idPai: idPaiBigInt,
          dados: dadosPayload as Prisma.InputJsonValue,
          // D1 — dueDate como DateTime? (não em `dados` JSON)
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
        },
      });
    });

    // Hidratar nome do criador (1 query — DEntidade.chave do JWT)
    const creator = await this.prisma.dEntidade.findFirst({
      where: { chave: creatorId, excluido: false },
      select: { nome: true },
    });

    // Audit APÓS commit — tipo task.created → idClasse=-497 TASK_CREATED
    await this.eventProducer.addInternalEvent(
      'task.created',
      {
        taskId: task.chave.toString(),
        nome: dto.nome,
        identifier: createdIdentifier,
        projectId: dto.projectId,
        userId: creatorId.toString(),
        userName: creator?.nome ?? null,
      },
      this.correlationIdService.getOrGenerate(),
      { source: TasksService.name },
    );

    // ADR-V2-047 Fase 8: phase.created — emite ADICIONAL ao task.created quando
    // a entidade criada é uma fase (idClasse=-200). Webhook trigger separado:
    // assinantes de `task.*` continuam recebendo task.created; assinantes de
    // `phase.*` recebem phase.created.
    if (task.idClasse === ID_CLASSE_PHASE) {
      await this.eventProducer.addInternalEvent(
        'phase.created',
        {
          phaseId: task.chave.toString(),
          nome: dto.nome,
          identifier: createdIdentifier,
          projectId: dto.projectId,
          idPai: task.idPai?.toString() ?? null,
          userId: creatorId.toString(),
          userName: creator?.nome ?? null,
        },
        this.correlationIdService.getOrGenerate(),
        { source: TasksService.name },
      );
    }

    // Feed de atividades do time — emitido quando task é criada com assigneeTeamId.
    // Usa entidadeId=teamId → audit-log.consumer extrai e persiste DEvento.idEntidade=teamId.
    // O endpoint GET /teams/:id/feed filtra por DEvento.idEntidade=teamId.
    // feedAction fica no nível raiz do metaDados (evita conflito com _meta do audit-log).
    // Pilar 7: APÓS persistência (commit já concluído acima).
    const taskDadosForFeed = task.dados as Record<string, unknown> | null;
    const createdWithTeamId = taskDadosForFeed?.assigneeTeamId as string | undefined;
    if (createdWithTeamId) {
      await this.eventProducer.addInternalEvent(
        'task.created',
        {
          entidadeId: createdWithTeamId,
          taskId: task.chave.toString(),
          taskNome: task.nome,
          userId: creatorId.toString(),
          userName: creator?.nome ?? null,
          feedAction: 'TASK_CREATED',
          feedTeamId: createdWithTeamId,
        },
        this.correlationIdService.getOrGenerate(),
        { source: TasksService.name },
      );
    }

    const priorityMap = await this.buildPriorityMap([task.idPriority]);
    return this.buildResponse(task, priorityMap);
  }

  /**
   * Lista tasks com filtros e cursor pagination.
   *
   * **ADR-V2-042 — Tenant isolation defense-in-depth:** este metodo
   * agora exige `accessibleProjectIds` (lista de `DProject.chave` ja
   * autorizados pelo caller) E filtra `DTask.idProject IN
   * (accessibleProjectIds)`. Caller responsavel por resolver projetos
   * acessiveis usando `ProjectsService.findAccessibleProjectIds(userId, orgId)`.
   *
   * Se `accessibleProjectIds` for vazio, retorna lista vazia sem hit no
   * banco — defesa contra JWT orfao ou user sem projetos na org.
   *
   * Quando o caller passa `query.projectId`, ele DEVE estar contido em
   * `accessibleProjectIds` (caller checa). Caso contrario, retorna vazio
   * (defense-in-depth).
   *
   * N+1 ZERO — select seletivo com cursor pagination.
   *
   * @param query - Filtros: projectId, status, assigneeId, cursor, limit
   * @param accessibleProjectIds - Lista de `DProject.chave` (BigInt como string)
   *   onde o usuario tem acesso E que pertencem a org ativa. Resolva via
   *   `ProjectsService.findAccessibleProjectIds(userEntidadeId, organizationId)`.
   * @returns Lista paginada de tasks
   *
   * @example
   * ```typescript
   * const allowedIds = await projects.findAccessibleProjectIds(uid, orgId);
   * const { items } = await tasks.findMany({ status: 'INBOX' }, allowedIds);
   * ```
   */
  async findMany(
    query: ListTasksQueryDto,
    accessibleProjectIds: string[],
  ): Promise<ListTasksResponseDto> {
    const take = Math.min(query.limit ?? 20, 100);

    // ADR-V2-042: sem projetos autorizados → retorna vazio sem hit no banco.
    if (!accessibleProjectIds || accessibleProjectIds.length === 0) {
      return { items: [], pagination: { hasMore: false, nextCursor: null } };
    }

    // Filtro projectId precisa estar dentro do scope autorizado. Se nao
    // estiver, retorna vazio (mensagem identica → anti enumeration).
    //
    // ADR-V2-061 (extensão ao agregado DTask): um TEMPLATE GLOBAL (-401/-402
    // com idEstab=NULL) é catálogo público read-only — visível a todas as orgs.
    // Sua prévia (`GET /tasks?projectId={templateGlobal}`) precisa ler os blocos
    // (-200) e tasks (-154) sem que o tenant guard (ADR-V2-042) zere o resultado.
    // O bypass é cirúrgico: só libera o caminho `projectId == template global`,
    // sem alargar o set geral. A query de confirmação (`isGlobalTemplate`) só
    // roda quando o guard normal JÁ ia negar — custo zero no fluxo normal.
    if (query.projectId && !accessibleProjectIds.includes(query.projectId)) {
      if (!(await this.isGlobalTemplate(BigInt(query.projectId)))) {
        this.logger.warn(
          `tenant_mismatch_tasks_findMany projectId=${query.projectId} nao esta em accessibleProjectIds`,
        );
        return { items: [], pagination: { hasMore: false, nextCursor: null } };
      }
      // templateBypass: segue o fluxo restrito a query.projectId — o cálculo de
      // `scopedProjectIds` abaixo (linha do `if (query.projectId)`) já produz
      // `[BigInt(query.projectId)]`, mantendo a leitura confinada ao template.
    }

    // Calcular escopo final: se query.projectId esta no scope, restringir a ele.
    // Caso contrario, se query.projectIds vier do MCP, usa a INTERSECCAO.
    let scopedProjectIds: bigint[];
    if (query.projectId) {
      scopedProjectIds = [BigInt(query.projectId)];
    } else if (query.projectIds?.length) {
      const accessibleSet = new Set(accessibleProjectIds);
      scopedProjectIds = query.projectIds
        .filter((id) => accessibleSet.has(id))
        .map((id) => BigInt(id));
      if (scopedProjectIds.length === 0) {
        return { items: [], pagination: { hasMore: false, nextCursor: null } };
      }
    } else {
      scopedProjectIds = accessibleProjectIds.map((id) => BigInt(id));
    }

    // Construir filtro where
    const where: Prisma.DTaskWhereInput = {
      excluido: false,
      idProject: { in: scopedProjectIds },
      ...(query.assigneeId ? { idAssignee: BigInt(query.assigneeId) } : {}),
      ...(query.cursor ? { chave: { lt: BigInt(query.cursor) } } : {}),
    };

    // ADR-V2-047 — Fase 4: filtros hierárquicos.
    // `idClasse` (polimórfico) — string negativa → BigInt.
    if (query.idClasse) {
      where.idClasse = BigInt(query.idClasse);
    }

    // `idPai` — aceita string numérica OU literal "null" (raiz).
    // Quando combinado com `depth >= 2`, expande via CTE recursiva
    // (1 query extra para descobrir os chaves descendentes; nunca em loop).
    if (query.idPai !== undefined) {
      if (query.idPai === 'null') {
        where.idPai = null;
      } else {
        const rootId = BigInt(query.idPai);
        // depth=0 → apenas a própria raiz
        // depth=1 (default quando idPai presente) → filhas diretas
        // depth>=2 → descendentes recursivos limitados por `depth`
        const depth = query.depth ?? 1;

        if (depth === 0) {
          // Combinar com cursor (chave: { lt: cursor }) se já presente.
          if (where.chave && typeof where.chave === 'object') {
            where.chave = { ...(where.chave as Prisma.BigIntFilter), equals: rootId };
          } else {
            where.chave = rootId;
          }
        } else if (depth === 1) {
          where.idPai = rootId;
        } else {
          // CTE recursiva PostgreSQL — descobre todos os descendentes até
          // `depth` níveis e usa o resultado em `chave IN (...)`. Guardrail
          // hardcoded 20 também na CTE (defense-in-depth com MAX_PHASE_DEPTH).
          const cappedDepth = Math.min(depth, 20);
          const descendants = await this.prisma.$queryRaw<Array<{ chave: bigint }>>`
            WITH RECURSIVE descendants AS (
              SELECT chave, 0 AS depth
              FROM "DTask"
              WHERE "idPai" = ${rootId} AND excluido = false

              UNION ALL

              SELECT t.chave, d.depth + 1
              FROM "DTask" t
              INNER JOIN descendants d ON t."idPai" = d.chave
              WHERE t.excluido = false AND d.depth < ${cappedDepth - 1} AND d.depth < 20
            )
            SELECT chave FROM descendants
          `;

          if (descendants.length === 0) {
            return { items: [], pagination: { hasMore: false, nextCursor: null } };
          }

          const descendantIds = descendants.map((d) => d.chave);
          // Combinar com cursor (chave: { lt: cursor }) se já presente.
          if (where.chave && typeof where.chave === 'object') {
            where.chave = {
              ...(where.chave as Prisma.BigIntFilter),
              in: descendantIds,
            };
          } else {
            where.chave = { in: descendantIds };
          }
        }
      }
    }

    // Opção A — filtro por dados.idBloco (JSON path, sem romper raiz idPai=null).
    if (query.idBloco) {
      where.dados = { path: ['idBloco'], equals: query.idBloco };
    }

    // Filtro por time (dados.assigneeTeamId). Mutuamente exclusivo com idBloco
    // quando passados simultaneamente (assigneeTeamId tem precedência — último set).
    // Para combinar os dois filtros, refatorar para AND explícito em PR separado.
    if (query.assigneeTeamId) {
      where.dados = { path: ['assigneeTeamId'], equals: query.assigneeTeamId };
    }

    // Filtro por status: buscar idStatus das DTabelas correspondentes
    const statuses = query.statuses?.length ? query.statuses : query.status ? [query.status] : [];
    if (statuses.length > 0) {
      const statusClasses = statuses
        .map((status) => STATUS_TO_TABELA_CLASSE[status])
        .filter((statusClass): statusClass is bigint => statusClass !== undefined);
      if (statusClasses.length > 0) {
        // Buscar todas as DTabelas deste status (podem ser de múltiplos projetos).
        // ADR-V2-058/059: filtro por projeto usa a DEntidade-espelho (E);
        // resolver P→E (legacy-safe) antes de filtrar dEntidadeId.
        const statusScope = query.projectId
          ? await this.projectRef.resolveEntidadeRef(BigInt(query.projectId))
          : null;
        const statusTabelas = await this.prisma.dTabela.findMany({
          where: {
            idClasse: { in: statusClasses },
            excluido: false,
            ...(statusScope !== null ? { dEntidadeId: statusScope } : {}),
          },
          select: { chave: true },
        });
        const statusIds = statusTabelas.map((s) => s.chave);
        where.idStatus = statusIds.length > 0 ? { in: statusIds } : undefined;
      }
    }

    // D1 — Filtros por dueDate (TimezoneService garante timezone America/Sao_Paulo).
    // Precedência: dueDateToday > dueDateFrom/dueDateTo.
    if (query.dueDateToday) {
      const today = this.timezoneService.getPeriodDates('today');
      where.dueDate = { gte: today.gte, lte: today.lte };
    } else if (query.dueDateFrom || query.dueDateTo) {
      // Usa TimezoneService para garantir corte correto em America/Sao_Paulo.
      // applyDateFilters aceita strings YYYY-MM-DD; quando só um lado está
      // presente, usamos o mesmo valor no extremo ausente para montar o range
      // completo e depois extraímos apenas o lado relevante.
      const from = query.dueDateFrom ?? query.dueDateTo!;
      const to = query.dueDateTo ?? query.dueDateFrom!;
      const range = this.timezoneService.applyDateFilters(from, to);
      const dueDateResult: { gte?: Date; lte?: Date } = {};
      if (query.dueDateFrom) {
        dueDateResult.gte = range.gte;
      }
      if (query.dueDateTo) {
        dueDateResult.lte = range.lte;
      }
      where.dueDate = dueDateResult;
    }

    const tasks = await this.prisma.dTask.findMany({
      where,
      select: {
        chave: true,
        idClasse: true,
        idProject: true,
        idPai: true,
        nome: true,
        descricao: true,
        idStatus: true,
        idPriority: true,
        idAssignee: true,
        dueDate: true,
        dados: true,
        excluido: true,
        criadoEm: true,
        atualizadoEm: true,
      },
      take: take + 1,
      orderBy: { chave: 'desc' },
    });

    const hasMore = tasks.length > take;
    const pageTasks = hasMore ? tasks.slice(0, take) : tasks;

    // Batch lookup do mapa de priority (ZERO N+1 — 1 query para todo o lote)
    const priorityMap = await this.buildPriorityMap(pageTasks.map((t) => t.idPriority));
    // Batch lookup de execuções ativas (1 query para todo o lote — ZERO N+1).
    // Filtra DPedido idClasse=-300..-304 com baixado=false cujo dados.taskId
    // pertence ao lote. Quando ausente, frontend trata task como editável.
    const executionsMap = await this.findActiveExecutionsForTasks(pageTasks.map((t) => t.chave));
    // ADR-V2-057: timer agregado por usuário — 1 query batch de nomes (ZERO N+1).
    const timerMap = await this.taskTimerService.buildTimerStateMap(pageTasks);
    const items = pageTasks.map((t) => this.buildResponse(t, priorityMap, executionsMap, timerMap));
    const nextCursor = hasMore ? pageTasks[pageTasks.length - 1].chave.toString() : null;

    return { items, pagination: { hasMore, nextCursor } };
  }

  /**
   * Confirma que `projectId` é um TEMPLATE GLOBAL — único caso em que a leitura
   * de tasks bypassa o tenant guard (ADR-V2-042) por design.
   *
   * Um template global é um `DProject` com `idClasse ∈ {-401, -402}`
   * (TEMPLATE_LIST / TEMPLATE_SPACE, fonte única em `template-classes.const`)
   * E `idEstab = NULL`. Espelha exatamente a regra que `ProjectsService.listTemplates`
   * já aplica para a LISTAGEM de projetos (ADR-V2-061), estendendo o mesmo
   * princípio de "catálogo público read-only" ao agregado DTask.
   *
   * Segurança: templates ORG-SCOPED (idEstab ≠ NULL) e projetos comuns
   * (idClasse ∉ {-401,-402}) retornam `false` → continuam negados pelo guard
   * normal (vazio em `findMany`, 404 em `findOne`). Sem vazamento de tenant.
   *
   * Performance: 1 query por chamada, por PK (`chave`), com `select` mínimo.
   * Chamada SOMENTE quando o guard normal já ia negar (curto-circuito) — custo
   * zero no fluxo autorizado padrão. ZERO N+1 (nunca em loop).
   *
   * @param projectId - Chave BigInt do projeto candidato a template global
   * @returns `true` se for template global (-401/-402 + idEstab=NULL); senão `false`
   *
   * @example
   * ```typescript
   * if (await this.isGlobalTemplate(BigInt('-401'))) {
   *   // libera leitura de tasks do template global
   * }
   * ```
   */
  private async isGlobalTemplate(projectId: bigint): Promise<boolean> {
    const p = await this.prisma.dProject.findFirst({
      where: {
        chave: projectId,
        idEstab: null,
        idClasse: { in: TEMPLATE_CLASSES }, // [-401, -402] da fonte única
        excluido: false,
      },
      select: { chave: true },
    });
    return p !== null;
  }

  /**
   * Busca task por ID, opcionalmente validando que pertence a um projeto
   * no escopo autorizado do caller (ADR-V2-042).
   *
   * @param id - Chave BigInt da task (string)
   * @param accessibleProjectIds - Quando informado, valida que
   *   `DTask.idProject` esta no scope. Caso contrario, 404 (anti enumeration).
   * @returns TaskResponseDto
   *
   * @throws {NotFoundException} Se task não encontrada ou fora do scope
   *
   * @example
   * ```typescript
   * const task = await service.findOne('7', allowedIds);
   * ```
   */
  async findOne(id: string, accessibleProjectIds?: string[]): Promise<TaskResponseDto> {
    const task = await this.prisma.dTask.findFirst({
      where: { chave: BigInt(id), excluido: false },
    });

    if (!task) {
      throw new NotFoundException(`Task ${id} não encontrada`);
    }

    // ADR-V2-042: tenant check via projectId. Mensagem identica → anti enumeration.
    //
    // ADR-V2-061 (extensão ao agregado DTask): task de um TEMPLATE GLOBAL
    // (-401/-402, idEstab=NULL) é legível por qualquer org (catálogo público
    // read-only). Só nesse caso o gate libera — a query `isGlobalTemplate` só
    // roda quando o guard normal já ia lançar 404 (custo zero no fluxo normal).
    // Os endpoints `:id/tree` e `:id/metrics` herdam essa correção (usam
    // `findOne` como tenant gate).
    if (accessibleProjectIds !== undefined) {
      const projectIdStr = task.idProject?.toString() ?? null;
      if (!projectIdStr || !accessibleProjectIds.includes(projectIdStr)) {
        if (!task.idProject || !(await this.isGlobalTemplate(task.idProject))) {
          this.logger.warn(
            `tenant_mismatch_task_findOne taskId=${id} projectId=${projectIdStr ?? 'null'} fora do scope`,
          );
          throw new NotFoundException(`Task ${id} não encontrada`);
        }
      }
    }

    const priorityMap = await this.buildPriorityMap([task.idPriority]);
    // Lookup de execução ativa para esta task (1 query — N+1 inexistente).
    // Quando presente, sinaliza que a UI deve travar a task (read-only).
    const executionsMap = await this.findActiveExecutionsForTasks([task.chave]);
    // ADR-V2-057: timer agregado (1 query batch de nomes — ZERO N+1).
    const timerMap = await this.taskTimerService.buildTimerStateMap([task]);
    return this.buildResponse(task, priorityMap, executionsMap, timerMap);
  }

  /**
   * Atualiza campos de task (nome, descrição, priority, assignee).
   *
   * NÃO altera status (usar updateStatus).
   *
   * @param id - Chave BigInt da task (string)
   * @param dto - Campos a atualizar
   * @returns TaskResponseDto atualizada
   *
   * @throws {NotFoundException} Se task não encontrada
   *
   * @example
   * ```typescript
   * const task = await service.update('7', { nome: 'Novo título' });
   * ```
   */
  async update(
    id: string,
    dto: UpdateTaskDto,
    accessibleProjectIds?: string[],
    actorId?: bigint,
  ): Promise<TaskResponseDto> {
    const taskId = BigInt(id);

    const existing = await this.prisma.dTask.findFirst({
      where: { chave: taskId, excluido: false },
      select: { chave: true, dados: true, idProject: true },
    });

    if (!existing) {
      throw new NotFoundException(`Task ${id} não encontrada`);
    }

    // ADR-V2-042: tenant check via projectId
    if (accessibleProjectIds !== undefined) {
      const pid = existing.idProject?.toString() ?? null;
      if (!pid || !accessibleProjectIds.includes(pid)) {
        throw new NotFoundException(`Task ${id} não encontrada`);
      }
    }

    // Merge superficial em `dados` quando taskType, assignedToAi ou dados mudar.
    // Preserva identifier, v3, telemetry, capture, automation intactos.
    // `dados.fields` e interceptado para merge por chave e validacao por tipo.
    const dadosAtuais = (existing.dados as Record<string, unknown> | null) ?? {};
    let dtoDadosSemFields: Record<string, unknown | null> | undefined;
    let mergedCustomFields: Record<string, unknown> | undefined;

    if (dto.dados !== undefined) {
      if (!isRecord(dto.dados)) {
        throw new BadRequestException('dados deve ser um objeto JSON');
      }

      dtoDadosSemFields = { ...dto.dados };

      if (hasOwnKey(dto.dados, 'fields')) {
        const incomingFields = dto.dados.fields;
        delete dtoDadosSemFields.fields;

        if (!isRecord(incomingFields)) {
          throw new BadRequestException('dados.fields deve ser um objeto JSON');
        }

        mergedCustomFields = await this.mergeCustomFieldValues(
          existing.idProject,
          dadosAtuais,
          incomingFields,
        );
      }
    }

    const isAiAssignee = dto.assigneeId === 'ai';
    const hasDadosMerge =
      dto.taskType !== undefined ||
      dto.assigneeId !== undefined ||
      dto.assigneeTeamId !== undefined ||
      dto.dados !== undefined;
    const novosDados = hasDadosMerge
      ? {
          ...dadosAtuais,
          ...(dto.taskType !== undefined ? { taskType: dto.taskType } : {}),
          ...(dto.assigneeId !== undefined ? { assignedToAi: isAiAssignee } : {}),
          ...(dto.assigneeTeamId !== undefined ? { assigneeTeamId: dto.assigneeTeamId } : {}),
          // Opção A — merge de chaves extras (ex: idBloco). null remove a chave.
          ...(dtoDadosSemFields !== undefined ? dtoDadosSemFields : {}),
          ...(mergedCustomFields !== undefined ? { fields: mergedCustomFields } : {}),
        }
      : undefined;

    // Resolver idPriority (semântica undefined/null/string):
    //   undefined → não tocar
    //   null      → limpar (idPriority = null)
    //   string    → lookup DTabela do projeto
    let idPriorityUpdate: bigint | null | undefined = undefined;
    if (dto.priority !== undefined) {
      if (dto.priority === null) {
        idPriorityUpdate = null;
      } else if (existing.idProject) {
        idPriorityUpdate = await this.resolvePriorityId(
          this.prisma,
          existing.idProject,
          dto.priority,
        );
      } else {
        this.logger.warn(
          `update: task ${taskId} sem idProject; ignorando priority="${dto.priority}"`,
        );
      }
    }

    // Mover na hierarquia de fases (ADR-V2-047) — semantica:
    //   undefined → nao tocar
    //   null      → mover para raiz (idPai=null)
    //   string    → setar novo pai; valida ciclo + project-consistency
    let idPaiUpdate: bigint | null | undefined = undefined;
    if (dto.idPai !== undefined) {
      if (dto.idPai === null) {
        idPaiUpdate = null;
      } else {
        idPaiUpdate = BigInt(dto.idPai);
        await this.phaseHierarchy.validateNoCycle(taskId, idPaiUpdate);
        await this.phaseHierarchy.validateProjectConsistency(taskId, idPaiUpdate);
      }
    }

    // D1 — semântica ternária para dueDate:
    //   undefined → não tocar o campo
    //   null      → remover a data (dueDate = null)
    //   string    → nova data (parseada para Date)
    let dueDateUpdate: Date | null | undefined = undefined;
    if (dto.dueDate !== undefined) {
      dueDateUpdate = dto.dueDate ? new Date(dto.dueDate) : null;
    }

    const updated = await this.prisma.dTask.update({
      where: { chave: taskId },
      data: {
        ...(dto.nome !== undefined ? { nome: dto.nome } : {}),
        ...(dto.descricao !== undefined ? { descricao: dto.descricao } : {}),
        ...(dto.assigneeId !== undefined
          ? { idAssignee: dto.assigneeId && !isAiAssignee ? BigInt(dto.assigneeId) : null }
          : {}),
        ...(idPriorityUpdate !== undefined ? { idPriority: idPriorityUpdate } : {}),
        ...(idPaiUpdate !== undefined ? { idPai: idPaiUpdate } : {}),
        ...(novosDados !== undefined ? { dados: novosDados as Prisma.InputJsonValue } : {}),
        ...(dueDateUpdate !== undefined ? { dueDate: dueDateUpdate } : {}),
      },
    });

    // ADR-V2-047 Fase 8: phase.updated. Emite quando a task é uma fase
    // (idClasse=-200). Pós-commit (Pilar 7).
    if (updated.idClasse === ID_CLASSE_PHASE) {
      await this.eventProducer.addInternalEvent(
        'phase.updated',
        {
          phaseId: updated.chave.toString(),
          nome: updated.nome,
          projectId: updated.idProject?.toString() ?? null,
          idPai: updated.idPai?.toString() ?? null,
        },
        this.correlationIdService.getOrGenerate(),
        { source: TasksService.name },
      );
    } else {
      // task.updated (Realtime Fase 0): task normal carrega projectId (= sala
      // list:{listId}) e actorId (quem causou) para o barramento. Audit em
      // -489 AUDIT_GENERIC (audit-log.consumer). Pós-commit (Pilar 7).
      await this.eventProducer.addInternalEvent(
        'task.updated',
        {
          taskId: updated.chave.toString(),
          projectId: updated.idProject?.toString() ?? null,
          idClasse: updated.idClasse.toString(),
          actorId: actorId?.toString() ?? null,
        },
        this.correlationIdService.getOrGenerate(),
        { source: TasksService.name },
      );
    }

    // Feed de atividades do time — emitido quando assigneeTeamId é definido no update.
    // Usa entidadeId=teamId → audit-log.consumer persiste DEvento.idEntidade=teamId.
    // Pilar 7: APÓS persistência.
    if (dto.assigneeTeamId) {
      // Hidratar nome do ator (quem está atribuindo) quando o controller passa o JWT.
      let actorName: string | null = null;
      if (actorId) {
        const actor = await this.prisma.dEntidade.findFirst({
          where: { chave: actorId, excluido: false },
          select: { nome: true },
        });
        actorName = actor?.nome ?? null;
      }

      await this.eventProducer.addInternalEvent(
        'task.assigned',
        {
          entidadeId: dto.assigneeTeamId,
          taskId: taskId.toString(),
          taskNome: updated.nome,
          userId: actorId?.toString() ?? null,
          userName: actorName,
          feedAction: 'TASK_ASSIGNED',
          feedTeamId: dto.assigneeTeamId,
        },
        this.correlationIdService.getOrGenerate(),
        { source: TasksService.name },
      );
    }

    const priorityMap = await this.buildPriorityMap([updated.idPriority]);
    return this.buildResponse(updated, priorityMap);
  }

  /**
   * Move task entre estados V3 (state machine valida a transição).
   *
   * Popula telemetria automaticamente:
   * - READY: seta telemetry.readyAt
   * - EXECUTING: seta telemetry.executingAt + abre workSession
   * - DONE: seta telemetry.doneAt + calcula cycleTime + leadTime + fecha workSession
   *
   * Audit DEvento -498 emitido APÓS commit.
   *
   * @param id - Chave BigInt da task (string)
   * @param dto - Novo status + movedBy
   * @returns TaskResponseDto com novo estado
   *
   * @throws {NotFoundException} Se task não encontrada
   * @throws {BadRequestException} Se transição inválida pelo state machine
   *
   * @example
   * ```typescript
   * const task = await service.updateStatus('7', { status: 'READY' });
   * ```
   */
  async updateStatus(
    id: string,
    dto: UpdateTaskStatusDto,
    actorId?: bigint,
    accessibleProjectIds?: string[],
  ): Promise<TaskResponseDto> {
    const taskId = BigInt(id);

    if (!isValidState(dto.status)) {
      throw new BadRequestException(`Estado inválido: ${dto.status}`);
    }

    const task = await this.prisma.dTask.findFirst({
      where: { chave: taskId, excluido: false },
    });

    if (!task) {
      throw new NotFoundException(`Task ${id} não encontrada`);
    }

    // ADR-V2-042: tenant check via projectId
    if (accessibleProjectIds !== undefined) {
      const pid = task.idProject?.toString() ?? null;
      if (!pid || !accessibleProjectIds.includes(pid)) {
        throw new NotFoundException(`Task ${id} não encontrada`);
      }
    }

    // ADR-V2-048: Fases (idClasse=-200) NÃO têm status próprio — o status é
    // derivado da agregação de tasks-folha descendentes (percent via
    // PhaseMetricsService.compute, F5 do ADR-V2-047). Bloqueamos a tentativa
    // de mover uma fase no board V3 antes de qualquer mutação para evitar:
    //   1. Inconsistência semântica entre `dados.v3.state` e `percent`;
    //   2. Emissão indevida de `phase.completed` sem agregação;
    //   3. Confusão do frontend recursivo que renderiza Fase + Task polimorficamente.
    if (task.idClasse === ID_CLASSE_PHASE) {
      throw new BadRequestException(
        'Fase não tem status próprio — use GET /tasks/:id/metrics para consultar percent agregado.',
      );
    }

    // Ler estado atual dos dados
    const dadosAtuais = (task.dados as Record<string, unknown>) ?? {};
    const v3Atual = dadosAtuais.v3 as { state?: string } | null;
    const fromStatus = (v3Atual?.state ?? 'INBOX') as TaskStatus;
    const toStatus = dto.status as TaskStatus;

    // Validar transição
    validateTransition(fromStatus, toStatus);

    const now = new Date();
    const nowIso = now.toISOString();

    // Atualizar telemetria
    const telemetriaAtual = (dadosAtuais.telemetry as Record<string, unknown>) ?? {};
    const workSessions = (telemetriaAtual.workSessions as Array<Record<string, unknown>>) ?? [];

    const novasTelemetria: Record<string, unknown> = { ...telemetriaAtual };

    switch (toStatus) {
      case 'READY':
        novasTelemetria.readyAt = nowIso;
        break;

      case 'EXECUTING': {
        novasTelemetria.executingAt = nowIso;
        // Abrir nova workSession
        workSessions.push({ startedAt: nowIso, agentId: dto.movedBy ?? null });
        novasTelemetria.workSessions = workSessions;
        break;
      }

      case 'DONE': {
        novasTelemetria.doneAt = nowIso;
        // Fechar workSession aberta
        const openSession = [...workSessions].reverse().find((s) => !s.endedAt);
        if (openSession) {
          openSession.endedAt = nowIso;
          novasTelemetria.workSessions = workSessions;
        }
        // Calcular cycleTime (READY → DONE) e leadTime (INBOX → DONE)
        if (telemetriaAtual.readyAt) {
          novasTelemetria.cycleTime =
            now.getTime() - new Date(telemetriaAtual.readyAt as string).getTime();
        }
        const taskCreatedAt = task.criadoEm;
        novasTelemetria.leadTime = now.getTime() - taskCreatedAt.getTime();
        break;
      }

      default:
        break;
    }

    // Buscar idStatus da DTabela correspondente (no projeto da task).
    // ADR-V2-058/059: statuses gravados com a DEntidade-espelho (E);
    // resolver P→E (legacy-safe) antes de filtrar dEntidadeId.
    let newIdStatus = task.idStatus;
    if (task.idProject) {
      const statusScope = await this.projectRef.resolveEntidadeRef(task.idProject);
      const statusTabela = await this.prisma.dTabela.findFirst({
        where: {
          idClasse: STATUS_TO_TABELA_CLASSE[toStatus],
          dEntidadeId: statusScope,
          excluido: false,
        },
        select: { chave: true },
      });
      if (statusTabela) {
        newIdStatus = statusTabela.chave;
      }
    }

    const novosDados = {
      ...dadosAtuais,
      v3: {
        state: toStatus,
        movedAt: nowIso,
        movedBy: dto.movedBy ?? null,
      },
      telemetry: novasTelemetria,
    };

    const updated = await this.prisma.dTask.update({
      where: { chave: taskId },
      data: {
        idStatus: newIdStatus,
        dados: novosDados as Prisma.InputJsonValue,
      },
    });

    // Cascatear status para todas as subtarefas descendentes (recursivo via BFS).
    // Não lança erro se a cascata falhar — a task mãe já foi atualizada.
    void this.cascadeStatusToDescendants(taskId, toStatus, newIdStatus, nowIso).catch((err) => {
      this.logger.warn(
        `cascade status falhou para taskId=${taskId.toString()}: ${err instanceof Error ? err.message : String(err)}`,
      );
    });

    // Hidratar nome do ator quando o controller passa o JWT (actorId).
    let actorName: string | null = null;
    if (actorId) {
      const actor = await this.prisma.dEntidade.findFirst({
        where: { chave: actorId, excluido: false },
        select: { nome: true },
      });
      actorName = actor?.nome ?? null;
    }

    // Audit APÓS commit — tipo task.status.changed → idClasse=-498 TASK_STATUS_CHANGED
    await this.eventProducer.addInternalEvent(
      'task.status.changed',
      {
        taskId: taskId.toString(),
        projectId: task.idProject?.toString() ?? null,
        from: fromStatus,
        to: toStatus,
        ...(actorId && { userId: actorId.toString() }),
        ...(actorName && { userName: actorName }),
        ...(dto.movedBy && { movedBy: dto.movedBy }),
        nome: task.nome,
        identifier: (task.dados as Record<string, unknown> | null)?.identifier ?? null,
      },
      this.correlationIdService.getOrGenerate(),
      { source: TasksService.name },
    );

    // Feed de atividades do time — emitido quando a task tem assigneeTeamId.
    // Usa entidadeId=teamId → audit-log.consumer persiste DEvento.idEntidade=teamId.
    // feedAction, feedStatusAnterior, feedStatusNovo ficam no nível raiz (evitam conflito com _meta).
    // Pilar 7: APÓS persistência.
    const teamIdForFeed = (task.dados as Record<string, unknown> | null)?.assigneeTeamId as
      | string
      | undefined;
    if (teamIdForFeed) {
      const isCompleted = toStatus === 'DONE' || toStatus === 'VALIDATED';
      await this.eventProducer.addInternalEvent(
        'task.status.changed',
        {
          entidadeId: teamIdForFeed,
          taskId: taskId.toString(),
          taskNome: task.nome,
          ...(actorId && { userId: actorId.toString() }),
          ...(actorName && { userName: actorName }),
          feedAction: isCompleted ? 'TASK_COMPLETED' : 'TASK_STATUS_CHANGED',
          feedTeamId: teamIdForFeed,
          feedStatusAnterior: fromStatus,
          feedStatusNovo: toStatus,
        },
        this.correlationIdService.getOrGenerate(),
        { source: TasksService.name },
      );
    }

    // ADR-V2-047 Fase 8: detector de phase.completed.
    // Disparado quando uma TASK FOLHA (não PHASE) muda para DONE e o pai
    // direto cruza 100% de conclusão. Idempotência via snapshot em
    // dados._meta.phaseSnapshotPercent. Falha NÃO propaga (try/catch isolado).
    if (toStatus === 'DONE' && task.idClasse !== ID_CLASSE_PHASE && task.idPai !== null) {
      void this.detectPhaseCompletion(task.idPai, task.idProject).catch((err) => {
        this.logger.warn(
          `phase.completed detector falhou para parent=${task.idPai?.toString()} ` +
            `taskId=${taskId.toString()}: ${err instanceof Error ? err.message : String(err)}`,
        );
      });
    }

    const priorityMap = await this.buildPriorityMap([updated.idPriority]);
    return this.buildResponse(updated, priorityMap);
  }

  /**
   * Cascateia o status para todos os descendentes de uma task (BFS).
   * Atualiza apenas tasks-folha (idClasse != PHASE). Sem state machine —
   * é uma operação de sincronia visual, não de workflow individual.
   */
  private async cascadeStatusToDescendants(
    parentId: bigint,
    toStatus: string,
    newIdStatus: bigint | null,
    nowIso: string,
  ): Promise<void> {
    const queue: bigint[] = [parentId];

    while (queue.length > 0) {
      const currentIds = queue.splice(0, queue.length);

      const children = await this.prisma.dTask.findMany({
        where: { idPai: { in: currentIds }, excluido: false },
        select: { chave: true, idClasse: true, dados: true },
      });

      if (children.length === 0) break;

      const leafIds = children.filter((c) => c.idClasse !== ID_CLASSE_PHASE).map((c) => c.chave);

      if (leafIds.length > 0) {
        // Atualiza dados.v3.state para cada filho preservando o restante do json
        for (const child of children.filter((c) => c.idClasse !== ID_CLASSE_PHASE)) {
          const dadosAtual = (child.dados as Record<string, unknown>) ?? {};
          const novosDados = {
            ...dadosAtual,
            v3: {
              ...((dadosAtual.v3 as object | null) ?? {}),
              state: toStatus,
              movedAt: nowIso,
              movedBy: 'cascade',
            },
          };
          await this.prisma.dTask.update({
            where: { chave: child.chave },
            data: {
              dados: novosDados as Prisma.InputJsonValue,
              ...(newIdStatus && { idStatus: newIdStatus }),
            },
          });
        }
      }

      // Continua BFS com filhos de qualquer tipo
      queue.push(...children.map((c) => c.chave));
    }
  }

  /**
   * Soft-delete de task. Cascade por padrao para TODA task (ADR-V2-047 Q6).
   *
   * Comportamento de `cascade`:
   * - `undefined` (default): **cascade = true sempre** — a raiz e todos os
   *   descendentes (filhas, netos, ...) sao marcados `excluido=true` via
   *   `PhaseHierarchyService.softDeleteCascade` (CTE recursiva, 1 statement).
   *   Fecha na origem o bug de "orfas vivas" (filha viva apontando para mae
   *   deletada). Cobre tanto TASK normal (-154) quanto PHASE (-200).
   * - `true`: cascade explicito (mesmo efeito do default).
   * - `false`: desvincular — soft-delete somente da raiz; descendentes ficam
   *   com `idPai` apontando para a task deletada. Caso raro/escape; use apenas
   *   quando intencionalmente quiser preservar as filhas.
   *
   * Auditoria (DEvento):
   * - PHASE (-200) emite `phase.deleted` (DEvento -498, inalterado).
   * - TASK normal (-154) emite `task.deleted` (DEvento -498) em AMBOS os ramos
   *   (cascade e desvincular), apos a persistencia.
   *
   * @param id - Chave BigInt da task (string)
   * @param accessibleProjectIds - Scope tenant (ADR-V2-042)
   * @param options - Opcoes (cascade)
   * @returns objeto com contagem de afetados (raiz + descendentes em cascade)
   *
   * @throws {NotFoundException} Se task não encontrada
   *
   * @example
   * ```typescript
   * // Default: cascateia a raiz + descendentes (TASK ou PHASE)
   * await service.delete('7');
   *
   * // Desvincular (escape): apaga so a raiz, mantem as filhas
   * await service.delete('7', undefined, { cascade: false });
   * ```
   */
  async delete(
    id: string,
    accessibleProjectIds?: string[],
    options?: { cascade?: boolean },
    actorId?: bigint,
  ): Promise<{ affected: number }> {
    const taskId = BigInt(id);

    const existing = await this.prisma.dTask.findFirst({
      where: { chave: taskId, excluido: false },
      select: { chave: true, idProject: true, idClasse: true },
    });

    if (!existing) {
      throw new NotFoundException(`Task ${id} não encontrada`);
    }

    // ADR-V2-042: tenant check via projectId
    if (accessibleProjectIds !== undefined) {
      const pid = existing.idProject?.toString() ?? null;
      if (!pid || !accessibleProjectIds.includes(pid)) {
        throw new NotFoundException(`Task ${id} não encontrada`);
      }
    }

    // Decisao de cascade:
    //   options.cascade definido → respeitar valor explicito
    //   omitido → default = true SEMPRE (fecha o bug de orfas vivas; cobre
    //             TASK e PHASE). `?cascade=false` e o escape para desvincular.
    //   (CEO 2026-05-30 / ADR-V2-047 Q6 — default cascade ratificado.)
    // `isPhase` permanece apenas para decidir QUAL evento de audit emitir.
    const isPhase = existing.idClasse === ID_CLASSE_PHASE;
    const cascade = options?.cascade !== undefined ? options.cascade : true;
    const projectId = existing.idProject?.toString() ?? null;

    if (cascade) {
      const result = await this.phaseHierarchy.softDeleteCascade(taskId);
      this.logger.log(
        `Task ${taskId} deletada com cascade (isPhase=${isPhase}); afetados=${result.affected}`,
      );

      // Audit (ADR-V2-008 / ADR-V2-047 Q6) — emitir APOS a persistencia.
      // PHASE → phase.deleted (inalterado). TASK normal → task.deleted.
      if (isPhase) {
        await this.eventProducer.addInternalEvent(
          'phase.deleted',
          {
            phaseId: taskId.toString(),
            projectId,
            actorId: actorId?.toString() ?? null,
            cascade: true,
            affected: result.affected,
          },
          this.correlationIdService.getOrGenerate(),
          { source: TasksService.name },
        );
      } else {
        await this.eventProducer.addInternalEvent(
          'task.deleted',
          {
            taskId: taskId.toString(),
            projectId,
            actorId: actorId?.toString() ?? null,
            cascade: true,
            affected: result.affected,
          },
          this.correlationIdService.getOrGenerate(),
          { source: TasksService.name },
        );
      }

      return result;
    }

    await this.prisma.dTask.update({
      where: { chave: taskId },
      data: { excluido: true },
    });

    this.logger.log(`Task ${taskId} deletada (soft delete sem cascade — desvincular)`);

    // Audit sem cascade (desvincular) — descendentes permanecem.
    // PHASE → phase.deleted. TASK normal → task.deleted. cascade=false.
    if (isPhase) {
      await this.eventProducer.addInternalEvent(
        'phase.deleted',
        {
          phaseId: taskId.toString(),
          projectId,
          actorId: actorId?.toString() ?? null,
          cascade: false,
          affected: 1,
        },
        this.correlationIdService.getOrGenerate(),
        { source: TasksService.name },
      );
    } else {
      await this.eventProducer.addInternalEvent(
        'task.deleted',
        {
          taskId: taskId.toString(),
          projectId,
          actorId: actorId?.toString() ?? null,
          cascade: false,
          affected: 1,
        },
        this.correlationIdService.getOrGenerate(),
        { source: TasksService.name },
      );
    }

    return { affected: 1 };
  }

  // ─── Helpers privados ─────────────────────────────────────────────────────

  /**
   * Detector de transição "fase concluída" (ADR-V2-047 — Fase 8).
   *
   * Disparado pelo `updateStatus` quando uma task FOLHA (não PHASE) muda para
   * DONE e tem pai direto. Calcula o `percent` da fase pai (recursivo) e, se
   * cruzou para 100% (não estava em 100% antes), emite `phase.completed`.
   *
   * **Cobertura v1 (limitação conhecida):** apenas o PAI DIRETO da task que
   * mudou. Cadeia ancestral completa (avô, bisavô) não é coberta. Em uma
   * cascata de fases aninhadas, somente o pai mais próximo é avaliado.
   * Cobertura ancestral completa fica para iteração futura.
   *
   * **Idempotência:** o último `percent` calculado para a fase é gravado em
   * `DTask.dados._meta.phaseSnapshotPercent`. Antes de emitir, comparamos o
   * snapshot anterior: se já era 100, NÃO re-emite (evita ruído em
   * transições DONE→READY→DONE). Deep-merge preserva outros campos de `dados`.
   *
   * **Resiliência:** caller invoca via `void this.detectPhaseCompletion(...)
   *   .catch(...)`. Falha aqui NÃO bloqueia o `updateStatus` da task original
   *   (Pilar 7 — eventos pós-persistência; consistência eventual aceitável).
   *
   * **N+1 budget:** ~4 queries no total — (1) findFirst do pai, (2) PhaseMetricsService.compute
   * (que faz sua própria CTE recursiva — ~2 queries internas: pré-query de idProject +
   * CTE), (3) update opcional do snapshot. Performance controlada, sem N+1.
   *
   * @param phaseId - chave do pai direto da task que mudou (`task.idPai`)
   * @param projectId - `task.idProject` da task filha (para payload do evento)
   */
  private async detectPhaseCompletion(phaseId: bigint, projectId: bigint | null): Promise<void> {
    // 1. Buscar snapshot anterior + idClasse do pai (1 query — sem N+1)
    const parent = await this.prisma.dTask.findFirst({
      where: { chave: phaseId, excluido: false },
      select: { chave: true, idClasse: true, dados: true, idProject: true },
    });

    if (!parent) {
      this.logger.debug(`detectPhaseCompletion: pai ${phaseId} não encontrado (soft-deleted?).`);
      return;
    }

    // Cobertura v1: só detecta se o pai direto for uma fase.
    // Se não for, nada a fazer (cadeia ancestral fica fora do escopo).
    if (parent.idClasse !== ID_CLASSE_PHASE) {
      return;
    }

    // 2. Snapshot anterior (idempotência)
    const dadosAtuais = (parent.dados as Record<string, unknown> | null) ?? {};
    const metaAtual = (dadosAtuais._meta as Record<string, unknown> | undefined) ?? {};
    const lastSnapshot = (metaAtual.phaseSnapshotPercent as number | undefined) ?? null;

    if (lastSnapshot === 100) {
      // Já estava em 100 — não re-emite (evita ruído em DONE→READY→DONE).
      this.logger.debug(
        `detectPhaseCompletion: fase ${phaseId} já estava em 100% (snapshot=${lastSnapshot}). Skip.`,
      );
      return;
    }

    // 3. Calcular percent atual via PhaseMetricsService
    const metrics = await this.phaseMetrics.compute(phaseId, { recursive: true });
    const currentPercent = metrics.percent;

    // 4. Atualizar snapshot opportunisticamente (1 query — só quando vale a pena)
    if (currentPercent !== lastSnapshot) {
      const novosDados = {
        ...dadosAtuais,
        _meta: {
          ...metaAtual,
          phaseSnapshotPercent: currentPercent,
          phaseSnapshotAt: new Date().toISOString(),
        },
      };
      await this.prisma.dTask.update({
        where: { chave: phaseId },
        data: { dados: novosDados as Prisma.InputJsonValue },
      });
    }

    // 5. Emitir phase.completed se cruzou para 100% agora
    if (currentPercent === 100) {
      await this.eventProducer.addInternalEvent(
        'phase.completed',
        {
          phaseId: phaseId.toString(),
          projectId: (parent.idProject ?? projectId)?.toString() ?? null,
          percent: 100,
          completedAt: new Date().toISOString(),
          total: metrics.total,
          done: metrics.done,
        },
        this.correlationIdService.getOrGenerate(),
        { source: TasksService.name },
      );

      this.logger.log(
        `phase.completed emitido para fase=${phaseId.toString()} ` +
          `(total=${metrics.total}, done=${metrics.done})`,
      );
    }
  }

  /**
   * Resolve enum de priority (HIGH/MEDIUM/LOW/URGENT) → chave BigInt
   * da DTabela escopada pelo projeto.
   *
   * Padrão paralelo ao Status (DTabela -441..-449 escopada por projectId).
   * As 4 DTabelas PRIORITY são criadas no bootstrap do projeto
   * (SeedBootstrapService) e em backfill idempotente para projetos legados.
   *
   * @param tx - Prisma TransactionClient OU PrismaService
   * @param projectId - Chave BigInt do projeto
   * @param priority - Enum string (HIGH/MEDIUM/LOW/URGENT)
   * @returns chave BigInt da DTabela correspondente, ou null se inválido
   *
   * @throws {BadRequestException} Se priority não mapeia ou DTabela não existe
   *   no projeto (sinal de que bootstrap não rodou — rodar backfill).
   */
  private async resolvePriorityId(
    tx: Prisma.TransactionClient | PrismaService,
    projectId: bigint,
    priority: string,
  ): Promise<bigint | null> {
    const idClassePriority = PRIORITY_TO_TABELA_CLASSE[priority];
    if (!idClassePriority) {
      throw new BadRequestException(
        `Priority "${priority}" inválida — esperado um de: HIGH, MEDIUM, LOW, URGENT`,
      );
    }

    // ADR-V2-058/059: priorities gravadas com a DEntidade-espelho (E);
    // resolver P→E (legacy-safe) antes de filtrar dEntidadeId.
    const priorityScope = await this.projectRef.resolveEntidadeRef(projectId);
    const tabela = await tx.dTabela.findFirst({
      where: {
        idClasse: idClassePriority,
        dEntidadeId: priorityScope,
        excluido: false,
      },
      select: { chave: true },
    });

    if (!tabela) {
      this.logger.warn(
        `resolvePriorityId: DTabela PRIORITY ${priority} (idClasse=${idClassePriority}) ausente ` +
          `para projeto ${projectId}. Rodar backfill (scripts/backfill-priority-tabelas).`,
      );
      // Fallback silencioso: persiste null em vez de quebrar a operação.
      return null;
    }

    return tabela.chave;
  }

  /**
   * Converte o BigInt persistido em DTask.idPriority → string enum
   * (HIGH/MEDIUM/LOW/URGENT) consultando a DTabela referenciada.
   *
   * Implementação batch para ZERO N+1: recebe um Map pré-resolvido
   * de `idPriorityChave → enum`. Para conveniência em chamadas single,
   * o método `findPriorityEnumMap` constrói o mapa em 1 query.
   *
   * @param idPriority - chave da DTabela (BigInt ou null)
   * @param priorityMap - mapa chave-string → enum (pré-resolvido)
   * @returns string enum ou null
   */
  private mapPriorityEnum(
    idPriority: bigint | null | undefined,
    priorityMap: Map<string, string>,
  ): string | null {
    if (!idPriority) return null;
    return priorityMap.get(idPriority.toString()) ?? null;
  }

  /**
   * Constrói o mapa `chaveDTabela → enum` em 1 query para um conjunto
   * de tasks. Usado em findMany/findOne/create/update para evitar N+1.
   *
   * @param idPriorityValues - lista de idPriority (pode conter null/duplicados)
   * @returns Map<string, string> onde key=`chave.toString()`, value=enum
   */
  private async buildPriorityMap(
    idPriorityValues: Array<bigint | null | undefined>,
  ): Promise<Map<string, string>> {
    const uniqueIds = Array.from(
      new Set(
        idPriorityValues
          .filter((id): id is bigint => id !== null && id !== undefined)
          .map((id) => id.toString()),
      ),
    ).map((s) => BigInt(s));

    if (uniqueIds.length === 0) {
      return new Map();
    }

    const tabelas = await this.prisma.dTabela.findMany({
      where: { chave: { in: uniqueIds }, excluido: false },
      select: { chave: true, idClasse: true },
    });

    const map = new Map<string, string>();
    for (const t of tabelas) {
      const enumValue = TABELA_CLASSE_TO_PRIORITY[t.idClasse.toString()];
      if (enumValue) {
        map.set(t.chave.toString(), enumValue);
      }
    }
    return map;
  }

  /**
   * Constrói um mapa `taskIdString → ActiveExecutionDto` para uma lista de
   * tasks em uma única query, sem N+1.
   *
   * Filtra `DPedido` onde:
   * - `idClasse IN (-300..-304)` — execuções Claude Code (ADR-V2-005/006)
   * - `baixado = false` — ainda ativa (sucesso/falha marca `baixado=true`)
   * - `excluido = false`
   * - `dados ? 'taskId'` — campo JSON presente (filtro grosseiro em SQL)
   *
   * O filtro final `dados.taskId IN (taskIds)` é feito em memória porque
   * o suporte de Prisma para filtros JSON tipados (`path: ['taskId'], in: [...]`)
   * varia entre versões de driver — preferimos um filtro grosseiro estável
   * + matching em memória (overhead irrelevante: o set de executions ativas
   * por org é pequeno, geralmente <10).
   *
   * @param taskIds - lista de chaves de DTask a verificar (BigInt). Vazia ⇒ Map vazio sem hit no banco.
   * @returns Map onde key=`task.chave.toString()`, value=ActiveExecutionDto
   */
  private async findActiveExecutionsForTasks(
    taskIds: bigint[],
  ): Promise<Map<string, ActiveExecutionDto>> {
    const map = new Map<string, ActiveExecutionDto>();
    if (taskIds.length === 0) return map;

    const taskIdStrings = new Set(taskIds.map((id) => id.toString()));

    const pedidos = await this.prisma.dPedido.findMany({
      where: {
        idClasse: { in: EXECUTION_CLASS_IDS },
        baixado: false,
        excluido: false,
        // Filtro grosseiro: garante que `dados.task.id` existe (formato
        // canônico persistido pelo Engine OperacaoExecucaoClaude).
        // O matching exato contra `taskIdStrings` acontece em memória abaixo.
        dados: { path: ['task', 'id'], not: Prisma.AnyNull },
      },
      select: {
        chave: true,
        idClasse: true,
        aprovado: true,
        baixado: true,
        criadoEm: true,
        dados: true,
      },
    });

    for (const p of pedidos) {
      const dados = p.dados as Record<string, unknown> | null;
      // Engine OperacaoExecucaoClaude persiste taskId nested em dados.task.id
      // (string). Acesso defensivo contra estrutura inesperada.
      const task = (dados?.task ?? null) as Record<string, unknown> | null;
      const taskId = task?.id;
      if (typeof taskId !== 'string') continue;
      if (!taskIdStrings.has(taskId)) continue;

      // Se uma task tiver múltiplos DPedido ativos (cenário anômalo), prefere
      // o mais recente — a iteração ordena em memória.
      const existing = map.get(taskId);
      if (existing && new Date(existing.startedAt).getTime() >= p.criadoEm.getTime()) {
        continue;
      }

      map.set(taskId, {
        id: p.chave.toString(),
        status: deriveExecutionStatus(p),
        riskLevel: deriveRiskLevel(p.idClasse),
        startedAt: p.criadoEm.toISOString(),
      });
    }

    return map;
  }

  /**
   * Aplica uma ação de timer manual (start/pause/resume/stop) a uma task.
   *
   * Delega a lógica de domínio (tenant gate, regra 1-timer, aritmética
   * server-side anti-fraude, agregação batch, DEvento de auditoria pós-commit)
   * ao {@link TaskTimerService} e reconstrói o `TaskResponseDto` completo via
   * `findOne` (mesma hidratação de priority/execution/timer da leitura normal).
   *
   * **NÃO toca `cycleTime`/`leadTime`/`workSessions`** — esses derivam SÓ do
   * fluxo de IA em `updateStatus` (ADR-V2-057, separação manual × IA).
   *
   * @param id - chave BigInt da task (string)
   * @param action - 'start' | 'pause' | 'resume' | 'stop'
   * @param actorId - DEntidade.chave do usuário (vem do JWT, nunca do body)
   * @param accessibleProjectIds - scope tenant (ADR-V2-042)
   * @returns TaskResponseDto com o `timer` agregado atualizado
   *
   * @throws {NotFoundException} task inexistente ou fora do scope
   * @throws {ConflictException} timer já aberto (start/resume) ou inexistente (pause/stop)
   *
   * @example
   * ```typescript
   * const task = await service.timer('7', 'start', BigInt(42), allowedIds);
   * // task.timer.running === true
   * ```
   */
  async timer(
    id: string,
    action: TimerAction,
    actorId: bigint,
    accessibleProjectIds?: string[],
  ): Promise<TaskResponseDto> {
    if (action === 'start' || action === 'resume') {
      await this.taskTimerService.start(id, actorId, accessibleProjectIds, action);
    } else {
      await this.taskTimerService.close(id, actorId, accessibleProjectIds, action);
    }
    // Reconstrói o response completo (tenant gate já garantido na mutação).
    return this.findOne(id, accessibleProjectIds);
  }

  /**
   * Constrói TaskResponseDto a partir de registro DTask.
   *
   * Extrai campos polimórficos de `dados` JSON (identifier, taskType, assigneeTeamId, v3).
   * Resolve prioridade via priorityMap (batch lookup, ZERO N+1).
   * Busca execução ativa Claude Code (DPedido ativa) via executionsMap (batch lookup).
   *
   * @param task - Registro DTask com dados completos (inclusive JSON polimórfico)
   * @param priorityMap - Map pré-calculado chave-DTabela → enum priority (opcional)
   * @param executionsMap - Map pré-calculado taskId → ActiveExecutionDto (opcional)
   * @returns TaskResponseDto com todos os campos expostos no top-level
   *
   * @example
   * ```typescript
   * const response = service.buildResponse(task, priorityMap, executionsMap);
   * // Expõe assigneeTeamId (extraído de dados.assigneeTeamId)
   * // Expõe taskType (extraído de dados.taskType)
   * // Expõe status derivado de dados.v3.state
   * ```
   */
  private buildResponse(
    task: {
      chave: bigint;
      idClasse?: bigint | null;
      idProject?: bigint | null;
      idPai?: bigint | null;
      nome: string;
      descricao?: string | null;
      idStatus?: bigint | null;
      idPriority?: bigint | null;
      idAssignee?: bigint | null;
      dueDate?: Date | null;
      dados?: unknown;
      criadoEm: Date;
      atualizadoEm: Date;
    },
    priorityMap?: Map<string, string>,
    executionsMap?: Map<string, ActiveExecutionDto>,
    timerMap?: Map<string, TaskTimerStateDto>,
  ): TaskResponseDto {
    const dados = task.dados as Record<string, unknown> | null;
    const v3 = dados?.v3 as { state?: string } | null;
    const identifier = (dados?.identifier as string | null) ?? '';
    const taskType = (dados?.taskType as string | null) ?? null;
    const assigneeTeamId = (dados?.assigneeTeamId as string | null) ?? null;
    // ADR-V2-050: expor idClasse para o frontend distinguir TASK (-154) de
    // PHASE (-200). Default "-154" preserva semântica para rows legados onde
    // o select não trouxe a coluna (defensivo — todos os callers atuais
    // já trazem idClasse).
    const idClasseStr = task.idClasse?.toString() ?? '-154';
    const taskIdStr = task.chave.toString();

    // ADR-V2-057 (Fase 3): total de tempo manual JÁ FORMATADO para a coluna
    // builtin read-only "Tempo gasto". Mesma fonte server-side do painel do
    // sidebar (totalMs agrega todos os usuários); o front nunca recalcula.
    const manualTimers = (dados?.telemetry as Record<string, unknown> | null)?.manualTimers as
      | ManualTimerSession[]
      | undefined;
    const timeSpentLabel = this.taskTimerService.formatTotalLabel(
      this.taskTimerService.totalMs(manualTimers),
    );

    return {
      id: taskIdStr,
      nome: task.nome,
      descricao: task.descricao ?? null,
      projectId: task.idProject?.toString() ?? '',
      idClasse: idClasseStr,
      identifier,
      status: v3?.state ?? 'INBOX',
      priority: priorityMap ? this.mapPriorityEnum(task.idPriority, priorityMap) : null,
      taskType,
      assigneeTeamId,
      assigneeId: dados?.assignedToAi ? 'ai' : (task.idAssignee?.toString() ?? null),
      idPai: task.idPai?.toString() ?? null,
      // D1 — dueDate como coluna tipada (não em dados JSON)
      dueDate: task.dueDate ? task.dueDate.toISOString() : null,
      dados,
      activeExecution: executionsMap?.get(taskIdStr) ?? null,
      // ADR-V2-057: timer manual agregado. Quando o timerMap não é fornecido
      // (caller que não hidrata nomes em batch) ou a task nunca teve timer,
      // o campo fica null. Derivação síncrona via buildTimerState como fallback
      // garante o estado correto mesmo sem o map pré-computado (sem nomes).
      timer: timerMap?.get(taskIdStr) ?? this.taskTimerService.buildTimerState(manualTimers),
      timeSpentLabel,
      criadoEm: task.criadoEm.toISOString(),
      atualizadoEm: task.atualizadoEm.toISOString(),
    };
  }
}

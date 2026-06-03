import {
  BadRequestException,
  Body,
  Controller,
  DefaultValuePipe,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  ParseBoolPipe,
  Post,
  Put,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { AuthCompositeGuard } from '../auth/guards/auth-composite.guard';
import { ProjectsService } from '../projects/projects.service';
import { TasksService } from './tasks.service';
import { PhaseTreeService } from './services/phase-tree.service';
import { PhaseMetricsService } from './services/phase-metrics.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { TaskResponseDto, ListTasksResponseDto } from './dto/task-response.dto';
import { PhaseTreeResponseDto } from './dto/phase-tree-response.dto';
import { PhaseMetricsResponseDto } from './dto/phase-metrics-response.dto';

interface JwtRequest {
  user: { entidadeId: string; organizationId?: string };
}

/**
 * Controller de tasks (DTask + V3 Intentions).
 *
 * Expõe CRUD completo com state machine V3 e identifier atômico.
 * Todos os endpoints requerem autenticação. Migrado para `AuthCompositeGuard`
 * (ADR-V2-042) — heranca de defesa em profundidade: orphan workspace +
 * tenant isolation no HTTP. Defesa #2 e aplicada aqui: o controller resolve
 * `accessibleProjectIds` via `ProjectsService.findAccessibleProjectIds(uid, orgId)`
 * e passa para o service, que filtra `DTask.idProject IN (...)`.
 *
 * @see TasksService — lógica de negócio
 * @see tasks-state-machine.ts — state machine V3
 * @see TasksIdentifierService — identifier atômico DEV-N
 * @see ADR-V2-042 — defesa em profundidade de tenant isolation
 */
@ApiTags('tasks')
@ApiBearerAuth()
@UseGuards(AuthCompositeGuard)
@Controller('tasks')
export class TasksController {
  private readonly logger = new Logger(TasksController.name);

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
    private readonly phaseTreeService: PhaseTreeService,
    private readonly phaseMetricsService: PhaseMetricsService,
  ) {}

  /**
   * Resolve os projectIds acessiveis ao user na org ativa (ADR-V2-042).
   *
   * Cache implicito de 1 request — o resultado e calculado novamente a cada
   * call. Se virar gargalo (>50ms / request), considerar AsyncLocalStorage
   * por request ou cache LRU compartilhado com `OrgTenantGuard`.
   *
   * @internal
   */
  private async resolveScopedProjectIds(req: JwtRequest): Promise<string[]> {
    return this.projectsService.findAccessibleProjectIds(
      BigInt(req.user.entidadeId),
      req.user.organizationId,
    );
  }

  /**
   * Cria nova task com identifier atômico DEV-N e estado INBOX.
   *
   * @param dto - Dados da task (nome, projectId, priority, assigneeId...)
   * @param req - Request com user.entidadeId
   * @returns TaskResponseDto com identifier e status=INBOX
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/api/v1/tasks \
   *   -H "Authorization: Bearer {token}" \
   *   -d '{"nome":"Implementar JWT","projectId":"1"}'
   * ```
   */
  @Post()
  @ApiOperation({
    summary: 'Criar task com identifier atômico DEV-N',
    description:
      'Estado inicial: INBOX. Identifier gerado atomicamente. Aceita `idPai` ' +
      'opcional para criar a task dentro de uma fase (ADR-V2-047). Quando ' +
      '`idPai` é informado, o service valida (1) que o pai existe no mesmo ' +
      'projeto e (2) que a profundidade total não excede MAX_PHASE_DEPTH=20.',
  })
  @ApiResponse({ status: 201, description: 'Task criada', type: TaskResponseDto })
  @ApiResponse({ status: 400, description: 'Validação: cross-project parent ou profundidade' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 404, description: 'Projeto / pai não encontrado / fora do scope' })
  async create(@Body() dto: CreateTaskDto, @Request() req: JwtRequest): Promise<TaskResponseDto> {
    this.logger.log(`POST /tasks — user=${req.user.entidadeId}, project=${dto.projectId}`);
    const allowed = await this.resolveScopedProjectIds(req);
    return this.tasksService.create(dto, BigInt(req.user.entidadeId), allowed);
  }

  /**
   * Lista tasks com filtros e cursor pagination, restritas aos projetos da
   * org ativa onde o usuario e membro (ADR-V2-042).
   *
   * Suporta filtros por projectId, status, assigneeId.
   *
   * @example
   * ```bash
   * curl "http://localhost:3000/api/v1/tasks?projectId=1&status=INBOX" \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Get()
  @ApiOperation({
    summary: 'Listar tasks com filtros (scopado por org+membership)',
    description:
      'Suporta filtros canônicos (projectId, status, assigneeId) + ' +
      'filtros hierárquicos ADR-V2-047 (idPai, idClasse, depth). Quando ' +
      '`idPai` é informado com `depth>=2`, uma CTE recursiva PostgreSQL ' +
      'resolve os descendentes em 1 query antes do findMany principal (zero N+1).',
  })
  @ApiQuery({
    name: 'idPai',
    required: false,
    description: 'Filtra por pai na hierarquia. String numérica = filhas; "null" = raízes.',
    example: '5',
  })
  @ApiQuery({
    name: 'idClasse',
    required: false,
    description: 'idClasse polimórfica. -200=PHASE; -154=SCRUMBAN_TASK.',
    example: '-200',
  })
  @ApiQuery({
    name: 'depth',
    required: false,
    description: 'Profundidade da descida (0-20). Combinar com idPai.',
    example: 1,
  })
  @ApiResponse({ status: 200, description: 'Lista de tasks', type: ListTasksResponseDto })
  async findMany(
    @Query() query: ListTasksQueryDto,
    @Request() req: JwtRequest,
  ): Promise<ListTasksResponseDto> {
    const allowed = await this.resolveScopedProjectIds(req);
    return this.tasksService.findMany(query, allowed);
  }

  /**
   * Retorna a árvore recursiva de descendentes de uma task ou fase
   * (ADR-V2-047).
   *
   * **Fase 4: stub** — registrado em F4 com Swagger e validação de scope,
   * porém `PhaseTreeService.buildTree` lança `NotImplementedException` até
   * a Fase 5 do plano. O endpoint responde 501 enquanto isso (NestJS
   * mapeia `NotImplementedException` → HTTP 501).
   *
   * Tenant gate é aplicado ANTES do service: `findOne` resolve o
   * `accessibleProjectIds` e nega 404 se a task estiver fora do escopo.
   *
   * @param id - chave da raiz da árvore (task ou fase)
   * @param maxDepth - profundidade máxima (1-20; default ilimitado, capped em 20)
   * @param includeMetrics - quando `true`, anexa `metrics` em cada nó-fase
   */
  @Get(':id/tree')
  @ApiOperation({
    summary: 'Árvore recursiva de descendentes (ADR-V2-047 — STUB Fase 4)',
    description:
      'Retorna a hierarquia completa abaixo da task/fase indicada. Implementação ' +
      'real em Fase 5 (CTE recursiva). Em Fase 4 o endpoint responde 501.',
  })
  @ApiParam({ name: 'id', description: 'ID da task/fase raiz', example: '5' })
  @ApiQuery({
    name: 'maxDepth',
    required: false,
    description: 'Profundidade máxima (cap absoluto 20). Default: ilimitado.',
    example: 5,
  })
  @ApiQuery({
    name: 'includeMetrics',
    required: false,
    description: 'Quando true, anexa métricas em nós-fase.',
    example: false,
  })
  @ApiResponse({ status: 200, description: 'Árvore retornada', type: PhaseTreeResponseDto })
  @ApiResponse({ status: 400, description: 'Parâmetro maxDepth inválido' })
  @ApiResponse({ status: 404, description: 'Task não encontrada ou fora do scope' })
  @ApiResponse({ status: 501, description: 'Não implementado em Fase 4 (aguarda Fase 5)' })
  async getTree(
    @Param('id') id: string,
    @Request() req: JwtRequest,
    @Query('maxDepth') maxDepthRaw?: string,
    @Query('includeMetrics', new DefaultValuePipe(false), ParseBoolPipe)
    includeMetrics?: boolean,
  ): Promise<PhaseTreeResponseDto> {
    this.logger.log(`GET /tasks/${id}/tree — user=${req.user.entidadeId}`);

    // Validar maxDepth (string → int 1..20). Omitido = ilimitado (undefined).
    let maxDepth: number | undefined;
    if (maxDepthRaw !== undefined) {
      const parsed = Number.parseInt(maxDepthRaw, 10);
      if (!Number.isFinite(parsed) || parsed < 1 || parsed > 20) {
        throw new BadRequestException('maxDepth deve ser inteiro entre 1 e 20');
      }
      maxDepth = parsed;
    }

    // Tenant gate: garante que a raiz pertence a projeto acessível.
    const allowed = await this.resolveScopedProjectIds(req);
    await this.tasksService.findOne(id, allowed); // lança 404 se fora do scope

    return this.phaseTreeService.buildTree(BigInt(id), {
      maxDepth,
      includeMetrics: includeMetrics ?? false,
    });
  }

  /**
   * Retorna métricas agregadas (% conclusão + contagens) de uma fase
   * (ADR-V2-047).
   *
   * **Fase 4: stub** — `PhaseMetricsService.compute` lança 501 até a Fase 5
   * implementar a CTE recursiva. O endpoint está registrado para que o
   * frontend e os clientes (MCP, webhooks) já tenham a URL definida.
   *
   * @param id - chave da fase
   * @param recursive - `true` (default) agrega descendentes; `false` apenas
   *   filhas diretas
   */
  @Get(':id/metrics')
  @ApiOperation({
    summary: 'Métricas agregadas de uma fase (ADR-V2-047 — STUB Fase 4)',
    description:
      'Retorna `{ total, done, failed, inProgress, pending, percent }`. ' +
      'Implementação real em Fase 5 (CTE recursiva). Em Fase 4 retorna 501.',
  })
  @ApiParam({ name: 'id', description: 'ID da fase/task raiz', example: '5' })
  @ApiQuery({
    name: 'recursive',
    required: false,
    description: 'Agregação recursiva (true) ou apenas filhas diretas (false). Default: true.',
    example: true,
  })
  @ApiResponse({ status: 200, description: 'Métricas calculadas', type: PhaseMetricsResponseDto })
  @ApiResponse({ status: 404, description: 'Fase não encontrada ou fora do scope' })
  @ApiResponse({ status: 501, description: 'Não implementado em Fase 4 (aguarda Fase 5)' })
  async getMetrics(
    @Param('id') id: string,
    @Request() req: JwtRequest,
    @Query('recursive', new DefaultValuePipe(true), ParseBoolPipe) recursive?: boolean,
  ): Promise<PhaseMetricsResponseDto> {
    this.logger.log(`GET /tasks/${id}/metrics — user=${req.user.entidadeId}`);

    // Tenant gate: 404 padrão se fora do scope (mensagem idêntica = anti enumeration).
    const allowed = await this.resolveScopedProjectIds(req);
    await this.tasksService.findOne(id, allowed);

    return this.phaseMetricsService.compute(BigInt(id), { recursive: recursive ?? true });
  }

  /**
   * Busca task por ID — restrito ao scope da org ativa.
   *
   * @param id - ID da task (chave DTask)
   */
  @Get(':id')
  @ApiOperation({ summary: 'Buscar task por ID (scopado)' })
  @ApiParam({ name: 'id', description: 'ID da task', example: '7' })
  @ApiResponse({ status: 200, description: 'Task encontrada', type: TaskResponseDto })
  @ApiResponse({ status: 404, description: 'Task não encontrada ou fora do scope' })
  async findOne(@Param('id') id: string, @Request() req: JwtRequest): Promise<TaskResponseDto> {
    const allowed = await this.resolveScopedProjectIds(req);
    return this.tasksService.findOne(id, allowed);
  }

  /**
   * Atualiza campos da task (nome, descrição, priority, assignee).
   *
   * Para atualizar status use PUT /tasks/:id/status.
   *
   * @param id - ID da task
   * @param dto - Campos a atualizar
   */
  @Put(':id')
  @ApiOperation({
    summary: 'Atualizar task (não altera status)',
    description:
      'Atualiza campos parciais. `idPai` aceita ADR-V2-047: ' +
      '`string` move a task para a fase indicada (valida ciclo + ' +
      'consistência cross-project); `null` move para raiz; ausente não toca.',
  })
  @ApiParam({ name: 'id', description: 'ID da task' })
  @ApiResponse({ status: 200, description: 'Task atualizada', type: TaskResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Validação: ciclo na hierarquia ou cross-project parent',
  })
  @ApiResponse({ status: 404, description: 'Task / pai não encontrada ou fora do scope' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
    @Request() req: JwtRequest,
  ): Promise<TaskResponseDto> {
    const allowed = await this.resolveScopedProjectIds(req);
    return this.tasksService.update(id, dto, allowed, BigInt(req.user.entidadeId));
  }

  /**
   * Move task entre estados V3 (state machine valida).
   *
   * Popula telemetria automaticamente (readyAt, executingAt, doneAt, workSessions).
   *
   * @param id - ID da task
   * @param dto - Novo status + movedBy
   *
   * @example
   * ```bash
   * curl -X PUT http://localhost:3000/api/v1/tasks/7/status \
   *   -H "Authorization: Bearer {token}" \
   *   -d '{"status":"READY"}'
   * ```
   */
  @Put(':id/status')
  @ApiOperation({ summary: 'Mover task entre estados V3 (state machine)' })
  @ApiParam({ name: 'id', description: 'ID da task' })
  @ApiResponse({ status: 200, description: 'Task com novo estado', type: TaskResponseDto })
  @ApiResponse({
    status: 400,
    description:
      'Transição inválida OU task é uma Fase (idClasse=-200) — use GET /tasks/:id/metrics (ADR-V2-048).',
  })
  @ApiResponse({ status: 404, description: 'Task não encontrada ou fora do scope' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTaskStatusDto,
    @Request() req: JwtRequest,
  ): Promise<TaskResponseDto> {
    const allowed = await this.resolveScopedProjectIds(req);
    return this.tasksService.updateStatus(id, dto, BigInt(req.user.entidadeId), allowed);
  }

  /**
   * Inicia o timer manual de tempo para o usuário autenticado (ADR-V2-057).
   *
   * Abre uma sessão manual em `DTask.dados.telemetry.manualTimers[]`. O `userId`
   * é capturado do JWT (`req.user.entidadeId`), nunca do body — anti-fraude.
   * Regra "1 timer aberto por task": se já houver sessão aberta (deste ou de
   * outro usuário), retorna 409. Não toca o fluxo de IA (workSessions/cycleTime).
   *
   * @param id - ID da task
   * @returns TaskResponseDto com `timer.running = true`
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/api/v1/tasks/7/timer/start \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Post(':id/timer/start')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Iniciar timer manual de tempo (ADR-V2-057)',
    description:
      'Abre uma sessão manual de timer. userId vem do JWT. 409 se já há timer ' +
      'aberto na task (regra 1-timer-por-task).',
  })
  @ApiParam({ name: 'id', description: 'ID da task' })
  @ApiResponse({ status: 200, description: 'Timer iniciado', type: TaskResponseDto })
  @ApiResponse({ status: 409, description: 'Já existe um timer em andamento nesta task' })
  @ApiResponse({ status: 404, description: 'Task não encontrada ou fora do scope' })
  async timerStart(
    @Param('id') id: string,
    @Request() req: JwtRequest,
  ): Promise<TaskResponseDto> {
    const allowed = await this.resolveScopedProjectIds(req);
    return this.tasksService.timer(id, 'start', BigInt(req.user.entidadeId), allowed);
  }

  /**
   * Pausa o timer manual do usuário autenticado (ADR-V2-057).
   *
   * Fecha a sessão aberta do usuário, gravando `endedAt` + `durationMs`
   * server-side (anti-fraude — o body nunca carrega duração). Persiste
   * imediatamente e emite DEvento `timer.paused` pós-commit. 409 se não há
   * sessão aberta deste usuário.
   *
   * @param id - ID da task
   * @returns TaskResponseDto com o total atualizado em `timer.totalsByUser`
   */
  @Post(':id/timer/pause')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Pausar timer manual de tempo (ADR-V2-057)',
    description:
      'Fecha a sessão aberta do usuário. durationMs calculado server-side ' +
      '(anti-fraude). 409 se não há timer em andamento para o usuário.',
  })
  @ApiParam({ name: 'id', description: 'ID da task' })
  @ApiResponse({ status: 200, description: 'Timer pausado', type: TaskResponseDto })
  @ApiResponse({ status: 409, description: 'Nenhum timer em andamento para este usuário' })
  @ApiResponse({ status: 404, description: 'Task não encontrada ou fora do scope' })
  async timerPause(
    @Param('id') id: string,
    @Request() req: JwtRequest,
  ): Promise<TaskResponseDto> {
    const allowed = await this.resolveScopedProjectIds(req);
    return this.tasksService.timer(id, 'pause', BigInt(req.user.entidadeId), allowed);
  }

  /**
   * Retoma o timer manual do usuário autenticado (ADR-V2-057).
   *
   * Alias semântico de `start` — abre uma nova sessão manual. Mantido explícito
   * para clareza de UI ("continuar trabalhando"). Mesma regra 1-timer (409 se
   * já há sessão aberta).
   *
   * @param id - ID da task
   * @returns TaskResponseDto com `timer.running = true`
   */
  @Post(':id/timer/resume')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Retomar timer manual de tempo (ADR-V2-057)',
    description:
      'Alias semântico de start — abre nova sessão manual. userId vem do JWT. ' +
      '409 se já há timer aberto na task.',
  })
  @ApiParam({ name: 'id', description: 'ID da task' })
  @ApiResponse({ status: 200, description: 'Timer retomado', type: TaskResponseDto })
  @ApiResponse({ status: 409, description: 'Já existe um timer em andamento nesta task' })
  @ApiResponse({ status: 404, description: 'Task não encontrada ou fora do scope' })
  async timerResume(
    @Param('id') id: string,
    @Request() req: JwtRequest,
  ): Promise<TaskResponseDto> {
    const allowed = await this.resolveScopedProjectIds(req);
    return this.tasksService.timer(id, 'resume', BigInt(req.user.entidadeId), allowed);
  }

  /**
   * Encerra o timer manual do usuário autenticado (ADR-V2-057).
   *
   * Igual a `pause` na mecânica (grava `endedAt` + `durationMs` server-side),
   * com semântica de "encerrei o trabalho agora". Emite DEvento `timer.stopped`
   * pós-commit. 409 se não há sessão aberta deste usuário.
   *
   * @param id - ID da task
   * @returns TaskResponseDto com o total atualizado em `timer.totalsByUser`
   */
  @Post(':id/timer/stop')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Encerrar timer manual de tempo (ADR-V2-057)',
    description:
      'Fecha a sessão aberta do usuário (durationMs server-side). 409 se não há ' +
      'timer em andamento para o usuário.',
  })
  @ApiParam({ name: 'id', description: 'ID da task' })
  @ApiResponse({ status: 200, description: 'Timer encerrado', type: TaskResponseDto })
  @ApiResponse({ status: 409, description: 'Nenhum timer em andamento para este usuário' })
  @ApiResponse({ status: 404, description: 'Task não encontrada ou fora do scope' })
  async timerStop(
    @Param('id') id: string,
    @Request() req: JwtRequest,
  ): Promise<TaskResponseDto> {
    const allowed = await this.resolveScopedProjectIds(req);
    return this.tasksService.timer(id, 'stop', BigInt(req.user.entidadeId), allowed);
  }

  /**
   * Soft-delete de task com cascade configurável.
   *
   * Por padrão cascateia o soft-delete para todas as subtarefas (filhas,
   * netos, ...), fechando o bug de "orfãs vivas". Use `?cascade=false` para
   * desvincular (apaga só a raiz, mantém as filhas) — caso raro e justificado.
   *
   * Emite eventos de auditoria (DEvento):
   * - PHASE (idClasse=-200): `phase.deleted` com payload {phaseId, projectId, cascade, affected}
   * - TASK normal (idClasse=-154): `task.deleted` com payload {taskId, projectId, cascade, affected}
   *
   * @param id - ID da task (chave BigInt como string)
   * @param cascade - 'true' | 'false' (opcional). Default: true (cascateia automaticamente).
   * @param req - JWT request com user context para tenant isolation (ADR-V2-042)
   * @returns Promise<void> — retorna 204 No Content em sucesso
   *
   * @throws {NotFoundException} Se task não encontrada ou fora do tenant scope
   *
   * @example
   * ```bash
   * # Delete com cascade automático (default — recomendado)
   * curl -X DELETE http://localhost:3000/api/v1/tasks/7 \
   *   -H "Authorization: Bearer {token}"
   *
   * # Delete com desvincular (escape — apenas filhas desvinculadas)
   * curl -X DELETE "http://localhost:3000/api/v1/tasks/7?cascade=false" \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deletar task (soft delete)' })
  @ApiParam({ name: 'id', description: 'ID da task' })
  @ApiQuery({
    name: 'cascade',
    required: false,
    type: Boolean,
    description:
      'Cascateia soft-delete para subtarefas. Default: true. false = desvincular (mantém filhas).',
  })
  @ApiResponse({ status: 204, description: 'Task deletada' })
  @ApiResponse({ status: 404, description: 'Task não encontrada ou fora do scope' })
  async delete(
    @Param('id') id: string,
    @Query('cascade') cascade: string | undefined,
    @Request() req: JwtRequest,
  ): Promise<void> {
    const allowed = await this.resolveScopedProjectIds(req);
    const cascadeBool = cascade === undefined ? undefined : cascade === 'true';
    await this.tasksService.delete(id, allowed, { cascade: cascadeBool });
  }
}

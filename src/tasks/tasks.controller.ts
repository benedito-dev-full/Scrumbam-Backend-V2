import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
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
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { TasksService } from './tasks.service';
import { CreateTaskDto } from './dto/create-task.dto';
import { UpdateTaskDto } from './dto/update-task.dto';
import { UpdateTaskStatusDto } from './dto/update-task-status.dto';
import { UpdateTaskSprintDto } from './dto/update-task-sprint.dto';
import { ListTasksQueryDto } from './dto/list-tasks-query.dto';
import { TaskResponseDto, ListTasksResponseDto } from './dto/task-response.dto';

/**
 * Controller de tasks (DTask + V3 Intentions).
 *
 * Expõe CRUD completo com state machine V3 e identifier atômico.
 * Todos os endpoints requerem autenticação JWT.
 *
 * @see TasksService — lógica de negócio
 * @see tasks-state-machine.ts — state machine V3
 * @see TasksIdentifierService — identifier atômico DEV-N
 */
@ApiTags('tasks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('tasks')
export class TasksController {
  private readonly logger = new Logger(TasksController.name);

  constructor(private readonly tasksService: TasksService) {}

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
  @ApiOperation({ summary: 'Criar task com identifier atômico DEV-N', description: 'Estado inicial: INBOX. Identifier gerado atomicamente.' })
  @ApiResponse({ status: 201, description: 'Task criada', type: TaskResponseDto })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 404, description: 'Projeto não encontrado' })
  async create(
    @Body() dto: CreateTaskDto,
    @Request() req: { user: { entidadeId: string } },
  ): Promise<TaskResponseDto> {
    this.logger.log(`POST /tasks — user=${req.user.entidadeId}, project=${dto.projectId}`);
    return this.tasksService.create(dto, BigInt(req.user.entidadeId));
  }

  /**
   * Lista tasks com filtros e cursor pagination.
   *
   * Suporta filtros por projectId, status, assigneeId, sprintId.
   *
   * @example
   * ```bash
   * curl "http://localhost:3000/api/v1/tasks?projectId=1&status=INBOX" \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Get()
  @ApiOperation({ summary: 'Listar tasks com filtros' })
  @ApiResponse({ status: 200, description: 'Lista de tasks', type: ListTasksResponseDto })
  async findMany(@Query() query: ListTasksQueryDto): Promise<ListTasksResponseDto> {
    return this.tasksService.findMany(query);
  }

  /**
   * Busca task por ID.
   *
   * @param id - ID da task (chave DTask)
   */
  @Get(':id')
  @ApiOperation({ summary: 'Buscar task por ID' })
  @ApiParam({ name: 'id', description: 'ID da task', example: '7' })
  @ApiResponse({ status: 200, description: 'Task encontrada', type: TaskResponseDto })
  @ApiResponse({ status: 404, description: 'Task não encontrada' })
  async findOne(@Param('id') id: string): Promise<TaskResponseDto> {
    return this.tasksService.findOne(id);
  }

  /**
   * Atualiza campos da task (nome, descrição, priority, assignee).
   *
   * Para atualizar status use PUT /tasks/:id/status.
   * Para mover sprint use PUT /tasks/:id/sprint.
   *
   * @param id - ID da task
   * @param dto - Campos a atualizar
   */
  @Put(':id')
  @ApiOperation({ summary: 'Atualizar task (não altera status)' })
  @ApiParam({ name: 'id', description: 'ID da task' })
  @ApiResponse({ status: 200, description: 'Task atualizada', type: TaskResponseDto })
  @ApiResponse({ status: 404, description: 'Task não encontrada' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTaskDto,
  ): Promise<TaskResponseDto> {
    return this.tasksService.update(id, dto);
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
  @ApiResponse({ status: 400, description: 'Transição inválida' })
  @ApiResponse({ status: 404, description: 'Task não encontrada' })
  async updateStatus(
    @Param('id') id: string,
    @Body() dto: UpdateTaskStatusDto,
  ): Promise<TaskResponseDto> {
    return this.tasksService.updateStatus(id, dto);
  }

  /**
   * Move task para sprint.
   *
   * @param id - ID da task
   * @param dto - sprintId de destino
   */
  @Put(':id/sprint')
  @ApiOperation({ summary: 'Mover task para sprint' })
  @ApiParam({ name: 'id', description: 'ID da task' })
  @ApiResponse({ status: 200, description: 'Task com novo sprint', type: TaskResponseDto })
  @ApiResponse({ status: 404, description: 'Task não encontrada' })
  async updateSprint(
    @Param('id') id: string,
    @Body() dto: UpdateTaskSprintDto,
  ): Promise<TaskResponseDto> {
    return this.tasksService.updateSprint(id, dto);
  }

  /**
   * Soft-delete de task.
   *
   * @param id - ID da task
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deletar task (soft delete)' })
  @ApiParam({ name: 'id', description: 'ID da task' })
  @ApiResponse({ status: 204, description: 'Task deletada' })
  @ApiResponse({ status: 404, description: 'Task não encontrada' })
  async delete(@Param('id') id: string): Promise<void> {
    await this.tasksService.delete(id);
  }
}

import {
  Body,
  Controller,
  Get,
  Logger,
  Param,
  Post,
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
import { DelayJustificationsService } from './delay-justifications.service';
import { CreateDelayJustificationDto } from './dto/create-delay-justification.dto';
import { DelayJustificationResponseDto } from './dto/delay-justification-response.dto';
import { PendingCountResponseDto } from './dto/pending-count-response.dto';

/**
 * Shape do `req.user` injetado pelo `AuthCompositeGuard` (JWT + ApiKey + MCP).
 *
 * Padrão local (replicado de `TasksController`/`CommentsController`) —
 * `entidadeId` já é a `DEntidade.chave` do usuário, então NÃO é preciso
 * converter via `getEntidadeIdFromUserGroup`.
 */
interface JwtRequest {
  user: { entidadeId: string; organizationId?: string };
}

/**
 * Controller da Justificativa de Atraso de Tarefas (Fase 1 — Captura,
 * ADR-V2-070).
 *
 * Rotas (sem prefixo de classe — cada método declara o path completo, pois
 * o badge vive sob `/me` e a captura sob `/tasks/:taskId`):
 * - `POST /tasks/:taskId/delay-justification` — cria/edita a vigente.
 * - `GET  /tasks/:taskId/delay-justification` — lê a vigente.
 * - `GET  /me/delay-justifications/pending-count` — badge do próprio usuário.
 *
 * Autenticação: `AuthCompositeGuard` (ADR-V2-042). RBAC fino (assignee OU org
 * ADMIN -161) vive no service — o controller apenas repassa `entidadeId`.
 *
 * O **radio de motivos** NÃO é servido aqui: reusa `GET /classes?idPai=-530`
 * (Pilar 2 — endpoint genérico, zero controller novo).
 *
 * @see DelayJustificationsService — persistência, supersede e RBAC.
 */
@ApiTags('delay-justifications')
@ApiBearerAuth()
@UseGuards(AuthCompositeGuard)
@Controller()
export class DelayJustificationsController {
  private readonly logger = new Logger(DelayJustificationsController.name);

  constructor(private readonly service: DelayJustificationsService) {}

  /**
   * Cria ou edita (supersede) a justificativa de atraso vigente da tarefa.
   *
   * @param taskId - `DTask.chave`.
   * @param dto - motivoClasse (obrigatório) + texto (opcional).
   * @param req - Request com `user.entidadeId`.
   * @returns A vigente recém-criada.
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/tasks/777/delay-justification \
   *   -H "Authorization: Bearer ..." -H "Content-Type: application/json" \
   *   -d '{"motivoClasse":"-535","texto":"Bug no gateway."}'
   * ```
   */
  @Post('tasks/:taskId/delay-justification')
  @ApiOperation({
    summary: 'Registrar/editar justificativa de atraso da tarefa',
    description:
      'Cria DEvento idClasse=-503. Edição faz supersede (excluido=true na anterior + nova). ' +
      'Autorizado a: responsável (assignee) OU org ADMIN (-161). Project MANAGER NÃO autoriza.',
  })
  @ApiParam({ name: 'taskId', description: 'ID da task (DTask.chave)', example: '777' })
  @ApiResponse({
    status: 201,
    description: 'Justificativa vigente',
    type: DelayJustificationResponseDto,
  })
  @ApiResponse({ status: 400, description: 'motivoClasse inválido ou tarefa não atrasada' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Não é assignee nem org ADMIN' })
  @ApiResponse({ status: 404, description: 'Tarefa não encontrada' })
  async createOrEdit(
    @Param('taskId') taskId: string,
    @Body() dto: CreateDelayJustificationDto,
    @Request() req: JwtRequest,
  ): Promise<DelayJustificationResponseDto> {
    this.logger.log(`POST /tasks/${taskId}/delay-justification — user=${req.user.entidadeId}`);
    return this.service.createOrEdit(taskId, dto, BigInt(req.user.entidadeId));
  }

  /**
   * Lê a justificativa de atraso vigente da tarefa (ou `null` se não houver).
   *
   * @param taskId - `DTask.chave`.
   * @param req - Request com `user.entidadeId`.
   * @returns A vigente, ou `null`.
   *
   * @example
   * ```bash
   * curl http://localhost:3000/tasks/777/delay-justification \
   *   -H "Authorization: Bearer ..."
   * ```
   */
  @Get('tasks/:taskId/delay-justification')
  @ApiOperation({
    summary: 'Ler justificativa de atraso vigente da tarefa',
    description:
      'Retorna a linha DEvento -503 excluido=false (ou null). Membro NÃO lê a de terceiros — ' +
      'apenas o responsável ou org ADMIN (-161).',
  })
  @ApiParam({ name: 'taskId', description: 'ID da task (DTask.chave)', example: '777' })
  @ApiResponse({
    status: 200,
    description: 'Justificativa vigente (ou null)',
    type: DelayJustificationResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Não é assignee nem org ADMIN' })
  @ApiResponse({ status: 404, description: 'Tarefa não encontrada' })
  async getVigente(
    @Param('taskId') taskId: string,
    @Request() req: JwtRequest,
  ): Promise<DelayJustificationResponseDto | null> {
    this.logger.log(`GET /tasks/${taskId}/delay-justification — user=${req.user.entidadeId}`);
    return this.service.getVigente(taskId, BigInt(req.user.entidadeId));
  }

  /**
   * Badge: nº de atrasos do PRÓPRIO usuário sem justificativa vigente.
   *
   * Global por padrão; `projectId` recorta por projeto (CEO decisão 4).
   *
   * @param req - Request com `user.entidadeId`.
   * @param projectId - Recorte opcional por projeto.
   * @returns `{ pendingCount, projectId }`.
   *
   * @example
   * ```bash
   * curl "http://localhost:3000/me/delay-justifications/pending-count?projectId=10" \
   *   -H "Authorization: Bearer ..."
   * ```
   */
  @Get('me/delay-justifications/pending-count')
  @ApiOperation({
    summary: 'Contagem de atrasos sem justificativa do próprio usuário',
    description:
      'Escopo global ou recortado por projectId. Sempre /me (assignee = usuário do JWT).',
  })
  @ApiQuery({
    name: 'projectId',
    required: false,
    description: 'Recorte por projeto',
    example: '10',
  })
  @ApiResponse({
    status: 200,
    description: 'Contagem de pendências',
    type: PendingCountResponseDto,
  })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  async getPendingCount(
    @Request() req: JwtRequest,
    @Query('projectId') projectId?: string,
  ): Promise<PendingCountResponseDto> {
    this.logger.log(
      `GET /me/delay-justifications/pending-count — user=${req.user.entidadeId} project=${projectId ?? '-'}`,
    );
    return this.service.getPendingCount(BigInt(req.user.entidadeId), projectId);
  }
}

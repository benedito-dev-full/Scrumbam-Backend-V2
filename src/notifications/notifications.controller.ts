import {
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Query,
  Request,
  UnauthorizedException,
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
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { ListNotificationsQueryDto } from './dto/list-notifications-query.dto';
import {
  ListNotificationsResponseDto,
  MarkAllReadResponseDto,
  UnreadCountResponseDto,
} from './dto/list-notifications-response.dto';
import { NotificationResponseDto } from './dto/notification-response.dto';
import { NotificationsService } from './notifications.service';

interface AuthenticatedRequest {
  user?: {
    entidadeId?: string;
  };
}

/**
 * Controller fino para notificacoes in-app do usuario autenticado.
 */
@ApiTags('notifications')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('notifications')
export class NotificationsController {
  private readonly logger = new Logger(NotificationsController.name);

  constructor(private readonly notificationsService: NotificationsService) {}

  /**
   * Lista notificacoes do usuario autenticado.
   *
   * @param req - Request autenticada com `user.entidadeId`.
   * @param query - Cursor, limit e filtro unread.
   */
  @Get()
  @ApiOperation({ summary: 'Listar notificacoes do usuario autenticado' })
  @ApiResponse({ status: 200, description: 'Notificacoes retornadas', type: ListNotificationsResponseDto })
  @ApiResponse({ status: 401, description: 'Nao autenticado' })
  async findMany(
    @Request() req: AuthenticatedRequest,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<ListNotificationsResponseDto> {
    const userEntidadeId = this.getUserEntidadeId(req);
    this.logger.debug(`GET /notifications user=${userEntidadeId}`);
    return this.notificationsService.findMany(userEntidadeId, query);
  }

  /**
   * Conta notificacoes nao lidas do usuario autenticado.
   *
   * @param req - Request autenticada com `user.entidadeId`.
   */
  @Get('unread-count')
  @ApiOperation({ summary: 'Contar notificacoes nao lidas' })
  @ApiResponse({ status: 200, description: 'Contagem retornada', type: UnreadCountResponseDto })
  async getUnreadCount(
    @Request() req: AuthenticatedRequest,
  ): Promise<UnreadCountResponseDto> {
    return this.notificationsService.getUnreadCount(this.getUserEntidadeId(req));
  }

  /**
   * Marca todas as notificacoes do usuario como lidas.
   *
   * @param req - Request autenticada com `user.entidadeId`.
   */
  @Patch('read-all')
  @ApiOperation({ summary: 'Marcar todas as notificacoes como lidas' })
  @ApiResponse({ status: 200, description: 'Quantidade atualizada', type: MarkAllReadResponseDto })
  async markAllAsRead(
    @Request() req: AuthenticatedRequest,
  ): Promise<MarkAllReadResponseDto> {
    return this.notificationsService.markAllAsRead(this.getUserEntidadeId(req));
  }

  /**
   * Marca uma notificacao como lida.
   *
   * @param id - `DEvento.chave` da notificacao.
   * @param req - Request autenticada com `user.entidadeId`.
   */
  @Patch(':id/read')
  @ApiOperation({ summary: 'Marcar notificacao como lida' })
  @ApiParam({ name: 'id', description: 'ID da notificacao', example: '1001' })
  @ApiResponse({ status: 200, description: 'Notificacao atualizada', type: NotificationResponseDto })
  @ApiResponse({ status: 404, description: 'Notificacao nao encontrada' })
  async markAsRead(
    @Param('id', ParseBigIntPipe) id: bigint,
    @Request() req: AuthenticatedRequest,
  ): Promise<NotificationResponseDto> {
    return this.notificationsService.markAsRead(id, this.getUserEntidadeId(req));
  }

  /**
   * Exclui logicamente uma notificacao.
   *
   * @param id - `DEvento.chave` da notificacao.
   * @param req - Request autenticada com `user.entidadeId`.
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Excluir notificacao' })
  @ApiParam({ name: 'id', description: 'ID da notificacao', example: '1001' })
  @ApiResponse({ status: 204, description: 'Notificacao excluida' })
  @ApiResponse({ status: 404, description: 'Notificacao nao encontrada' })
  async delete(
    @Param('id', ParseBigIntPipe) id: bigint,
    @Request() req: AuthenticatedRequest,
  ): Promise<void> {
    await this.notificationsService.delete(id, this.getUserEntidadeId(req));
  }

  private getUserEntidadeId(req: AuthenticatedRequest): bigint {
    if (!req.user?.entidadeId) {
      throw new UnauthorizedException('Usuario autenticado sem entidadeId');
    }
    return BigInt(req.user.entidadeId);
  }
}

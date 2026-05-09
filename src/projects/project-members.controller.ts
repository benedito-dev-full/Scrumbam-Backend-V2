import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Logger,
  Param,
  Patch,
  Post,
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
import { ProjectMembersService } from './project-members.service';
import {
  AddProjectMemberDto,
  UpdateProjectMemberDto,
} from './dto/add-project-member.dto';
import { ListProjectMembersResponseDto } from './dto/project-response.dto';

/**
 * Controller de membros de projeto.
 *
 * Gerencia DVincula -171/-172/-173 para RBAC de projetos.
 * Montado em /projects/:id/members.
 *
 * @see ProjectMembersService — lógica de negócio
 */
@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects/:id/members')
export class ProjectMembersController {
  private readonly logger = new Logger(ProjectMembersController.name);

  constructor(private readonly projectMembersService: ProjectMembersService) {}

  /**
   * Lista membros do projeto com seus roles.
   *
   * N+1 ZERO — 1 query com include.
   *
   * @param id - ID do projeto
   *
   * @example
   * ```bash
   * curl http://localhost:3000/api/v1/projects/1/members \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Get()
  @ApiOperation({ summary: 'Listar membros do projeto' })
  @ApiParam({ name: 'id', description: 'ID do projeto' })
  @ApiResponse({ status: 200, description: 'Lista de membros', type: ListProjectMembersResponseDto })
  async getMembers(@Param('id') id: string): Promise<ListProjectMembersResponseDto> {
    this.logger.debug(`GET /projects/${id}/members`);
    return this.projectMembersService.getMembers(id);
  }

  /**
   * Adiciona membro ao projeto (MANAGER).
   *
   * @param id - ID do projeto
   * @param dto - userId, role, cargo
   * @param req - Request com user.entidadeId (deve ser MANAGER)
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/api/v1/projects/1/members \
   *   -H "Authorization: Bearer {token}" \
   *   -d '{"userId":"200","role":"MEMBER"}'
   * ```
   */
  @Post()
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Adicionar membro ao projeto (MANAGER)' })
  @ApiParam({ name: 'id', description: 'ID do projeto' })
  @ApiResponse({ status: 204, description: 'Membro adicionado' })
  @ApiResponse({ status: 403, description: 'Requer role MANAGER' })
  @ApiResponse({ status: 404, description: 'Usuário não encontrado' })
  @ApiResponse({ status: 409, description: 'Usuário já é membro' })
  async addMember(
    @Param('id') id: string,
    @Body() dto: AddProjectMemberDto,
    @Request() req: { user: { entidadeId: string } },
  ): Promise<void> {
    this.logger.debug(`POST /projects/${id}/members — adding user=${dto.userId}`);
    await this.projectMembersService.addMember(id, dto, BigInt(req.user.entidadeId));
  }

  /**
   * Atualiza role/cargo de membro no projeto (MANAGER).
   *
   * @param id - ID do projeto
   * @param userId - ID da DEntidade do membro
   * @param dto - Novo role e cargo
   * @param req - Request com user.entidadeId (deve ser MANAGER)
   */
  @Patch(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Atualizar role de membro (MANAGER)' })
  @ApiParam({ name: 'id', description: 'ID do projeto' })
  @ApiParam({ name: 'userId', description: 'ID do usuário membro' })
  @ApiResponse({ status: 204, description: 'Role atualizado' })
  @ApiResponse({ status: 403, description: 'Requer role MANAGER' })
  @ApiResponse({ status: 404, description: 'Membro não encontrado' })
  async updateMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateProjectMemberDto,
    @Request() req: { user: { entidadeId: string } },
  ): Promise<void> {
    await this.projectMembersService.updateMember(id, userId, dto, BigInt(req.user.entidadeId));
  }

  /**
   * Remove membro do projeto (MANAGER).
   *
   * Não pode remover o último MANAGER.
   *
   * @param id - ID do projeto
   * @param userId - ID da DEntidade do membro a remover
   * @param req - Request com user.entidadeId (deve ser MANAGER)
   */
  @Delete(':userId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover membro do projeto (MANAGER)' })
  @ApiParam({ name: 'id', description: 'ID do projeto' })
  @ApiParam({ name: 'userId', description: 'ID do usuário membro' })
  @ApiResponse({ status: 204, description: 'Membro removido' })
  @ApiResponse({ status: 403, description: 'Requer role MANAGER ou último MANAGER' })
  @ApiResponse({ status: 404, description: 'Membro não encontrado' })
  async removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Request() req: { user: { entidadeId: string } },
  ): Promise<void> {
    await this.projectMembersService.removeMember(id, userId, BigInt(req.user.entidadeId));
  }
}

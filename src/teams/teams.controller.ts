import {
  Body,
  Controller,
  Delete,
  Get,
  Logger,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { TeamsService } from './teams.service';
import { CreateTeamDto } from './dto/create-team.dto';
import { UpdateTeamDto } from './dto/update-team.dto';
import { AddTeamMemberDto } from './dto/add-team-member.dto';
import {
  TeamResponseDto,
  ListTeamResponseDto,
  ListTeamMembersResponseDto,
} from './dto/team-response.dto';
import { AuthCompositeGuard } from '../auth/guards/auth-composite.guard';
import { CurrentUser, JwtPayload } from '../auth/decorators/current-user.decorator';

/**
 * Controller de times (DEntidade idClasse=-180).
 *
 * Endpoints de CRUD e membership de times.
 * Todos os endpoints requerem autenticação JWT.
 */
@ApiTags('teams')
@Controller()
@UseGuards(AuthCompositeGuard)
export class TeamsController {
  private readonly logger = new Logger(TeamsController.name);

  constructor(private readonly teamsService: TeamsService) {}

  /**
   * Cria time na organização.
   *
   * @param orgId - ID da organização pai
   * @param dto - Dados do time
   * @param user - Usuário autenticado (deve ser membro da org)
   * @returns TeamResponseDto
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/api/v1/organizations/100/teams \
   *   -H "Authorization: Bearer {token}" \
   *   -d '{"nome": "Backend Team", "prefix": "BACK"}'
   * ```
   */
  @Post('organizations/:orgId/teams')
  @ApiOperation({ summary: 'Criar time na organização' })
  @ApiParam({ name: 'orgId', description: 'ID da organização' })
  @ApiResponse({ status: 201, description: 'Time criado', type: TeamResponseDto })
  @ApiResponse({ status: 409, description: 'Prefixo já existe' })
  async create(
    @Param('orgId') orgId: string,
    @Body() dto: CreateTeamDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<TeamResponseDto> {
    this.logger.log(`POST /organizations/${orgId}/teams nome="${dto.nome}" user=${user.entidadeId}`);
    return this.teamsService.create(orgId, dto, BigInt(user.entidadeId));
  }

  /**
   * Lista times de uma organização.
   *
   * @param orgId - ID da organização
   * @param user - Usuário autenticado (deve ser membro da org)
   * @returns Lista paginada de times
   *
   * @example
   * ```bash
   * curl http://localhost:3000/api/v1/organizations/100/teams \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Get('organizations/:orgId/teams')
  @ApiOperation({ summary: 'Listar times de uma organização' })
  @ApiParam({ name: 'orgId', description: 'ID da organização' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Times listados', type: ListTeamResponseDto })
  async findByOrg(
    @Param('orgId') orgId: string,
    @CurrentUser() user: JwtPayload,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<ListTeamResponseDto> {
    return this.teamsService.findByOrg(
      orgId,
      BigInt(user.entidadeId),
      cursor,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  /**
   * Lista times onde o usuário autenticado é membro (cross-org).
   *
   * @param user - Usuário autenticado
   * @returns Lista de todos os times do usuário
   *
   * @example
   * ```bash
   * curl http://localhost:3000/api/v1/teams/mine \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Get('teams/mine')
  @ApiOperation({ summary: 'Listar meus times (cross-org)' })
  @ApiQuery({ name: 'cursor', required: false })
  @ApiQuery({ name: 'limit', required: false, type: Number })
  @ApiResponse({ status: 200, description: 'Meus times', type: ListTeamResponseDto })
  async findMine(
    @CurrentUser() user: JwtPayload,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<ListTeamResponseDto> {
    return this.teamsService.findMine(
      BigInt(user.entidadeId),
      cursor,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  /**
   * Busca time por ID.
   *
   * @param id - ID do time
   * @param user - Usuário autenticado (deve ser membro do time)
   * @returns TeamResponseDto
   *
   * @example
   * ```bash
   * curl http://localhost:3000/api/v1/teams/200 \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Get('teams/:id')
  @ApiOperation({ summary: 'Buscar time por ID' })
  @ApiParam({ name: 'id', description: 'ID do time' })
  @ApiResponse({ status: 200, description: 'Time encontrado', type: TeamResponseDto })
  @ApiResponse({ status: 404, description: 'Não encontrado' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<TeamResponseDto> {
    return this.teamsService.findOne(id, BigInt(user.entidadeId));
  }

  /**
   * Atualiza time (LEAD ou ADMIN da org).
   *
   * @param id - ID do time
   * @param dto - Campos a atualizar
   * @param user - Usuário autenticado
   * @returns TeamResponseDto atualizado
   *
   * @example
   * ```bash
   * curl -X PATCH http://localhost:3000/api/v1/teams/200 \
   *   -H "Authorization: Bearer {token}" \
   *   -d '{"nome": "Novo Nome"}'
   * ```
   */
  @Patch('teams/:id')
  @ApiOperation({ summary: 'Atualizar time (LEAD ou ADMIN da org)' })
  @ApiParam({ name: 'id', description: 'ID do time' })
  @ApiResponse({ status: 200, description: 'Atualizado', type: TeamResponseDto })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTeamDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<TeamResponseDto> {
    return this.teamsService.update(id, dto, BigInt(user.entidadeId));
  }

  /**
   * Deleta time (LEAD ou ADMIN da org).
   *
   * @param id - ID do time
   * @param user - Usuário autenticado
   *
   * @example
   * ```bash
   * curl -X DELETE http://localhost:3000/api/v1/teams/200 \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Delete('teams/:id')
  @ApiOperation({ summary: 'Deletar time' })
  @ApiParam({ name: 'id', description: 'ID do time' })
  @ApiResponse({ status: 200, description: 'Deletado' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ message: string }> {
    await this.teamsService.delete(id, BigInt(user.entidadeId));
    return { message: `Time ${id} deletado com sucesso` };
  }

  /**
   * Lista membros do time.
   *
   * @param id - ID do time
   * @param user - Usuário autenticado (deve ser membro)
   * @returns Lista de membros com cargo
   *
   * @example
   * ```bash
   * curl http://localhost:3000/api/v1/teams/200/members \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Get('teams/:id/members')
  @ApiOperation({ summary: 'Listar membros do time' })
  @ApiParam({ name: 'id', description: 'ID do time' })
  @ApiResponse({ status: 200, description: 'Membros listados', type: ListTeamMembersResponseDto })
  async getMembers(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<ListTeamMembersResponseDto> {
    return this.teamsService.getMembers(id, BigInt(user.entidadeId));
  }

  /**
   * Adiciona membro ao time (LEAD ou ADMIN da org).
   *
   * @param id - ID do time
   * @param dto - userId e cargo
   * @param user - Usuário autenticado (deve ser LEAD ou ADMIN)
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/api/v1/teams/200/members \
   *   -H "Authorization: Bearer {token}" \
   *   -d '{"userId": "300", "cargo": "MEMBER"}'
   * ```
   */
  @Post('teams/:id/members')
  @ApiOperation({ summary: 'Adicionar membro ao time (LEAD ou ADMIN)' })
  @ApiParam({ name: 'id', description: 'ID do time' })
  @ApiResponse({ status: 201, description: 'Membro adicionado' })
  async addMember(
    @Param('id') id: string,
    @Body() dto: AddTeamMemberDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ message: string }> {
    await this.teamsService.addMember(id, dto, BigInt(user.entidadeId));
    return { message: 'Membro adicionado com sucesso' };
  }

  /**
   * Atualiza cargo de membro no time.
   *
   * @param id - ID do time
   * @param userId - ID da DEntidade do membro
   * @param body - Novo cargo
   * @param user - Usuário autenticado (deve ser LEAD ou ADMIN)
   *
   * @example
   * ```bash
   * curl -X PATCH http://localhost:3000/api/v1/teams/200/members/300 \
   *   -H "Authorization: Bearer {token}" \
   *   -d '{"cargo": "LEAD"}'
   * ```
   */
  @Patch('teams/:id/members/:userId')
  @ApiOperation({ summary: 'Atualizar cargo de membro no time' })
  @ApiParam({ name: 'id', description: 'ID do time' })
  @ApiParam({ name: 'userId', description: 'ID da DEntidade do membro' })
  @ApiResponse({ status: 200, description: 'Cargo atualizado' })
  async updateMemberCargo(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() body: { cargo: 'LEAD' | 'MEMBER' },
    @CurrentUser() user: JwtPayload,
  ): Promise<{ message: string }> {
    await this.teamsService.updateMemberCargo(id, userId, body.cargo, BigInt(user.entidadeId));
    return { message: 'Cargo atualizado com sucesso' };
  }

  /**
   * Remove membro do time.
   *
   * @param id - ID do time
   * @param userId - ID da DEntidade do membro
   * @param user - Usuário autenticado (deve ser LEAD ou ADMIN)
   *
   * @example
   * ```bash
   * curl -X DELETE http://localhost:3000/api/v1/teams/200/members/300 \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Delete('teams/:id/members/:userId')
  @ApiOperation({ summary: 'Remover membro do time' })
  @ApiParam({ name: 'id', description: 'ID do time' })
  @ApiParam({ name: 'userId', description: 'ID da DEntidade do membro' })
  @ApiResponse({ status: 200, description: 'Membro removido' })
  async removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ message: string }> {
    await this.teamsService.removeMember(id, userId, BigInt(user.entidadeId));
    return { message: 'Membro removido com sucesso' };
  }
}

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
import { OrganizationsService } from './organizations.service';
import { CreateOrganizationDto } from './dto/create-organization.dto';
import { UpdateOrganizationDto } from './dto/update-organization.dto';
import { AddOrgMemberDto } from './dto/add-org-member.dto';
import { UpdateOrgMemberRoleDto } from './dto/update-org-member-role.dto';
import {
  OrganizationResponseDto,
  ListOrganizationResponseDto,
  ListOrgMembersResponseDto,
} from './dto/organization-response.dto';
import { AuthCompositeGuard } from '../auth/guards/auth-composite.guard';
import { CurrentUser, JwtPayload } from '../auth/decorators/current-user.decorator';

/**
 * Controller de organizações (DEntidade idClasse=-152).
 *
 * Endpoints de CRUD e gestão de membros de organização.
 * Todos os endpoints requerem autenticação JWT.
 *
 * RBAC:
 * - GET: qualquer membro da org
 * - POST/PATCH/DELETE: ADMIN da org (verificado no service)
 */
@ApiTags('organizations')
@Controller('organizations')
@UseGuards(AuthCompositeGuard)
export class OrganizationsController {
  private readonly logger = new Logger(OrganizationsController.name);

  constructor(private readonly organizationsService: OrganizationsService) {}

  /**
   * Cria nova organização com Default Team, Issue Counter e membership ADMIN.
   *
   * Transaction atômica cria 5 registros:
   * DEntidade org + DEntidade team + DTabela counter + DVincula ADMIN + DVincula TEAM_LEAD.
   *
   * @param dto - Dados da organização
   * @param user - Usuário autenticado (extraído do JWT)
   * @returns OrganizationResponseDto
   *
   * @throws {UnauthorizedException} Se não autenticado
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/api/v1/organizations \
   *   -H "Authorization: Bearer {token}" \
   *   -H "Content-Type: application/json" \
   *   -d '{"nome": "Acme Corp"}'
   * ```
   */
  @Post()
  @ApiOperation({ summary: 'Criar organização', description: 'Cria DEntidade -152 + Default Team + Issue Counter em transaction atômica' })
  @ApiResponse({ status: 201, description: 'Organização criada', type: OrganizationResponseDto })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  async create(
    @Body() dto: CreateOrganizationDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<OrganizationResponseDto> {
    this.logger.log(`POST /organizations nome="${dto.nome}" user=${user.entidadeId}`);
    return this.organizationsService.create(dto, BigInt(user.entidadeId));
  }

  /**
   * Lista organizações onde o usuário autenticado é membro.
   *
   * Cursor pagination — parâmetro `cursor` é a chave da última org retornada.
   *
   * @param user - Usuário autenticado
   * @param cursor - Cursor para paginação (opcional)
   * @param limit - Quantidade por página (default: 20, max: 100)
   * @returns Lista paginada de organizações
   *
   * @example
   * ```bash
   * curl http://localhost:3000/api/v1/organizations \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Get()
  @ApiOperation({ summary: 'Listar organizações do usuário' })
  @ApiQuery({ name: 'cursor', required: false, description: 'Cursor de paginação' })
  @ApiQuery({ name: 'limit', required: false, description: 'Itens por página (max 100)', type: Number })
  @ApiResponse({ status: 200, description: 'Lista retornada', type: ListOrganizationResponseDto })
  async findMany(
    @CurrentUser() user: JwtPayload,
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<ListOrganizationResponseDto> {
    return this.organizationsService.findMany(
      BigInt(user.entidadeId),
      cursor,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  /**
   * Busca organização por ID.
   *
   * @param id - ID da organização
   * @param user - Usuário autenticado (deve ser membro)
   * @returns OrganizationResponseDto
   *
   * @throws {NotFoundException} Se não encontrada
   * @throws {ForbiddenException} Se não é membro
   *
   * @example
   * ```bash
   * curl http://localhost:3000/api/v1/organizations/100 \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Get(':id')
  @ApiOperation({ summary: 'Buscar organização por ID' })
  @ApiParam({ name: 'id', description: 'ID da organização' })
  @ApiResponse({ status: 200, description: 'Organização encontrada', type: OrganizationResponseDto })
  @ApiResponse({ status: 404, description: 'Não encontrada' })
  @ApiResponse({ status: 403, description: 'Acesso negado' })
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<OrganizationResponseDto> {
    return this.organizationsService.findOne(id, BigInt(user.entidadeId));
  }

  /**
   * Atualiza organização (apenas ADMIN).
   *
   * @param id - ID da organização
   * @param dto - Campos a atualizar
   * @param user - Usuário autenticado (deve ser ADMIN)
   * @returns OrganizationResponseDto atualizada
   *
   * @throws {NotFoundException} Se não encontrada
   * @throws {ForbiddenException} Se não é ADMIN
   *
   * @example
   * ```bash
   * curl -X PATCH http://localhost:3000/api/v1/organizations/100 \
   *   -H "Authorization: Bearer {token}" \
   *   -d '{"nome": "Novo Nome"}'
   * ```
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar organização (ADMIN)' })
  @ApiParam({ name: 'id', description: 'ID da organização' })
  @ApiResponse({ status: 200, description: 'Atualizada', type: OrganizationResponseDto })
  @ApiResponse({ status: 403, description: 'Apenas ADMIN pode atualizar' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateOrganizationDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<OrganizationResponseDto> {
    return this.organizationsService.update(id, dto, BigInt(user.entidadeId));
  }

  /**
   * Deleta organização com cascade completo (apenas ADMIN).
   *
   * Soft-delete: DEntidade, DVincula, DEntidade teams, DTabela counters, DProject.
   *
   * @param id - ID da organização
   * @param user - Usuário autenticado (deve ser ADMIN)
   *
   * @throws {NotFoundException} Se não encontrada
   * @throws {ForbiddenException} Se não é ADMIN
   *
   * @example
   * ```bash
   * curl -X DELETE http://localhost:3000/api/v1/organizations/100 \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Deletar organização com cascade (ADMIN)' })
  @ApiParam({ name: 'id', description: 'ID da organização' })
  @ApiResponse({ status: 200, description: 'Deletada' })
  @ApiResponse({ status: 403, description: 'Apenas ADMIN pode deletar' })
  async delete(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ message: string }> {
    await this.organizationsService.delete(id, BigInt(user.entidadeId));
    return { message: `Organização ${id} deletada com sucesso` };
  }

  /**
   * Lista membros da organização.
   *
   * @param id - ID da organização
   * @param user - Usuário autenticado (deve ser membro)
   * @returns Lista de membros com roles
   *
   * @throws {ForbiddenException} Se não é membro
   *
   * @example
   * ```bash
   * curl http://localhost:3000/api/v1/organizations/100/members \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Get(':id/members')
  @ApiOperation({ summary: 'Listar membros da organização' })
  @ApiParam({ name: 'id', description: 'ID da organização' })
  @ApiResponse({ status: 200, description: 'Membros listados', type: ListOrgMembersResponseDto })
  async getMembers(
    @Param('id') id: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<ListOrgMembersResponseDto> {
    return this.organizationsService.getMembers(id, BigInt(user.entidadeId));
  }

  /**
   * Adiciona membro à organização (apenas ADMIN).
   *
   * @param id - ID da organização
   * @param dto - userId e role do novo membro
   * @param user - Usuário autenticado (deve ser ADMIN)
   *
   * @throws {ConflictException} Se já é membro
   * @throws {ForbiddenException} Se não é ADMIN
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/api/v1/organizations/100/members \
   *   -H "Authorization: Bearer {token}" \
   *   -d '{"userId": "200", "role": "MEMBER"}'
   * ```
   */
  @Post(':id/members')
  @ApiOperation({ summary: 'Adicionar membro à organização (ADMIN)' })
  @ApiParam({ name: 'id', description: 'ID da organização' })
  @ApiResponse({ status: 201, description: 'Membro adicionado' })
  @ApiResponse({ status: 409, description: 'Já é membro' })
  @ApiResponse({ status: 403, description: 'Apenas ADMIN pode adicionar membros' })
  async addMember(
    @Param('id') id: string,
    @Body() dto: AddOrgMemberDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ message: string }> {
    await this.organizationsService.addMember(id, dto, BigInt(user.entidadeId));
    return { message: 'Membro adicionado com sucesso' };
  }

  /**
   * Atualiza cargo de membro na organização (apenas ADMIN).
   *
   * @param id - ID da organização
   * @param userId - ID da DEntidade do membro a atualizar
   * @param dto - Novo role
   * @param user - Usuário autenticado (deve ser ADMIN)
   *
   * @throws {NotFoundException} Se membro não encontrado
   * @throws {ForbiddenException} Se não é ADMIN
   *
   * @example
   * ```bash
   * curl -X PATCH http://localhost:3000/api/v1/organizations/100/members/200 \
   *   -H "Authorization: Bearer {token}" \
   *   -d '{"role": "ADMIN"}'
   * ```
   */
  @Patch(':id/members/:userId')
  @ApiOperation({ summary: 'Atualizar cargo de membro (ADMIN)' })
  @ApiParam({ name: 'id', description: 'ID da organização' })
  @ApiParam({ name: 'userId', description: 'ID da DEntidade do membro' })
  @ApiResponse({ status: 200, description: 'Cargo atualizado' })
  @ApiResponse({ status: 403, description: 'Apenas ADMIN' })
  async updateMemberRole(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: UpdateOrgMemberRoleDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ message: string }> {
    await this.organizationsService.updateMemberRole(id, userId, dto, BigInt(user.entidadeId));
    return { message: 'Cargo atualizado com sucesso' };
  }

  /**
   * Remove membro da organização (apenas ADMIN).
   *
   * Não permite remover o último ADMIN.
   *
   * @param id - ID da organização
   * @param userId - ID da DEntidade do membro a remover
   * @param user - Usuário autenticado (deve ser ADMIN)
   *
   * @throws {NotFoundException} Se membro não encontrado
   * @throws {ForbiddenException} Se não é ADMIN ou é o último ADMIN
   *
   * @example
   * ```bash
   * curl -X DELETE http://localhost:3000/api/v1/organizations/100/members/200 \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Delete(':id/members/:userId')
  @ApiOperation({ summary: 'Remover membro da organização (ADMIN)' })
  @ApiParam({ name: 'id', description: 'ID da organização' })
  @ApiParam({ name: 'userId', description: 'ID da DEntidade do membro' })
  @ApiResponse({ status: 200, description: 'Membro removido' })
  @ApiResponse({ status: 403, description: 'Apenas ADMIN ou último ADMIN' })
  async removeMember(
    @Param('id') id: string,
    @Param('userId') userId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ message: string }> {
    await this.organizationsService.removeMember(id, userId, BigInt(user.entidadeId));
    return { message: 'Membro removido com sucesso' };
  }
}

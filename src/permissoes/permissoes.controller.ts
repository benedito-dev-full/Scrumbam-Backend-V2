import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { PermissoesService } from './permissoes.service';
import { AuthCompositeGuard } from '../auth/guards/auth-composite.guard';
import { RolesGuard } from '../auth/guards/roles.guard';
import { Roles } from '../auth/decorators/roles.decorator';
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { CreatePermissaoDto } from './dto/create-permissao.dto';
import { PermissaoResponseDto } from './dto/permissao-response.dto';

/**
 * Controller de permissões granulares (DPermissao).
 *
 * Todos os endpoints exigem role ADMIN da organização.
 * Acesso via JWT Bearer ou API Key/MCP Key com role ADMIN.
 *
 * @see PermissoesService — lógica de negócio
 * @see RolesGuard — verifica role ADMIN via DVincula
 */
@ApiTags('permissoes')
@ApiBearerAuth()
@UseGuards(AuthCompositeGuard, RolesGuard)
@Roles('ADMIN')
@Controller('permissoes')
export class PermissoesController {
  constructor(private readonly permissoesService: PermissoesService) {}

  /**
   * Lista permissões de um grupo de usuários.
   *
   * @param groupId - ID do DUserGroup como query param
   * @returns Lista de permissões
   */
  @Get()
  @ApiOperation({ summary: 'Lista permissões de um grupo (ADMIN)' })
  @ApiQuery({ name: 'groupId', required: true, description: 'ID do DUserGroup', example: '1' })
  @ApiResponse({ status: 200, description: 'Lista de permissões', type: [PermissaoResponseDto] })
  @ApiResponse({ status: 403, description: 'Role ADMIN exigido' })
  async list(@Query('groupId', ParseBigIntPipe) groupId: bigint): Promise<PermissaoResponseDto[]> {
    return this.permissoesService.list(groupId);
  }

  /**
   * Cria nova permissão granular.
   *
   * @param dto - Dados da permissão
   * @returns PermissaoResponseDto criada (201)
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cria permissão granular (ADMIN)' })
  @ApiResponse({ status: 201, description: 'Permissão criada', type: PermissaoResponseDto })
  @ApiResponse({ status: 403, description: 'Role ADMIN exigido' })
  async create(@Body() dto: CreatePermissaoDto): Promise<PermissaoResponseDto> {
    return this.permissoesService.create(dto);
  }

  /**
   * Atualiza permissão existente (PATCH semântico).
   *
   * @param id - ID da DPermissao
   * @param dto - Campos a atualizar
   * @returns PermissaoResponseDto atualizada
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza permissão (PATCH — ADMIN)' })
  @ApiParam({ name: 'id', description: 'ID da DPermissao', example: '1' })
  @ApiResponse({ status: 200, description: 'Permissão atualizada', type: PermissaoResponseDto })
  @ApiResponse({ status: 404, description: 'Permissão não encontrada' })
  async update(
    @Param('id', ParseBigIntPipe) id: bigint,
    @Body() dto: Partial<CreatePermissaoDto>,
  ): Promise<PermissaoResponseDto> {
    return this.permissoesService.update(id, dto);
  }

  /**
   * Soft-delete de permissão.
   *
   * @param id - ID da DPermissao
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remove permissão (soft-delete — ADMIN)' })
  @ApiParam({ name: 'id', description: 'ID da DPermissao', example: '1' })
  @ApiResponse({ status: 204, description: 'Permissão removida' })
  @ApiResponse({ status: 404, description: 'Permissão não encontrada' })
  async delete(@Param('id', ParseBigIntPipe) id: bigint): Promise<void> {
    return this.permissoesService.delete(id);
  }
}

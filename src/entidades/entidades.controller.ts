import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  HttpCode,
  HttpStatus,
  Res,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiHeader,
  ApiTags,
  ApiOperation,
  ApiParam,
  ApiQuery,
  ApiResponse,
  ApiBody,
} from '@nestjs/swagger';
import { Response } from 'express';
import { EntidadeService } from './entidades.service';
import { AuthCompositeGuard } from '../auth/guards/auth-composite.guard';
import { OrgTenantGuard } from '../auth/guards/org-tenant.guard';
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { ListEntidadeQueryDto } from './dto/list-entidade-query.dto';
import { CreateEntidadeDto } from './dto/create-entidade.dto';
import { UpdateEntidadeDto } from './dto/update-entidade.dto';
import { EntidadeResponseDto } from './dto/entidade-response.dto';
import { ListEntidadeResponseDto } from './dto/list-entidade-response.dto';

/**
 * Controller genérico canônico para DEntidade (Pilar 2 — Endpoints Genéricos).
 *
 * Serve TODOS os tipos de entidade via `?idClasse=N`:
 * - GET /entidades?idClasse=-150 → Usuários
 * - GET /entidades?idClasse=-152 → Organizações
 * - GET /entidades?idClasse=-180 → Times
 * - GET /entidades?idClasse=-156 → Agentes Claude
 *
 * PROIBIDO criar controllers separados para cada tipo (UserController,
 * OrganizationController, etc.) — violaria Pilar 2.
 *
 * Auth: AuthCompositeGuard + OrgTenantGuard (F3).
 *
 * @see EntidadeService para lógica de negócio
 * @see ADR-V2-015 para convenção de query params ?idClasse vs ?classe
 */
@ApiTags('entidades')
@ApiBearerAuth()
@ApiHeader({ name: 'X-API-Key', required: false, description: 'API Key alternativa ao JWT' })
@ApiHeader({ name: 'X-MCP-Key', required: false, description: 'MCP Key alternativa ao JWT' })
@UseGuards(AuthCompositeGuard, OrgTenantGuard)
@Controller('entidades')
export class EntidadeController {
  constructor(private readonly entidadeService: EntidadeService) {}

  /**
   * Lista entidades paginadas filtradas por classe.
   *
   * Usa cursor pagination para escalabilidade.
   * Para próxima página: `?cursor=<nextCursor>` do response anterior.
   *
   * @param query - Filtros e paginação (idClasse obrigatório)
   * @param res - Response Express (para headers de deprecation ADR-V2-015)
   * @returns Lista paginada de entidades
   *
   * @throws {BadRequestException} Se idClasse/classe ausente ou ambos presentes
   * @throws {NotFoundException} Se DClasse não encontrada
   *
   * @example
   * ```bash
   * curl 'http://localhost:3000/api/v1/entidades?idClasse=-150&pageSize=20'
   * ```
   */
  @Get()
  @ApiOperation({
    summary: 'Lista entidades por classe (Pilar 2 — endpoint genérico)',
    description: 'Retorna lista paginada de DEntidade filtrada por idClasse. Use ?idClasse=-150 para Users, -152 para Orgs, -180 para Teams, -156 para Agents.',
  })
  @ApiQuery({ name: 'idClasse', required: false, description: 'ID da DClasse (canônico V2). Ex: -150', example: '-150' })
  @ApiQuery({ name: 'classe', required: false, description: '[DEPRECATED] Código da DClasse. Use idClasse.', deprecated: true })
  @ApiQuery({ name: 'nome', required: false, description: 'Filtro por nome (parcial)', example: 'João' })
  @ApiQuery({ name: 'cursor', required: false, description: 'Cursor para próxima página', example: '999' })
  @ApiQuery({ name: 'pageSize', required: false, description: 'Itens por página (default 20, max 100)', example: 20 })
  @ApiResponse({ status: 200, description: 'Lista retornada', type: ListEntidadeResponseDto })
  @ApiResponse({ status: 400, description: 'Parâmetro idClasse ausente ou inválido' })
  @ApiResponse({ status: 404, description: 'DClasse não encontrada' })
  async listar(
    @Query() query: ListEntidadeQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ListEntidadeResponseDto> {
    return this.entidadeService.listarPorClasse(query, res);
  }

  /**
   * Retorna campos dinâmicos (tableFields) de uma DClasse.
   *
   * Usado pelo frontend para renderizar formulários dinâmicos por tipo de entidade.
   * Deve ser chamado antes de criar ou editar uma entidade para descobrir campos customizados.
   *
   * Atenção: rota /fields DEVE ser registrada ANTES de /:id para evitar conflito.
   *
   * @param idClasse - ID da DClasse como string (query param)
   * @returns tableFields da DClasse ou null
   *
   * @throws {NotFoundException} Se DClasse não encontrada
   *
   * @example
   * ```bash
   * curl 'http://localhost:3000/api/v1/entidades/fields?idClasse=-150'
   * ```
   */
  @Get('fields')
  @ApiOperation({
    summary: 'Retorna campos dinâmicos (tableFields) de uma DClasse',
    description: 'Retorna a definição de campos customizados da DClasse para renderização de formulários dinâmicos.',
  })
  @ApiQuery({ name: 'idClasse', required: true, description: 'ID da DClasse', example: '-150' })
  @ApiResponse({ status: 200, description: 'tableFields da DClasse (ou null)' })
  @ApiResponse({ status: 404, description: 'DClasse não encontrada' })
  async getFields(@Query('idClasse') idClasse: string): Promise<unknown> {
    return this.entidadeService.getFieldsByClasse(idClasse);
  }

  /**
   * Busca entidade por ID (chave primária).
   *
   * @param id - Chave primária da DEntidade (BigInt como string no path)
   * @returns EntidadeResponseDto completo com dados da DClasse
   *
   * @throws {NotFoundException} Se entidade não encontrada ou excluída
   *
   * @example
   * ```bash
   * curl 'http://localhost:3000/api/v1/entidades/150'
   * ```
   */
  @Get(':id')
  @ApiOperation({ summary: 'Busca entidade por ID' })
  @ApiParam({ name: 'id', description: 'Chave primária da DEntidade', example: '150' })
  @ApiResponse({ status: 200, description: 'Entidade encontrada', type: EntidadeResponseDto })
  @ApiResponse({ status: 404, description: 'Entidade não encontrada' })
  async findOne(@Param('id', ParseBigIntPipe) id: bigint): Promise<EntidadeResponseDto> {
    return this.entidadeService.buscarPorId(id.toString());
  }

  /**
   * Cria nova entidade polimórfica.
   *
   * O tipo é determinado pelo `idClasse` no body.
   * Para USER (-150): recomenda-se incluir email.
   * A operação cria DEntidade + DEvento de audit em transaction atômica.
   *
   * @param dto - Dados da nova entidade
   * @returns EntidadeResponseDto criada (201)
   *
   * @throws {NotFoundException} Se DClasse não encontrada
   * @throws {ConflictException} Se email já existe
   * @throws {BadRequestException} Se dados inválidos
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/api/v1/entidades \
   *   -H 'Content-Type: application/json' \
   *   -d '{"idClasse":"-150","nome":"João Silva","email":"joao@empresa.com"}'
   * ```
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Cria nova entidade',
    description: 'Cria DEntidade de qualquer tipo via idClasse. Executa em transaction com DEvento de audit.',
  })
  @ApiBody({ type: CreateEntidadeDto })
  @ApiResponse({ status: 201, description: 'Entidade criada', type: EntidadeResponseDto })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 404, description: 'DClasse não encontrada' })
  @ApiResponse({ status: 409, description: 'Email já existe' })
  async criar(@Body() dto: CreateEntidadeDto): Promise<EntidadeResponseDto> {
    return this.entidadeService.criar(dto);
  }

  /**
   * Atualiza campos de entidade existente (PATCH semântico).
   *
   * Apenas os campos enviados no body são atualizados.
   * `idClasse` é imutável e não pode ser alterado.
   *
   * @param id - Chave primária da DEntidade
   * @param dto - Campos a atualizar
   * @returns EntidadeResponseDto atualizada
   *
   * @throws {NotFoundException} Se entidade não encontrada
   *
   * @example
   * ```bash
   * curl -X PATCH http://localhost:3000/api/v1/entidades/150 \
   *   -H 'Content-Type: application/json' \
   *   -d '{"email":"novo@empresa.com"}'
   * ```
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza entidade (PATCH semântico)' })
  @ApiParam({ name: 'id', description: 'Chave primária da DEntidade', example: '150' })
  @ApiBody({ type: UpdateEntidadeDto })
  @ApiResponse({ status: 200, description: 'Entidade atualizada', type: EntidadeResponseDto })
  @ApiResponse({ status: 404, description: 'Entidade não encontrada' })
  async atualizar(
    @Param('id', ParseBigIntPipe) id: bigint,
    @Body() dto: UpdateEntidadeDto,
  ): Promise<EntidadeResponseDto> {
    return this.entidadeService.atualizar(id.toString(), dto);
  }

  /**
   * Soft-delete de entidade (marca excluido=true, sem DELETE físico).
   *
   * @param id - Chave primária da DEntidade
   *
   * @throws {NotFoundException} Se entidade não encontrada
   *
   * @example
   * ```bash
   * curl -X DELETE http://localhost:3000/api/v1/entidades/150
   * ```
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete de entidade (excluido=true)' })
  @ApiParam({ name: 'id', description: 'Chave primária da DEntidade', example: '150' })
  @ApiResponse({ status: 204, description: 'Entidade excluída (soft-delete)' })
  @ApiResponse({ status: 404, description: 'Entidade não encontrada' })
  async remover(@Param('id', ParseBigIntPipe) id: bigint): Promise<void> {
    return this.entidadeService.softDelete(id.toString());
  }
}

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
import { TabelaService } from './tabelas.service';
import { AuthCompositeGuard } from '../auth/guards/auth-composite.guard';
import { OrgTenantGuard } from '../auth/guards/org-tenant.guard';
import { ParseBigIntPipe } from '../common/pipes/parse-bigint.pipe';
import { ListTabelaQueryDto } from './dto/list-tabela-query.dto';
import { CreateTabelaDto } from './dto/create-tabela.dto';
import { UpdateTabelaDto } from './dto/update-tabela.dto';
import { TabelaResponseDto } from './dto/tabela-response.dto';
import { ListTabelaResponseDto } from './dto/list-tabela-response.dto';

/**
 * Controller genérico canônico para DTabela (Pilar 2 — Endpoints Genéricos).
 *
 * Serve TODOS os lookups, configs e catálogos via `?idClasse=N`:
 * - GET /tabelas?idClasse=-440 → Statuses V3 (INBOX, READY, EXECUTING, ...)
 * - GET /tabelas?idClasse=-400 → Sprints
 * - GET /tabelas?idClasse=-420 → Prioridades
 * - GET /tabelas?idClasse=-430 → Task Types
 * - GET /tabelas?idClasse=-470 → Webhooks
 * - GET /tabelas?idClasse=-471 → API Keys
 * - GET /tabelas?idClasse=-472 → MCP Keys
 *
 * @see TabelaService para lógica de negócio
 * @see ADR-V2-015 para convenção ?idClasse vs ?classe
 */
@ApiTags('tabelas')
@ApiBearerAuth()
@ApiHeader({ name: 'X-API-Key', required: false, description: 'API Key alternativa ao JWT' })
@UseGuards(AuthCompositeGuard, OrgTenantGuard)
@Controller('tabelas')
export class TabelaController {
  constructor(private readonly tabelaService: TabelaService) {}

  /**
   * Lista tabelas paginadas filtradas por classe.
   *
   * @param query - Filtros e paginação (idClasse obrigatório)
   * @param res - Response Express para headers de deprecation
   * @returns Lista paginada
   *
   * @example
   * ```bash
   * curl 'http://localhost:3000/api/v1/tabelas?idClasse=-440'
   * # retorna 9 Statuses V3 do seed
   * ```
   */
  @Get()
  @ApiOperation({
    summary: 'Lista tabelas/lookups por classe (Pilar 2 — endpoint genérico)',
    description: 'Serve Sprints, Statuses, Prioridades, Webhooks, API Keys via ?idClasse=N.',
  })
  @ApiQuery({ name: 'idClasse', required: false, description: 'ID da DClasse. Ex: -440 (Status V3), -400 (Sprint)', example: '-440' })
  @ApiQuery({ name: 'classe', required: false, description: '[DEPRECATED] Código da DClasse. Use idClasse.', deprecated: true })
  @ApiQuery({ name: 'nome', required: false, description: 'Filtro por nome (parcial)' })
  @ApiQuery({ name: 'dEntidadeId', required: false, description: 'Filtro por entidade dona' })
  @ApiQuery({ name: 'cursor', required: false, description: 'Cursor para próxima página' })
  @ApiQuery({ name: 'pageSize', required: false, description: 'Itens por página (default 20, max 100)', example: 20 })
  @ApiResponse({ status: 200, description: 'Lista retornada', type: ListTabelaResponseDto })
  @ApiResponse({ status: 400, description: 'Parâmetro idClasse ausente ou inválido' })
  @ApiResponse({ status: 404, description: 'DClasse não encontrada' })
  async listar(
    @Query() query: ListTabelaQueryDto,
    @Res({ passthrough: true }) res: Response,
  ): Promise<ListTabelaResponseDto> {
    return this.tabelaService.listarPorClasse(query, res);
  }

  /**
   * Busca tabela/lookup por ID.
   *
   * @param id - Chave primária da DTabela
   * @returns TabelaResponseDto
   *
   * @throws {NotFoundException} Se não encontrada ou excluída
   */
  @Get(':id')
  @ApiOperation({ summary: 'Busca tabela/lookup por ID' })
  @ApiParam({ name: 'id', description: 'Chave primária da DTabela', example: '1' })
  @ApiResponse({ status: 200, description: 'Tabela encontrada', type: TabelaResponseDto })
  @ApiResponse({ status: 404, description: 'Tabela não encontrada' })
  async findOne(@Param('id', ParseBigIntPipe) id: bigint): Promise<TabelaResponseDto> {
    return this.tabelaService.buscarPorId(id.toString());
  }

  /**
   * Cria novo lookup/config.
   *
   * @param dto - Dados do novo registro
   * @returns TabelaResponseDto criada (201)
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/api/v1/tabelas \
   *   -H 'Content-Type: application/json' \
   *   -d '{"idClasse":"-400","nome":"Sprint 1","codigo":"SPR-001"}'
   * ```
   */
  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Cria novo lookup/config' })
  @ApiBody({ type: CreateTabelaDto })
  @ApiResponse({ status: 201, description: 'Criado', type: TabelaResponseDto })
  @ApiResponse({ status: 400, description: 'Dados inválidos' })
  @ApiResponse({ status: 404, description: 'DClasse não encontrada' })
  async criar(@Body() dto: CreateTabelaDto): Promise<TabelaResponseDto> {
    return this.tabelaService.criar(dto);
  }

  /**
   * Atualiza lookup/config (PATCH semântico).
   *
   * @param id - Chave primária da DTabela
   * @param dto - Campos a atualizar
   * @returns TabelaResponseDto atualizada
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Atualiza lookup/config (PATCH semântico)' })
  @ApiParam({ name: 'id', description: 'Chave primária', example: '1' })
  @ApiBody({ type: UpdateTabelaDto })
  @ApiResponse({ status: 200, description: 'Atualizado', type: TabelaResponseDto })
  @ApiResponse({ status: 404, description: 'Não encontrado' })
  async atualizar(
    @Param('id', ParseBigIntPipe) id: bigint,
    @Body() dto: UpdateTabelaDto,
  ): Promise<TabelaResponseDto> {
    return this.tabelaService.atualizar(id.toString(), dto);
  }

  /**
   * Soft-delete de lookup/config.
   *
   * @param id - Chave primária da DTabela
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Soft-delete de lookup/config' })
  @ApiParam({ name: 'id', description: 'Chave primária', example: '1' })
  @ApiResponse({ status: 204, description: 'Excluído (soft-delete)' })
  @ApiResponse({ status: 404, description: 'Não encontrado' })
  async remover(@Param('id', ParseBigIntPipe) id: bigint): Promise<void> {
    return this.tabelaService.softDelete(id.toString());
  }
}

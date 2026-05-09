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
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ProjectsService } from './projects.service';
import { ProjectActivityService } from './project-activity.service';
import { CreateProjectDto } from './dto/create-project.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import {
  ProjectResponseDto,
  ListProjectResponseDto,
  ListProjectActivityResponseDto,
  ProjectStatsDto,
} from './dto/project-response.dto';
import { ProjectActivityQueryDto } from './dto/project-activity-query.dto';

/**
 * Controller de projetos (DProject).
 *
 * Expõe CRUD completo de projetos com RBAC via DVincula (-171/-172/-173).
 * Rotas de membros delegam ao ProjectMembersController.
 *
 * Todos os endpoints requerem autenticação JWT.
 * RBAC é verificado nos services (MANAGER para criar/editar/deletar).
 *
 * @see ProjectsService — lógica de negócio
 * @see ProjectMembersController — gestão de membros
 */
@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects')
export class ProjectsController {
  private readonly logger = new Logger(ProjectsController.name);

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly activityService: ProjectActivityService,
  ) {}

  /**
   * Cria novo projeto com seed de statuses V3 e sprint default.
   *
   * Requer autenticação JWT. O criador torna-se MANAGER automaticamente.
   *
   * @param dto - Dados do projeto
   * @param req - Request com user.entidadeId
   * @returns ProjectResponseDto com memberCount=1
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/api/v1/projects \
   *   -H "Authorization: Bearer {token}" \
   *   -d '{"nome":"Scrumban V2","prefix":"DEV"}'
   * ```
   */
  @Post()
  @ApiOperation({ summary: 'Criar projeto', description: 'Cria projeto com 9 statuses V3 e Sprint 1 default. O criador torna-se MANAGER.' })
  @ApiResponse({ status: 201, description: 'Projeto criado', type: ProjectResponseDto })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  async create(
    @Body() dto: CreateProjectDto,
    @Request() req: { user: { entidadeId: string } },
  ): Promise<ProjectResponseDto> {
    this.logger.log(`POST /projects — user=${req.user.entidadeId}`);
    return this.projectsService.create(dto, BigInt(req.user.entidadeId));
  }

  /**
   * Lista projetos onde o usuário é membro (qualquer role).
   *
   * Cursor pagination via query param `cursor`.
   *
   * @example
   * ```bash
   * curl http://localhost:3000/api/v1/projects?limit=20 \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Get()
  @ApiOperation({ summary: 'Listar projetos do usuário' })
  @ApiQuery({ name: 'cursor', required: false, description: 'Cursor de paginação' })
  @ApiQuery({ name: 'limit', required: false, description: 'Itens por página (1-100)', example: 20 })
  @ApiResponse({ status: 200, description: 'Lista de projetos', type: ListProjectResponseDto })
  async findMany(
    @Request() req: { user: { entidadeId: string } },
    @Query('cursor') cursor?: string,
    @Query('limit') limit?: string,
  ): Promise<ListProjectResponseDto> {
    return this.projectsService.findMany(
      BigInt(req.user.entidadeId),
      cursor,
      limit ? parseInt(limit, 10) : 20,
    );
  }

  /**
   * Busca projeto por ID.
   *
   * @param id - ID do projeto (chave DProject)
   */
  @Get(':id')
  @ApiOperation({ summary: 'Buscar projeto por ID' })
  @ApiParam({ name: 'id', description: 'ID do projeto', example: '1' })
  @ApiResponse({ status: 200, description: 'Projeto encontrado', type: ProjectResponseDto })
  @ApiResponse({ status: 404, description: 'Projeto não encontrado' })
  @ApiResponse({ status: 403, description: 'Acesso negado' })
  async findOne(
    @Param('id') id: string,
    @Request() req: { user: { entidadeId: string } },
  ): Promise<ProjectResponseDto> {
    return this.projectsService.findOne(id, BigInt(req.user.entidadeId));
  }

  /**
   * Atualiza projeto parcialmente (PATCH).
   *
   * Apenas MANAGER pode atualizar.
   *
   * @param id - ID do projeto
   * @param dto - Campos a atualizar
   */
  @Patch(':id')
  @ApiOperation({ summary: 'Atualizar projeto (MANAGER)' })
  @ApiParam({ name: 'id', description: 'ID do projeto' })
  @ApiResponse({ status: 200, description: 'Projeto atualizado', type: ProjectResponseDto })
  @ApiResponse({ status: 403, description: 'Requer role MANAGER' })
  @ApiResponse({ status: 404, description: 'Projeto não encontrado' })
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateProjectDto,
    @Request() req: { user: { entidadeId: string } },
  ): Promise<ProjectResponseDto> {
    return this.projectsService.update(id, dto, BigInt(req.user.entidadeId));
  }

  /**
   * Soft-delete do projeto (MANAGER).
   *
   * Cascades em tasks e memberships.
   *
   * @param id - ID do projeto
   */
  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Deletar projeto (MANAGER)' })
  @ApiParam({ name: 'id', description: 'ID do projeto' })
  @ApiResponse({ status: 204, description: 'Projeto deletado' })
  @ApiResponse({ status: 403, description: 'Requer role MANAGER' })
  @ApiResponse({ status: 404, description: 'Projeto não encontrado' })
  async delete(
    @Param('id') id: string,
    @Request() req: { user: { entidadeId: string } },
  ): Promise<void> {
    await this.projectsService.delete(id, BigInt(req.user.entidadeId));
  }

  /**
   * Retorna timeline de atividades do projeto (DEvento).
   *
   * Cursor pagination decrescente por chave.
   *
   * @param id - ID do projeto
   * @param query - Cursor + limit
   */
  @Get(':id/activity')
  @ApiOperation({ summary: 'Timeline de atividades do projeto' })
  @ApiParam({ name: 'id', description: 'ID do projeto' })
  @ApiResponse({ status: 200, description: 'Lista de eventos', type: ListProjectActivityResponseDto })
  async getActivity(
    @Param('id') id: string,
    @Query() query: ProjectActivityQueryDto,
  ): Promise<ListProjectActivityResponseDto> {
    return this.activityService.getActivity(id, query);
  }

  /**
   * Retorna contadores de tasks por status V3 do projeto.
   *
   * @param id - ID do projeto
   */
  @Get(':id/stats')
  @ApiOperation({ summary: 'Contadores de tasks por status V3' })
  @ApiParam({ name: 'id', description: 'ID do projeto' })
  @ApiResponse({ status: 200, description: 'Estatísticas do projeto', type: ProjectStatsDto })
  async getStats(
    @Param('id') id: string,
    @Request() req: { user: { entidadeId: string } },
  ): Promise<ProjectStatsDto> {
    return this.projectsService.getStats(id, BigInt(req.user.entidadeId));
  }
}

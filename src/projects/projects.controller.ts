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
import { AuthCompositeGuard } from '../auth/guards/auth-composite.guard';
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
import { ListProjectsQueryDto } from './dto/list-projects-query.dto';

/**
 * Tipo do payload populado em `req.user` pelo JwtStrategy.
 * `organizationId` pode ser ausente em JWT órfão (ADR-V2-038).
 */
interface JwtRequest {
  user: { entidadeId: string; organizationId?: string };
}

/**
 * Controller de projetos (DProject).
 *
 * Expõe CRUD completo de projetos com RBAC via DVincula (-171/-172/-173).
 * Rotas de membros delegam ao ProjectMembersController.
 *
 * Todos os endpoints requerem autenticação. Migrado para `AuthCompositeGuard`
 * (ADR-V2-042) para herdar defesa em profundidade: orphan workspace
 * (`RequireWorkspaceGuard`) + tenant isolation (`OrgTenantGuard`). Os
 * services tambem cruzam `DProject.idEstab` com `JWT.organizationId` para
 * defesa #2 (filtro no banco).
 *
 * @see ProjectsService — lógica de negócio
 * @see ProjectMembersController — gestão de membros
 * @see ADR-V2-042 — defesa em profundidade de tenant isolation
 */
@ApiTags('projects')
@ApiBearerAuth()
@UseGuards(AuthCompositeGuard)
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
  @ApiOperation({
    summary: 'Criar projeto',
    description: 'Cria projeto com 9 statuses V3 e Sprint 1 default. O criador torna-se MANAGER.',
  })
  @ApiResponse({ status: 201, description: 'Projeto criado', type: ProjectResponseDto })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  async create(
    @Body() dto: CreateProjectDto,
    @Request() req: JwtRequest,
  ): Promise<ProjectResponseDto> {
    this.logger.log(`POST /projects — user=${req.user.entidadeId} org=${req.user.organizationId}`);
    // Se o DTO nao traz orgId, herdamos o orgId do JWT (multi-tenant correto).
    const dtoWithOrg: CreateProjectDto = {
      ...dto,
      orgId: dto.orgId ?? req.user.organizationId,
    };
    return this.projectsService.create(dtoWithOrg, BigInt(req.user.entidadeId));
  }

  /**
   * Lista projetos onde o usuário é membro **dentro da org ativa**.
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
  @ApiOperation({
    summary: 'Listar projetos do usuário (org ativa)',
    description:
      'Lista projetos onde o usuário é membro E que pertencem à org do JWT. ' +
      'Aceita `teamId` opcional para filtrar por DVincula -182 (ADR-V2-029).',
  })
  @ApiQuery({ name: 'cursor', required: false, description: 'Cursor de paginação' })
  @ApiQuery({
    name: 'limit',
    required: false,
    description: 'Itens por página (1-100)',
    example: 20,
  })
  @ApiQuery({
    name: 'teamId',
    required: false,
    description: 'Filtra projetos vinculados ao time (DVincula -182)',
    example: '200',
  })
  @ApiResponse({ status: 200, description: 'Lista de projetos', type: ListProjectResponseDto })
  async findMany(
    @Request() req: JwtRequest,
    @Query() query: ListProjectsQueryDto,
  ): Promise<ListProjectResponseDto> {
    return this.projectsService.findMany(BigInt(req.user.entidadeId), {
      cursor: query.cursor,
      limit: query.limit ?? 20,
      teamId: query.teamId,
      organizationId: req.user.organizationId,
    });
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
  async findOne(@Param('id') id: string, @Request() req: JwtRequest): Promise<ProjectResponseDto> {
    return this.projectsService.findOne(id, BigInt(req.user.entidadeId), req.user.organizationId);
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
    @Request() req: JwtRequest,
  ): Promise<ProjectResponseDto> {
    return this.projectsService.update(
      id,
      dto,
      BigInt(req.user.entidadeId),
      req.user.organizationId,
    );
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
  async delete(@Param('id') id: string, @Request() req: JwtRequest): Promise<void> {
    await this.projectsService.delete(id, BigInt(req.user.entidadeId), req.user.organizationId);
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
  @ApiResponse({
    status: 200,
    description: 'Lista de eventos',
    type: ListProjectActivityResponseDto,
  })
  async getActivity(
    @Param('id') id: string,
    @Query() query: ProjectActivityQueryDto,
    @Request() req: JwtRequest,
  ): Promise<ListProjectActivityResponseDto> {
    // Tenant + membership check antes de qualquer agregacao
    await this.projectsService.findOne(id, BigInt(req.user.entidadeId), req.user.organizationId);
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
  async getStats(@Param('id') id: string, @Request() req: JwtRequest): Promise<ProjectStatsDto> {
    return this.projectsService.getStats(id, BigInt(req.user.entidadeId), req.user.organizationId);
  }
}

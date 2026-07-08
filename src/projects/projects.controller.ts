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
import { CreateFromTemplateDto } from './dto/create-from-template.dto';
import { PromoteToTemplateDto } from './dto/promote-to-template.dto';
import { UpdateProjectDto } from './dto/update-project.dto';
import {
  ProjectResponseDto,
  ListProjectResponseDto,
  ListProjectActivityResponseDto,
  ProjectStatsDto,
} from './dto/project-response.dto';
import { ProjectActivityQueryDto } from './dto/project-activity-query.dto';
import { ListProjectsQueryDto } from './dto/list-projects-query.dto';
import { DeleteProjectResponseDto } from './dto/delete-project-response.dto';

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
   * Cria novo projeto com seed de statuses V3.
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
    description: 'Cria projeto com 9 statuses V3. O criador torna-se MANAGER.',
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
  @ApiQuery({
    name: 'idClasse',
    required: false,
    description:
      'Filtra por idClasse do DProject. Ex: -350=SPACE, -351=FOLDER, -352=LIST, -353=DOC. ' +
      '-401/-402 ativam o CATÁLOGO de templates (visibilidade dedicada: org ativa + globais).',
    example: '-350',
  })
  @ApiQuery({
    name: 'idPai',
    required: false,
    description: 'Filtra projetos cujo DProject.idPai é igual a este valor.',
    example: '100',
  })
  @ApiQuery({
    name: 'privado',
    required: false,
    description:
      'Filtra pelo campo privado. true=apenas privados, false=apenas públicos. Ausente=sem filtro.',
    example: 'false',
  })
  @ApiQuery({
    name: 'categoria',
    required: false,
    description:
      'Catálogo de templates: filtra por dados.categoria. Só aplica quando idClasse é -401/-402.',
    example: 'onboarding',
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
      idClasse: query.idClasse,
      idPai: query.idPai,
      privado: query.privado,
      categoria: query.categoria,
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
   * Cascades em tasks e memberships. Retorna 200 com contadores do cascade
   * para que o frontend exiba feedback rico ao usuário (ex.: "Projeto X
   * excluído — 12 intenções, 3 membros").
   *
   * @param id - ID do projeto
   * @returns DTO com `deleted`, `id`, `projectName` e `counts`.
   */
  @Delete(':id')
  @ApiOperation({ summary: 'Deletar projeto (MANAGER)' })
  @ApiParam({ name: 'id', description: 'ID do projeto' })
  @ApiResponse({ status: 200, description: 'Projeto deletado', type: DeleteProjectResponseDto })
  @ApiResponse({ status: 403, description: 'Requer role MANAGER' })
  @ApiResponse({ status: 404, description: 'Projeto não encontrado' })
  async delete(
    @Param('id') id: string,
    @Request() req: JwtRequest,
  ): Promise<DeleteProjectResponseDto> {
    return this.projectsService.delete(id, BigInt(req.user.entidadeId), req.user.organizationId);
  }

  /**
   * Duplica o projeto como esqueleto (MANAGER).
   *
   * Copia a hierarquia inteira abaixo do nó (Space→Folders→Lists ou
   * Folder→Lists) + os BLOCOS/FASES de cada List, mas NÃO as tasks de
   * trabalho. A cópia nasce no mesmo nível, com sufixo " (cópia)" no nome do
   * nó raiz.
   *
   * @param id - ID do projeto a duplicar
   * @returns ProjectResponseDto do novo projeto raiz
   */
  @Post(':id/duplicate')
  @ApiOperation({ summary: 'Duplicar projeto como esqueleto (MANAGER)' })
  @ApiParam({ name: 'id', description: 'ID do projeto a duplicar' })
  @ApiResponse({ status: 201, description: 'Projeto duplicado', type: ProjectResponseDto })
  @ApiResponse({ status: 403, description: 'Requer role MANAGER' })
  @ApiResponse({ status: 404, description: 'Projeto não encontrado' })
  async duplicate(
    @Param('id') id: string,
    @Request() req: JwtRequest,
  ): Promise<ProjectResponseDto> {
    return this.projectsService.duplicate(id, BigInt(req.user.entidadeId), req.user.organizationId);
  }

  /**
   * Cria um projeto (List/Space) a partir de um TEMPLATE (Sub-fase 4a — escopo
   * ORG, feature Templates / ADR-V2-061).
   *
   * O `:id` é um DProject-template (idClasse -401 TEMPLATE_LIST ou -402
   * TEMPLATE_SPACE) DA org ativa. O resultado é a árvore inteira materializada:
   * DClasse remapeada para a real (-401→-352 LIST, -402→-350 SPACE), blocos e
   * tasks copiados (molde-limpo: INBOX, sem assignee/prazo, novo identifier
   * DEV-N), com `idEstab` carimbado na org ativa. O executante vira MANAGER.
   *
   * Acesso (4a): template deve ser da org ativa (global idEstab NULL é 4b — cai
   * em 404 aqui). MANAGER exigido no DESTINO (idPai); para TEMPLATE_SPACE sem
   * destino, basta ser membro da org.
   *
   * @param id - ID do template a materializar.
   * @param dto - Opções (includeTasks/novoNome/novoIcone/idPai).
   * @returns ProjectResponseDto do nó raiz materializado (myRole=MANAGER).
   *
   * @example
   * ```bash
   * curl -X POST "http://localhost:3000/projects/401/from-template" \
   *   -H "Authorization: Bearer {token}" \
   *   -H "Content-Type: application/json" \
   *   -d '{ "novoNome": "Onboarding Cliente X", "idPai": "123" }'
   * ```
   */
  @Post(':id/from-template')
  @ApiOperation({ summary: 'Criar List/Space a partir de um template (MANAGER no destino)' })
  @ApiParam({
    name: 'id',
    description: 'ID do template (-401 TEMPLATE_LIST / -402 TEMPLATE_SPACE)',
  })
  @ApiResponse({ status: 201, description: 'Projeto materializado', type: ProjectResponseDto })
  @ApiResponse({ status: 400, description: 'Não é template / destino incompatível' })
  @ApiResponse({ status: 403, description: 'Requer MANAGER no destino (ou membro da org)' })
  @ApiResponse({ status: 404, description: 'Template/destino não encontrado (ou de outra org)' })
  async createFromTemplate(
    @Param('id') id: string,
    @Body() dto: CreateFromTemplateDto,
    @Request() req: JwtRequest,
  ): Promise<ProjectResponseDto> {
    return this.projectsService.createFromTemplate(
      id,
      BigInt(req.user.entidadeId),
      req.user.organizationId,
      dto,
    );
  }

  /**
   * Promove um projeto (List/Space) real a Template reutilizável (extensão da
   * feature Templates — ADR-V2-062).
   *
   * O `:id` é um DProject real (idClasse -352 LIST ou -350 SPACE). O
   * resultado é uma CÓPIA da árvore inteira: DClasse remapeada para o
   * template (-352→-401 LIST, -350→-402 SPACE), blocos copiados, tasks de
   * trabalho NÃO copiadas (molde-limpo), `dados.categoria` gravado na raiz
   * (obrigatório, texto livre) e `idEstab` carimbado na org ativa. O projeto
   * original permanece intacto (CÓPIA, não mutação).
   *
   * Exige MANAGER na origem (herdado de `cloneTree`, sem reimplementar).
   *
   * @param id - ID do projeto (List -352 ou Space -350) a promover.
   * @param dto - Categoria obrigatória + nome opcional (ver {@link PromoteToTemplateDto}).
   * @returns ProjectResponseDto do template resultante (myRole=MANAGER).
   *
   * @example
   * ```bash
   * curl -X POST "http://localhost:3000/projects/108/promote-to-template" \
   *   -H "Authorization: Bearer {token}" \
   *   -H "Content-Type: application/json" \
   *   -d '{ "categoria": "Desenvolvimento", "novoNome": "Molde QA E2E" }'
   * ```
   */
  @Post(':id/promote-to-template')
  @ApiOperation({ summary: 'Promover List/Space a Template reutilizável (MANAGER na origem)' })
  @ApiParam({ name: 'id', description: 'ID do projeto (List -352 ou Space -350) a promover' })
  @ApiResponse({ status: 201, description: 'Template criado (cópia)', type: ProjectResponseDto })
  @ApiResponse({
    status: 400,
    description: 'Origem incompatível (não é List/Space) ou categoria ausente',
  })
  @ApiResponse({ status: 403, description: 'Requer role MANAGER na origem' })
  @ApiResponse({ status: 404, description: 'Projeto não encontrado' })
  async promoteToTemplate(
    @Param('id') id: string,
    @Body() dto: PromoteToTemplateDto,
    @Request() req: JwtRequest,
  ): Promise<ProjectResponseDto> {
    return this.projectsService.promoteToTemplate(
      id,
      BigInt(req.user.entidadeId),
      req.user.organizationId,
      dto,
    );
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

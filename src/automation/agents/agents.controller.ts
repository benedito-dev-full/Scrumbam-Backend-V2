import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AuthCompositeGuard } from '../../auth/guards/auth-composite.guard';
import { SkipTenantCheck } from '../../auth/decorators/skip-tenant-check.decorator';
import { AgentInstallTokenService } from './agent-install-token.service';
import { AgentsService } from './agents.service';
import {
  GenerateInstallTokenDto,
  GenerateInstallTokenResponseDto,
} from './dto/generate-install-token.dto';
import { InstallAgentDto, InstallAgentResponseDto } from './dto/install-agent.dto';
import { HeartbeatDto, HeartbeatResponseDto } from './dto/heartbeat.dto';
import { ExecutionResultDto, ExecutionResultResponseDto } from './dto/execution-result.dto';
import {
  AgentProjectsResponseDto,
  LinkAgentProjectDto,
  LinkAgentProjectResponseDto,
  UnlinkAgentProjectResponseDto,
} from './dto/link-agent-project.dto';
import { AgentListItemDto, ListAgentsQueryDto } from './dto/list-agents.dto';
import { AgentAuthGuard, AgentAuthenticatedRequest } from './guards/agent-auth.guard';

interface JwtRequest {
  user: { entidadeId: string; organizationId?: string };
}

@ApiTags('automation-agents')
@Controller('agents')
export class AgentsController {
  constructor(
    private readonly installTokenService: AgentInstallTokenService,
    private readonly agentsService: AgentsService,
  ) {}

  /**
   * Lista todos os agents (DEntidade -156) da organizacao ativa do usuario
   * autenticado (ADR-V2-042). Status calculado em runtime via `dados.lastSeen`
   * (janela 90s para online). Filtros opcionais: `status` e `search` por
   * nome/hostname.
   */
  @Get()
  @UseGuards(AuthCompositeGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar agents da organizacao (scopado por idEstab)' })
  @ApiResponse({ status: 200, type: [AgentListItemDto] })
  @ApiResponse({ status: 401, description: 'JWT inválido/ausente' })
  async listAgents(
    @Query() query: ListAgentsQueryDto,
    @Request() req: JwtRequest,
  ): Promise<AgentListItemDto[]> {
    return this.agentsService.listAgents(
      { status: query.status, search: query.search },
      req.user.organizationId,
    );
  }

  /**
   * Gera token one-shot para instalacao de agente (com ou sem projeto vinculado).
   *
   * Comportamentos:
   * - Com `projectId`: validação RBAC (usuário MANAGER do projeto OU ADMIN da org)
   * - Sem `projectId` (standalone): qualquer usuário autenticado JWT pode gerar
   */
  @Post('install-token')
  @UseGuards(AuthCompositeGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Gerar token one-shot de instalacao de agent',
    description:
      'Cria token para instalar agente standalone (sem projeto) ou vinculado a projeto específico',
  })
  @ApiResponse({ status: 201, type: GenerateInstallTokenResponseDto })
  @ApiResponse({ status: 401, description: 'JWT inválido/ausente' })
  @ApiResponse({ status: 403, description: 'Usuário sem permissão no projeto' })
  @ApiResponse({ status: 404, description: 'Projeto não encontrado' })
  async generateInstallToken(
    @Body() dto: GenerateInstallTokenDto,
    @Request() req: JwtRequest,
  ): Promise<GenerateInstallTokenResponseDto> {
    const result = await this.installTokenService.createInstallToken(
      dto.projectId !== undefined && dto.projectId !== null && dto.projectId !== ''
        ? BigInt(dto.projectId)
        : null,
      BigInt(req.user.entidadeId),
    );
    return {
      token: result.token,
      installTokenId: result.installTokenId.toString(),
      expiresAt: result.expiresAt.toISOString(),
    };
  }

  /**
   * Instala agente usando token one-shot. Endpoint chamado pelo agente na VPS
   * apos o operador executar `install.sh` — autenticacao via install-token,
   * NAO via JWT/sessao do usuario. Cross-org by design (motivo: token
   * carrega o `createdBy` e projectId opcional; o agente cria DEntidade com
   * `idEstab` herdado do projeto, se vinculado).
   */
  @Post('install')
  @SkipTenantCheck() // Motivo: install-token e o vetor de auth, nao JWT.
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Instalar agent usando token one-shot' })
  @ApiResponse({ status: 201, type: InstallAgentResponseDto })
  async install(@Body() dto: InstallAgentDto): Promise<InstallAgentResponseDto> {
    return this.agentsService.install(dto);
  }

  /**
   * Heartbeat do agente — autenticado por HMAC + nonce via `AgentAuthGuard`.
   * Cross-org by design (motivo: agentes nao tem JWT; o guard valida o vinculo
   * agente↔chave e o handler garante isolation por agentId).
   */
  @Post(':id/heartbeat')
  @SkipTenantCheck() // Motivo: AgentAuthGuard isola por agentId via HMAC.
  @HttpCode(HttpStatus.OK)
  @UseGuards(AgentAuthGuard)
  @ApiOperation({ summary: 'Registrar heartbeat autenticado do agent' })
  @ApiParam({ name: 'id', description: 'ID do agent' })
  @ApiResponse({ status: 200, type: HeartbeatResponseDto })
  async heartbeat(
    @Param('id') _id: string,
    @Body() dto: HeartbeatDto,
    @Request() req: AgentAuthenticatedRequest,
  ): Promise<HeartbeatResponseDto> {
    return this.agentsService.heartbeat(req.agent!, dto);
  }

  /**
   * Callback inbound: agente V2 reporta outcome de execução Claude Code.
   * Cross-org by design — autenticado por HMAC, isolation interna no handler
   * via agentId/DPedido.dados.audit.
   */
  @Post(':id/execution-result')
  @SkipTenantCheck() // Motivo: AgentAuthGuard + isolation por agentId.
  @HttpCode(HttpStatus.OK)
  @UseGuards(AgentAuthGuard)
  @ApiOperation({
    summary: 'Callback inbound: agente reporta outcome de execução Claude Code',
    description:
      'Persiste claudeSessionId/exitCode/stdout via Engine OperacaoExecucaoClaude. ' +
      'Idempotente por executionId. Materializa DEventos agent.execution.finished|failed ' +
      'e agent.session.created|resumed.',
  })
  @ApiParam({ name: 'id', description: 'ID do agente (deve casar com x-agent-id header)' })
  @ApiResponse({
    status: 200,
    type: ExecutionResultResponseDto,
    description: 'Outcome registrado (ou alreadyPersisted=true em chamada duplicada)',
  })
  @ApiResponse({ status: 401, description: 'HMAC inválido/ausente ou timestamp fora da janela' })
  @ApiResponse({ status: 403, description: 'Agente não autorizado para esta execução (isolation)' })
  @ApiResponse({ status: 404, description: 'executionId não encontrado em DPedido' })
  @ApiResponse({
    status: 400,
    description: 'DPedido.idClasse fora de {-301,-302,-303} ou executionId inválido',
  })
  @ApiResponse({ status: 409, description: 'Nonce HMAC repetido (replay protection)' })
  @ApiResponse({ status: 422, description: 'Payload inválido (class-validator)' })
  async recordExecutionResult(
    @Param('id') id: string,
    @Body() dto: ExecutionResultDto,
    @Request() req: AgentAuthenticatedRequest,
  ): Promise<ExecutionResultResponseDto> {
    return this.agentsService.recordExecutionResult({
      agentId: id,
      agentEntity: req.agent!,
      dto,
    });
  }

  /**
   * Vincula um agente existente a um projeto (multi-project linking).
   * Idempotente. RBAC: MANAGER do projeto OU ADMIN da org dona (validado no service).
   */
  @Post(':id/projects')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Vincular projeto a agente existente (multi-project)',
    description:
      'Cria DVincula -185 entre agente (DEntidade -156) e projeto (DProject). ' +
      'Idempotente: chamada duplicada retorna alreadyLinked=true.',
  })
  @ApiParam({ name: 'id', description: 'ID do agente (DEntidade -156)' })
  @ApiResponse({
    status: 200,
    type: LinkAgentProjectResponseDto,
    description: 'Vinculo criado (ou alreadyLinked=true em idempotencia)',
  })
  @ApiResponse({ status: 401, description: 'JWT invalido/ausente' })
  @ApiResponse({
    status: 403,
    description: 'Usuario sem permissao (requer MANAGER projeto ou ADMIN org)',
  })
  @ApiResponse({ status: 404, description: 'Agente ou projeto nao encontrado' })
  async linkProject(
    @Param('id') id: string,
    @Body() dto: LinkAgentProjectDto,
    @Request() req: JwtRequest,
  ): Promise<LinkAgentProjectResponseDto> {
    return this.agentsService.linkProject(
      BigInt(id),
      BigInt(dto.projectId),
      BigInt(req.user.entidadeId),
    );
  }

  /**
   * Remove (soft-delete) o vinculo entre um agente e um projeto.
   */
  @Delete(':id/projects/:projectId')
  @HttpCode(HttpStatus.OK)
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Remover vinculo agente-projeto (soft-delete)',
    description: 'Soft-delete da DVincula -185 (excluido=true).',
  })
  @ApiParam({ name: 'id', description: 'ID do agente (DEntidade -156)' })
  @ApiParam({ name: 'projectId', description: 'ID do projeto (DProject)' })
  @ApiResponse({ status: 200, type: UnlinkAgentProjectResponseDto })
  @ApiResponse({ status: 401, description: 'JWT invalido/ausente' })
  @ApiResponse({ status: 403, description: 'Usuario sem permissao' })
  @ApiResponse({ status: 404, description: 'Agente, projeto ou vinculo nao encontrado' })
  async unlinkProject(
    @Param('id') id: string,
    @Param('projectId') projectId: string,
    @Request() req: JwtRequest,
  ): Promise<UnlinkAgentProjectResponseDto> {
    return this.agentsService.unlinkProject(
      BigInt(id),
      BigInt(projectId),
      BigInt(req.user.entidadeId),
    );
  }

  /**
   * Lista todos os projetos vinculados ativos a um agente.
   */
  @Get(':id/projects')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Listar projetos vinculados ao agente',
    description: 'Retorna lista de projetos ativos (DVincula -185 nao excluida).',
  })
  @ApiParam({ name: 'id', description: 'ID do agente (DEntidade -156)' })
  @ApiResponse({ status: 200, type: AgentProjectsResponseDto })
  @ApiResponse({ status: 401, description: 'JWT invalido/ausente' })
  @ApiResponse({ status: 404, description: 'Agente nao encontrado' })
  async listProjects(
    @Param('id') id: string,
    @Request() req: JwtRequest,
  ): Promise<AgentProjectsResponseDto> {
    return this.agentsService.listAgentProjects(BigInt(id), BigInt(req.user.entidadeId));
  }
}

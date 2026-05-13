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
  user: { entidadeId: string };
}

@ApiTags('automation-agents')
@Controller('agents')
export class AgentsController {
  constructor(
    private readonly installTokenService: AgentInstallTokenService,
    private readonly agentsService: AgentsService,
  ) {}

  /**
   * Gera token one-shot para instalacao de agente (com ou sem projeto vinculado).
   *
   * Endpoint protegido via JWT. Permite criar um token para instalar um agente standalone
   * (sem projeto) ou vinculado a um projeto específico.
   *
   * Comportamentos:
   * - Com `projectId`: validação RBAC (usuário MANAGER do projeto OU ADMIN da org)
   * - Sem `projectId` (standalone): qualquer usuário autenticado JWT pode gerar
   *   (agente fica órfão, link para projetos criado depois via POST /agents/:id/projects)
   *
   * @param dto - DTO com `projectId` opcional (string contendo BigInt)
   * @param req - Request autenticado com JWT (extrai `entidadeId` do user)
   * @returns Token one-shot com TTL 15min
   *
   * @throws {UnauthorizedException} Quando JWT ausente ou inválido
   * @throws {ForbiddenException} Quando `projectId` fornecido e usuário sem role de MANAGER/ADMIN
   * @throws {NotFoundException} Quando `projectId` fornecido mas projeto não existe
   *
   * @example
   * ```bash
   * # Gerar token com projeto vinculado (RBAC validado)
   * curl -X POST http://localhost:3000/api/v1/agents/install-token \
   *   -H "Authorization: Bearer $TOKEN" \
   *   -H "Content-Type: application/json" \
   *   -d '{"projectId":"123"}'
   * ```
   *
   * @example
   * ```bash
   * # Gerar token standalone (nenhuma validação RBAC além de autenticação)
   * curl -X POST http://localhost:3000/api/v1/agents/install-token \
   *   -H "Authorization: Bearer $TOKEN" \
   *   -H "Content-Type: application/json" \
   *   -d '{}'
   * ```
   *
   * @example
   * ```json
   * // Response (201 Created)
   * {
   *   "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
   *   "installTokenId": "789",
   *   "expiresAt": "2026-05-12T15:30:00Z"
   * }
   * ```
   */
  /**
   * Lista todos os agents (DEntidade -156) visíveis ao usuário autenticado.
   * Status calculado em runtime via `dados.lastSeen` (janela 90s para online).
   * Filtros opcionais: `status` e `search` por nome/hostname.
   */
  @Get()
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Listar agents da organizacao' })
  @ApiResponse({ status: 200, type: [AgentListItemDto] })
  @ApiResponse({ status: 401, description: 'JWT inválido/ausente' })
  async listAgents(@Query() query: ListAgentsQueryDto): Promise<AgentListItemDto[]> {
    return this.agentsService.listAgents({ status: query.status, search: query.search });
  }

  @Post('install-token')
  @UseGuards(JwtAuthGuard)
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
    @Request() req: { user: { entidadeId: string } },
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

  @Post('install')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Instalar agent usando token one-shot' })
  @ApiResponse({ status: 201, type: InstallAgentResponseDto })
  async install(@Body() dto: InstallAgentDto): Promise<InstallAgentResponseDto> {
    return this.agentsService.install(dto);
  }

  @Post(':id/heartbeat')
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
   *
   * Disparado pelo agente após `POST /v1/execute` retornar e a execução terminar.
   * Payload contém claudeSessionId, exitCode, stdout/stderr truncados e (opcionalmente)
   * o caminho INTERNAL do .jsonl da sessão (para audit no backend, não exposto ao frontend).
   *
   * Segurança:
   *   - HMAC + nonce + rate limit via AgentAuthGuard (mesmo guard de /heartbeat)
   *   - Isolation: o handler valida que o agente autenticado === agente registrado
   *     na execução (DPedido.dados.audit.agentId) — previne forja cross-projeto
   *   - Idempotência: mesmo executionId em 2 chamadas retorna alreadyPersisted=true
   *
   * Pilar 1 (Engine): a persistência usa OperacaoExecucaoClaude.registrarOutcome();
   * ZERO `prisma.dPedido.update` direto neste handler/service.
   *
   * @see ADR-V2-033
   * @see ADR-V2-005 (Engine para DPedido transacional)
   * @see ADR-V2-032 (claudeSessionId em DPedido.dados.claude)
   *
   * @example
   * ```bash
   * curl -X POST "https://api/agents/100/execution-result" \
   *   -H "Content-Type: application/json" \
   *   -H "x-agent-id: 100" -H "x-agent-key: <secret>" \
   *   -H "x-agent-nonce: <uuid>" -H "x-agent-timestamp: <iso8601>" \
   *   -d '{"executionId":"4815","exitCode":0,"success":true,"durationMs":12450,
   *        "claudeSessionId":"a1b2c3d4-5678-4abc-9def-0123456789ab",
   *        "claudeSessionPath":"/home/agent/.claude/projects/x/sess.jsonl",
   *        "resumedFrom":null,"stdoutTruncated":"...","stderrTruncated":""}'
   * ```
   */
  @Post(':id/execution-result')
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
   *
   * Endpoint protegido via JWT. Idempotente: se vinculo ja existe ativo,
   * retorna `alreadyLinked: true` sem criar duplicata. Permite vincular
   * o MESMO agente a varios projetos via N chamadas — o modelo de dados
   * (DVincula -185) e N:N por design.
   *
   * RBAC: usuario deve ser MANAGER do projeto OU ADMIN da org dona.
   *
   * @param id - ID do agente no path param (string com BigInt)
   * @param dto - Body com `projectId` (string com BigInt)
   * @param req - JWT authenticated request (entidadeId do usuario)
   * @returns LinkAgentProjectResponseDto com `{ agentId, projectId, linked, alreadyLinked? }`
   *
   * @throws {NotFoundException} Agente ou projeto nao existe
   * @throws {ForbiddenException} Usuario sem permissao (nao MANAGER projeto, nao ADMIN org)
   * @throws {UnauthorizedException} JWT invalido/ausente
   *
   * @example
   * ```bash
   * curl -X POST http://localhost:3000/api/v1/agents/100/projects \
   *   -H "Authorization: Bearer $TOKEN" \
   *   -H "Content-Type: application/json" \
   *   -d '{"projectId":"123"}'
   * ```
   *
   * @example
   * ```json
   * // Response 200 (vinculo criado)
   * { "agentId": "100", "projectId": "123", "linked": true }
   *
   * // Response 200 (vinculo ja existia — idempotente)
   * { "agentId": "100", "projectId": "123", "linked": true, "alreadyLinked": true }
   * ```
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
   *
   * Endpoint protegido via JWT. Soft-delete (`excluido=true`) — preserva
   * audit trail. Hard-delete NAO suportado.
   *
   * RBAC: usuario deve ser MANAGER do projeto OU ADMIN da org dona.
   *
   * @param id - ID do agente no path param
   * @param projectId - ID do projeto no path param
   * @param req - JWT authenticated request
   * @returns UnlinkAgentProjectResponseDto com `{ agentId, projectId, unlinked: true }`
   *
   * @throws {NotFoundException} Agente, projeto ou vinculo nao existe
   * @throws {ForbiddenException} Usuario sem permissao
   * @throws {UnauthorizedException} JWT invalido/ausente
   *
   * @example
   * ```bash
   * curl -X DELETE http://localhost:3000/api/v1/agents/100/projects/123 \
   *   -H "Authorization: Bearer $TOKEN"
   * ```
   *
   * @example
   * ```json
   * // Response 200
   * { "agentId": "100", "projectId": "123", "unlinked": true }
   * ```
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
   *
   * Endpoint protegido via JWT. Retorna lista (pode ser vazia para
   * agente standalone sem vinculos). Performance: 2 queries fixas
   * (DVincula + batch DProject IN) — ZERO N+1 independente da cardinalidade.
   *
   * Permissao: qualquer usuario autenticado JWT pode listar (decisao
   * pragmatica MVP — revisitar em F14 se necessario).
   *
   * @param id - ID do agente no path param
   * @param req - JWT authenticated request
   * @returns AgentProjectsResponseDto com `{ agentId, projects: [...] }`
   *
   * @throws {NotFoundException} Agente nao existe
   * @throws {UnauthorizedException} JWT invalido/ausente
   *
   * @example
   * ```bash
   * curl -X GET http://localhost:3000/api/v1/agents/100/projects \
   *   -H "Authorization: Bearer $TOKEN"
   * ```
   *
   * @example
   * ```json
   * {
   *   "agentId": "100",
   *   "projects": [
   *     { "projectId": "123", "nome": "Backend", "idEstab": "50" },
   *     { "projectId": "124", "nome": "Frontend", "idEstab": "50" }
   *   ]
   * }
   * ```
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

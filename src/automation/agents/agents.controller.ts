import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
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
import { AgentAuthGuard, AgentAuthenticatedRequest } from './guards/agent-auth.guard';

@ApiTags('automation-agents')
@Controller('agents')
export class AgentsController {
  constructor(
    private readonly installTokenService: AgentInstallTokenService,
    private readonly agentsService: AgentsService,
  ) {}

  @Post('install-token')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Gerar token one-shot de instalacao de agent' })
  @ApiResponse({ status: 201, type: GenerateInstallTokenResponseDto })
  async generateInstallToken(
    @Body() dto: GenerateInstallTokenDto,
    @Request() req: { user: { entidadeId: string } },
  ): Promise<GenerateInstallTokenResponseDto> {
    const result = await this.installTokenService.createInstallToken(
      BigInt(dto.projectId),
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
}

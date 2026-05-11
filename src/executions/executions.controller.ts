import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
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
import { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ExecutionsService } from './executions.service';
import { ApprovalFlowService } from './approval-flow.service';
import { ExecutionHistoryService } from './execution-history.service';
import { ExecutionAccessGuard } from './guards/execution-access.guard';
import { ExecutionThrottlerGuard } from './guards/execution-throttler.guard';
import { IdempotencyGuard } from './guards/idempotency.guard';

import { ExecuteCommandDto } from './dto/execute-command.dto';
import { ExecutionResponseDto } from './dto/execution-response.dto';
import { ApproveExecutionDto } from './dto/approve-execution.dto';
import { RejectExecutionDto } from './dto/reject-execution.dto';
import { ListExecutionsQueryDto } from './dto/list-executions-query.dto';

/** Interface auxiliar para req.user tipado (Passport JWT payload) */
interface RequestWithUser extends Request {
  user?: {
    sub?: string;
    entidadeId?: string;
    userId?: string;
    [key: string]: unknown;
  };
}

/** Helper para extrair userId do JWT payload */
function getUserId(req: RequestWithUser): string {
  return (
    req.user?.sub ??
    req.user?.userId ??
    req.user?.entidadeId ??
    '0'
  );
}

/**
 * ExecutionsController — endpoints de Automation Claude Code.
 *
 * Orquestra ExecutionsService (criação via Engine), ApprovalFlowService
 * (approve/reject/rollback) e ExecutionHistoryService (listagem/busca).
 *
 * JUSTIFICATIVA controller próprio (Pilar 2):
 * Não duplica /pedidos genérico — lógica de Engine + approval flow multi-step
 * + throttle por projeto + rollback com nova execution HIGH é domínio específico.
 *
 * @see ADR-V2-005 (OperacaoExecucaoClaude extends OperacaoPedido)
 * @see ADR-V2-006 (risk via idClasse -301/-302/-303)
 */
@ApiTags('executions')
@ApiBearerAuth()
@Controller()
@UseGuards(JwtAuthGuard)
export class ExecutionsController {
  constructor(
    private readonly executionsService: ExecutionsService,
    private readonly approvalFlowService: ApprovalFlowService,
    private readonly historyService: ExecutionHistoryService,
  ) {}

  /**
   * Executa comando Claude Code no projeto.
   *
   * Classifica risco via DVFS chave 3 (Risk Gate):
   * - LOW: auto-aprovado + executado imediatamente
   * - MEDIUM: auto-aprovado + executado imediatamente
   * - HIGH: persiste em awaiting_approval (exige POST .../approve)
   *
   * Bloco C (F13): adicionado IdempotencyGuard para prevenir execuções duplicadas.
   *
   * @param projectId - ID do projeto
   * @param dto - Comando e opções
   * @param req - Request com user JWT
   * @returns ExecutionResponseDto (201)
   *
   * @throws {400} Comando inválido ou perigoso (CommandValidatorService)
   * @throws {403} Sem membership no projeto
   * @throws {409} Idempotency-Key duplicada
   * @throws {422} Agente não configurado no projeto
   * @throws {429} Rate limit: 30 execuções/min por projeto
   *
   * @example
   * ```bash
   * curl -X POST /api/v1/projects/123/execute \
   *   -H "Authorization: Bearer {token}" \
   *   -d '{"text": "adicione testes para AuthService"}'
   * ```
   */
  @Post('projects/:id/execute')
  @UseGuards(ExecutionAccessGuard, ExecutionThrottlerGuard, IdempotencyGuard)
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Executar comando Claude Code no projeto' })
  @ApiParam({ name: 'id', description: 'ID do projeto (BigInt como string)', example: '123' })
  @ApiResponse({ status: 201, description: 'Execution criada', type: ExecutionResponseDto })
  @ApiResponse({ status: 400, description: 'Comando inválido ou perigoso' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Sem acesso ao projeto' })
  @ApiResponse({ status: 409, description: 'Idempotency-Key duplicada' })
  @ApiResponse({ status: 422, description: 'Agente não configurado no projeto' })
  @ApiResponse({ status: 429, description: 'Rate limit: 30 execuções/min por projeto' })
  async execute(
    @Param('id') projectId: string,
    @Body() dto: ExecuteCommandDto,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Req() req: RequestWithUser,
  ): Promise<ExecutionResponseDto> {
    return this.executionsService.execute(projectId, dto, getUserId(req), idempotencyKey);
  }

  /**
   * Busca execution por ID.
   *
   * @param id - ID da execution (BigInt como string)
   * @param req - Request com user JWT
   * @returns ExecutionResponseDto (200)
   *
   * @throws {404} Execution não encontrada ou sem acesso
   *
   * @example
   * ```bash
   * curl /api/v1/executions/1000001 -H "Authorization: Bearer {token}"
   * ```
   */
  @Get('executions/:id')
  @UseGuards(ExecutionAccessGuard)
  @ApiOperation({ summary: 'Buscar execution por ID' })
  @ApiParam({ name: 'id', description: 'ID da execution (BigInt como string)', example: '1000001' })
  @ApiResponse({ status: 200, description: 'Execution encontrada', type: ExecutionResponseDto })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 404, description: 'Execution não encontrada ou sem acesso' })
  async findOne(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
  ): Promise<ExecutionResponseDto> {
    const userEntidadeId = getUserId(req);
    return this.historyService.findOne(id, userEntidadeId);
  }

  /**
   * Lista executions do projeto com cursor pagination e filtros.
   *
   * @param query - Filtros: projectId (obrigatório), status?, riskLevel?, cursor?, limit?
   * @param req - Request com user JWT
   * @returns Lista paginada com nextCursor
   *
   * @example
   * ```bash
   * curl "/api/v1/executions?projectId=123&riskLevel=HIGH&limit=20" \
   *   -H "Authorization: Bearer {token}"
   * ```
   */
  @Get('executions')
  @ApiOperation({ summary: 'Listar executions com filtros e cursor pagination' })
  @ApiQuery({ name: 'projectId', required: true, description: 'ID do projeto' })
  @ApiQuery({ name: 'status', required: false, enum: ['queued', 'awaiting_approval', 'approved', 'rejected', 'expired'] })
  @ApiQuery({ name: 'riskLevel', required: false, enum: ['LOW', 'MEDIUM', 'HIGH'] })
  @ApiQuery({ name: 'cursor', required: false, description: 'Cursor para paginação' })
  @ApiQuery({ name: 'limit', required: false, description: 'Itens por página (default: 20)' })
  @ApiResponse({ status: 200, description: 'Lista paginada de executions' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Sem acesso ao projeto' })
  async findMany(
    @Query() query: ListExecutionsQueryDto,
    @Req() req: RequestWithUser,
  ): Promise<{ items: ExecutionResponseDto[]; nextCursor?: string }> {
    const userEntidadeId = getUserId(req);
    return this.historyService.findMany(query, userEntidadeId);
  }

  /**
   * Aprova uma execution em awaiting_approval (apenas PROJECT_MANAGER).
   *
   * Race-safe: apenas o primeiro admin que chamar vence (409 para o segundo).
   *
   * @param id - ID da execution
   * @param dto - Notas opcionais
   * @param req - Request com user JWT
   * @returns ExecutionResponseDto com status 'approved'
   *
   * @throws {400} Execution não está em awaiting_approval
   * @throws {403} Sem papel de PROJECT_MANAGER
   * @throws {404} Execution não encontrada
   * @throws {409} Outro admin já decidiu (race condition)
   *
   * @example
   * ```bash
   * curl -X POST /api/v1/executions/1000001/approve \
   *   -H "Authorization: Bearer {token}" \
   *   -d '{"notes": "Revisado e aprovado"}'
   * ```
   */
  @Post('executions/:id/approve')
  @UseGuards(ExecutionAccessGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aprovar execution em awaiting_approval (PROJECT_MANAGER)' })
  @ApiParam({ name: 'id', description: 'ID da execution', example: '1000001' })
  @ApiResponse({ status: 200, description: 'Execution aprovada e em execução', type: ExecutionResponseDto })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Sem papel de PROJECT_MANAGER' })
  @ApiResponse({ status: 404, description: 'Execution não encontrada' })
  @ApiResponse({ status: 409, description: 'Conflito: outro admin já decidiu' })
  async approve(
    @Param('id') id: string,
    @Body() dto: ApproveExecutionDto,
    @Req() req: RequestWithUser,
  ): Promise<ExecutionResponseDto> {
    return this.approvalFlowService.approve(id, getUserId(req), dto);
  }

  /**
   * Rejeita uma execution em awaiting_approval (apenas PROJECT_MANAGER).
   *
   * @param id - ID da execution
   * @param dto - Motivo obrigatório
   * @param req - Request com user JWT
   * @returns ExecutionResponseDto com status 'rejected'
   *
   * @throws {400} Execution não está em awaiting_approval
   * @throws {403} Sem papel de PROJECT_MANAGER
   * @throws {404} Execution não encontrada
   * @throws {409} Outro admin já decidiu
   *
   * @example
   * ```bash
   * curl -X POST /api/v1/executions/1000001/reject \
   *   -H "Authorization: Bearer {token}" \
   *   -d '{"reason": "Operação irreversível no banco de produção"}'
   * ```
   */
  @Post('executions/:id/reject')
  @UseGuards(ExecutionAccessGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rejeitar execution em awaiting_approval (PROJECT_MANAGER)' })
  @ApiParam({ name: 'id', description: 'ID da execution', example: '1000001' })
  @ApiResponse({ status: 200, description: 'Execution rejeitada', type: ExecutionResponseDto })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Sem papel de PROJECT_MANAGER' })
  @ApiResponse({ status: 404, description: 'Execution não encontrada' })
  @ApiResponse({ status: 409, description: 'Conflito: outro admin já decidiu' })
  async reject(
    @Param('id') id: string,
    @Body() dto: RejectExecutionDto,
    @Req() req: RequestWithUser,
  ): Promise<ExecutionResponseDto> {
    return this.approvalFlowService.reject(id, getUserId(req), dto);
  }
  /**
   * Rollback manual legado desabilitado.
   *
   * Rollback automatico ocorre apenas no runtime isolado com rollbackOnFailure.
   *
   * @throws {400} Rollback manual legado desabilitado
   */
  @Post('executions/:id/rollback')
  @UseGuards(ExecutionAccessGuard)
  @HttpCode(HttpStatus.BAD_REQUEST)
  @ApiOperation({ summary: 'Rollback manual legado desabilitado' })
  @ApiParam({ name: 'id', description: 'ID da execution original', example: '1000001' })
  @ApiResponse({ status: 400, description: 'Rollback manual legado desabilitado' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Sem papel de PROJECT_MANAGER' })
  @ApiResponse({ status: 404, description: 'Execution não encontrada' })
  async rollback(
    @Param('id') id: string,
    @Req() req: RequestWithUser,
  ): Promise<ExecutionResponseDto> {
    return this.approvalFlowService.rollback(id, getUserId(req));
  }

  /**
   * Verifica status de credencial Claude no projeto (STUB).
   *
   * @param id - ID do projeto
   * @returns Status de configuração
   */
  @Get('projects/:id/claude-credential-status')
  @UseGuards(ExecutionAccessGuard)
  @ApiOperation({ summary: 'Verificar status de credencial Claude no projeto (STUB)' })
  @ApiParam({ name: 'id', description: 'ID do projeto', example: '123' })
  @ApiResponse({ status: 200, description: 'Status da credencial' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Sem acesso ao projeto' })
  async claudeCredentialStatus(
    @Param('id') _id: string,
  ): Promise<{ configured: boolean; checkedAt: string }> {
    // STUB F6 — F13 implementará verificação real de credenciais SSH/API
    return {
      configured: false,
      checkedAt: new Date().toISOString(),
    };
  }

  /**
   * Retorna instruções para configurar token Claude no projeto.
   *
   * @param id - ID do projeto
   * @returns Instruções em Markdown
   */
  @Get('projects/:id/claude-token-instructions')
  @UseGuards(ExecutionAccessGuard)
  @ApiOperation({ summary: 'Obter instruções de configuração do token Claude' })
  @ApiParam({ name: 'id', description: 'ID do projeto', example: '123' })
  @ApiResponse({ status: 200, description: 'Instruções em Markdown' })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Sem acesso ao projeto' })
  async claudeTokenInstructions(
    @Param('id') id: string,
  ): Promise<{ markdown: string }> {
    const markdown = `
# Configuração do Claude Code Agent

Para ativar execuções Claude Code no projeto ${id}, configure o agente remoto:

## Pré-requisitos

1. Um servidor VPS com acesso ao repositório Git do projeto
2. Claude Code CLI instalado no servidor (\`npm install -g @anthropic-ai/claude-code\`)

## Configuração (F13)

A configuração do agente SSH reverso será disponibilizada na **Fase F13**.

Por enquanto, as execuções usam o STUB que simula respostas do agente.

## Status atual

- STUB ativo: todas execuções retornam resultado simulado
- SSH reverso: pendente (F13)
- PR auto-open: pendente (F12)

Para mais informações, consulte \`docs/plano/02-DOMINIO-ENGINE.md §6.7\`.
`.trim();

    return { markdown };
  }
}

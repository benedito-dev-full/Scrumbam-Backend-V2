import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Put,
  Request,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AgentEnvService } from './agent-env.service';
import { SetAgentEnvDto } from './dto/set-agent-env.dto';
import { SetGitBotDto } from './dto/set-git-bot.dto';
import { EnvStatusResponseDto } from './dto/env-status-response.dto';

interface JwtRequest {
  user: { entidadeId: string };
}

/**
 * Controller V2 para gestao de credenciais e identidade Git no agente
 * via API HTTP (substitui SSH manual). Endpoints:
 *
 *  - `PUT /agents/:id/env` — atualiza PAT/ANTHROPIC_KEY no env file
 *    (ADMIN org).
 *  - `GET /agents/:id/env-status` — le booleanos `hasGithubToken/hasAnthropicKey`
 *    + `lastEnvUpdatedAt` (autenticado).
 *  - `PUT /agents/:id/git-bot` — atualiza `gitBotName/Email` (ADMIN org).
 *
 * Backend NUNCA persiste plaintext de credencial — apenas dispara escrita
 * atomica no agente via HMAC outbound (`SET_ENV`).
 *
 * @see ADR-V2-041 (Env Management via API outbound HMAC)
 */
@ApiTags('automation-agent-env')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('agents/:id')
export class AgentEnvController {
  constructor(private readonly agentEnvService: AgentEnvService) {}

  /**
   * Atualiza credenciais sensiveis (PAT GitHub, ANTHROPIC_KEY) no env
   * file do agente via HMAC outbound. Backend NUNCA persiste plaintext.
   *
   * Apos a escrita bem-sucedida, o agente reinicia o servico para
   * carregar o novo env (`systemctl restart self`). O endpoint retorna
   * 200 com o `envStatus` atualizado (booleanos + lastEnvUpdatedAt).
   *
   * @param id - ID do agente (DEntidade -156) no path
   * @param dto - Body com `githubToken?`, `anthropicApiKey?`, `anthropicAuthToken?`
   * @returns Status atualizado (booleanos)
   *
   * @throws {UnauthorizedException} JWT invalido/ausente
   * @throws {ForbiddenException} Usuario nao e ADMIN da org dona
   * @throws {NotFoundException} Agente nao existe
   * @throws {BadRequestException} DTO vazio
   * @throws {ServiceUnavailableException} Agente offline / HMAC falha
   *
   * @example
   * ```bash
   * curl -X PUT https://api/agents/32/env \
   *   -H "Authorization: Bearer $TOKEN" \
   *   -H "Content-Type: application/json" \
   *   -d '{"githubToken":"ghp_xxx","anthropicApiKey":"sk-ant-xxx"}'
   * ```
   */
  @Put('env')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Atualizar credenciais sensiveis no env file do agente (HMAC outbound)',
    description:
      'Dispara SET_ENV outbound. Backend NUNCA persiste plaintext. Atualiza dados.envStatus.',
  })
  @ApiParam({ name: 'id', description: 'ID do agente (DEntidade -156)' })
  @ApiResponse({ status: 200, type: EnvStatusResponseDto, description: 'envStatus atualizado' })
  @ApiResponse({ status: 400, description: 'DTO vazio (nenhum campo preenchido)' })
  @ApiResponse({ status: 401, description: 'JWT invalido/ausente' })
  @ApiResponse({ status: 403, description: 'Usuario nao e ADMIN da org dona do agent' })
  @ApiResponse({ status: 404, description: 'Agente nao encontrado' })
  @ApiResponse({
    status: 503,
    description: 'Agente offline ou HMAC falhou — credencial nao escrita',
  })
  async setEnv(
    @Param('id') id: string,
    @Body() dto: SetAgentEnvDto,
    @Request() req: JwtRequest,
  ): Promise<EnvStatusResponseDto> {
    return this.agentEnvService.setEnv(BigInt(id), dto, BigInt(req.user.entidadeId));
  }

  /**
   * Le o `envStatus` atual do agente (booleanos + lastEnvUpdatedAt).
   *
   * NAO faz chamada outbound. Permissao: qualquer usuario JWT
   * autenticado (dados nao-sensiveis).
   *
   * @example
   * ```bash
   * curl https://api/agents/32/env-status -H "Authorization: Bearer $TOKEN"
   * # → {"hasGithubToken":true,"hasAnthropicKey":true,"lastEnvUpdatedAt":"2026-05-13T18:42:00Z"}
   * ```
   */
  @Get('env-status')
  @ApiOperation({ summary: 'Status das credenciais do agente (booleanos)' })
  @ApiParam({ name: 'id', description: 'ID do agente' })
  @ApiResponse({ status: 200, type: EnvStatusResponseDto })
  @ApiResponse({ status: 401, description: 'JWT invalido/ausente' })
  @ApiResponse({ status: 404, description: 'Agente nao encontrado' })
  async getEnvStatus(
    @Param('id') id: string,
    @Request() req: JwtRequest,
  ): Promise<EnvStatusResponseDto> {
    return this.agentEnvService.getEnvStatus(BigInt(id), BigInt(req.user.entidadeId));
  }

  /**
   * Atualiza identidade do bot Git (name + email) no agente.
   *
   * Dispara `SET_ENV` outbound para reescrever `GIT_BOT_NAME` e
   * `GIT_BOT_EMAIL`. Persiste tambem em `dados` (plaintext OK — dados
   * publicos via `git log`).
   *
   * @example
   * ```bash
   * curl -X PUT https://api/agents/32/git-bot \
   *   -H "Authorization: Bearer $TOKEN" \
   *   -d '{"name":"Scrumban Bot","email":"bot@scrumban.app"}'
   * ```
   */
  @Put('git-bot')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Atualizar identidade do bot Git (HMAC outbound)',
    description: 'Persiste em dados.gitBotName/Email + dispara SET_ENV com GIT_BOT_NAME/EMAIL.',
  })
  @ApiParam({ name: 'id', description: 'ID do agente' })
  @ApiResponse({ status: 200, description: 'git-bot atualizado' })
  @ApiResponse({ status: 401, description: 'JWT invalido/ausente' })
  @ApiResponse({ status: 403, description: 'Usuario nao e ADMIN da org dona' })
  @ApiResponse({ status: 404, description: 'Agente nao encontrado' })
  @ApiResponse({ status: 503, description: 'Agente offline' })
  async setGitBot(
    @Param('id') id: string,
    @Body() dto: SetGitBotDto,
    @Request() req: JwtRequest,
  ): Promise<{ name: string; email: string; updatedAt: string }> {
    return this.agentEnvService.setGitBot(BigInt(id), dto, BigInt(req.user.entidadeId));
  }
}

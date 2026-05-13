import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Request,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiPropertyOptional,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength } from 'class-validator';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { DeployKeyService } from './deploy-key.service';
import { DeployKeyResponseDto } from './dto/deploy-key-response.dto';

interface JwtRequest {
  user: { entidadeId: string };
}

/**
 * DTO opcional para `POST .../deploy-key`. Permite passar um `comment`
 * customizado (default: `scrumban-agent@<projectSlug>`).
 */
class GenerateDeployKeyDto {
  @ApiPropertyOptional({
    description: 'Comentario do ssh-keygen (`-C` flag). Default: scrumban-agent@<slug>',
    example: 'scrumban-agent@my-project',
    maxLength: 256,
  })
  @IsOptional()
  @IsString()
  @MaxLength(256)
  comment?: string;
}

/**
 * Controller V2 para gestao de Deploy Key SSH per-projeto/per-agent
 * (ADR-V2-042). Endpoints:
 *
 *  - `POST /projects/:id/agent/:agentId/deploy-key` — gera/regenera
 *    (MANAGER projeto OU ADMIN org).
 *  - `GET /projects/:id/agent/:agentId/deploy-key` — le persistida em
 *    metaDados (membro do projeto).
 *  - `DELETE /projects/:id/agent/:agentId/deploy-key` — soft-revoke
 *    (apaga campos do metaDados — arquivo da chave continua na VPS).
 *
 * Privada NUNCA sai da VPS. Backend persiste apenas pubkey + fingerprint
 * + lastDeployKeyGeneratedAt em `DVincula -185 metaDados`.
 */
@ApiTags('automation-deploy-key')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects/:id/agent/:agentId/deploy-key')
export class DeployKeyController {
  constructor(private readonly deployKeyService: DeployKeyService) {}

  /**
   * Gera (ou regenera idempotente) deploy key SSH ed25519 no agent para
   * o projectSlug do vinculo. Dispara `GENERATE_DEPLOY_KEY` outbound.
   *
   * Idempotente: se a chave ja existe no agent, e reusada (alreadyExisted=true).
   *
   * @example
   * ```bash
   * curl -X POST https://api/projects/20/agent/32/deploy-key \
   *   -H "Authorization: Bearer $TOKEN" \
   *   -d '{"comment":"scrumban-agent@my-project"}'
   * ```
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Gerar/regenerar deploy key SSH per-projeto (HMAC outbound)',
    description:
      'Dispara GENERATE_DEPLOY_KEY no agent. Privada NUNCA sai da VPS. ' +
      'Persiste pubkey + fingerprint em DVincula -185 metaDados.',
  })
  @ApiParam({ name: 'id', description: 'ID do projeto (DProject)' })
  @ApiParam({ name: 'agentId', description: 'ID do agente (DEntidade -156)' })
  @ApiBody({ type: GenerateDeployKeyDto, required: false })
  @ApiResponse({ status: 200, type: DeployKeyResponseDto })
  @ApiResponse({ status: 401, description: 'JWT invalido/ausente' })
  @ApiResponse({ status: 403, description: 'Requer MANAGER projeto ou ADMIN org' })
  @ApiResponse({ status: 404, description: 'Projeto, agent ou vinculo nao encontrado' })
  @ApiResponse({ status: 409, description: 'Vinculo sem projectSlug em metaDados' })
  @ApiResponse({ status: 503, description: 'Agent offline / HMAC falha' })
  async generateDeployKey(
    @Param('id') projectId: string,
    @Param('agentId') agentId: string,
    @Body() dto: GenerateDeployKeyDto,
    @Request() req: JwtRequest,
  ): Promise<DeployKeyResponseDto> {
    return this.deployKeyService.generateDeployKey(
      BigInt(projectId),
      BigInt(agentId),
      dto.comment,
      BigInt(req.user.entidadeId),
    );
  }

  /**
   * Le deploy key atualmente persistida em `metaDados` (sem outbound).
   * 404 se nunca foi gerada.
   */
  @Get()
  @ApiOperation({ summary: 'Ler deploy key atual (sem outbound)' })
  @ApiParam({ name: 'id', description: 'ID do projeto' })
  @ApiParam({ name: 'agentId', description: 'ID do agente' })
  @ApiResponse({ status: 200, type: DeployKeyResponseDto })
  @ApiResponse({ status: 401, description: 'JWT invalido/ausente' })
  @ApiResponse({ status: 403, description: 'Requer membro do projeto ou ADMIN org' })
  @ApiResponse({ status: 404, description: 'Deploy key nunca gerada' })
  async getDeployKey(
    @Param('id') projectId: string,
    @Param('agentId') agentId: string,
    @Request() req: JwtRequest,
  ): Promise<DeployKeyResponseDto> {
    return this.deployKeyService.getDeployKey(
      BigInt(projectId),
      BigInt(agentId),
      BigInt(req.user.entidadeId),
    );
  }

  /**
   * Revoga (soft) a deploy key — apaga `deployKeyPub/Fingerprint/lastDeployKeyGeneratedAt`
   * do `metaDados`. NAO chama o agent (cleanup manual aceitavel).
   */
  @Delete()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revogar deploy key (soft — apaga so do DB)',
    description:
      'Apaga campos da deploy key em metaDados. NAO chama agent — ' +
      'arquivo da chave continua na VPS ate operador apagar manualmente.',
  })
  @ApiParam({ name: 'id', description: 'ID do projeto' })
  @ApiParam({ name: 'agentId', description: 'ID do agente' })
  @ApiResponse({ status: 200, description: 'Deploy key revogada' })
  @ApiResponse({ status: 401, description: 'JWT invalido/ausente' })
  @ApiResponse({ status: 403, description: 'Requer MANAGER projeto ou ADMIN org' })
  @ApiResponse({ status: 404, description: 'Vinculo nao encontrado' })
  async revokeDeployKey(
    @Param('id') projectId: string,
    @Param('agentId') agentId: string,
    @Request() req: JwtRequest,
  ): Promise<{ revoked: true; revokedAt: string }> {
    return this.deployKeyService.revokeDeployKey(
      BigInt(projectId),
      BigInt(agentId),
      BigInt(req.user.entidadeId),
    );
  }
}

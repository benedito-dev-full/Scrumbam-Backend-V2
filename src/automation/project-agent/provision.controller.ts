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
import {
  ApiBearerAuth,
  ApiBody,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ProvisionRequestDto } from './dto/provision-request.dto';
import { ProvisionResponseDto } from './dto/provision-response.dto';
import { ProvisionService } from './provision.service';

interface JwtRequest {
  user: { entidadeId: string };
}

/**
 * Controller de provisionamento de projeto na VPS via agent.
 */
@ApiTags('automation-provision')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects/:id/agent/:agentId/provision')
export class ProvisionController {
  constructor(private readonly provisionService: ProvisionService) {}

  /**
   * Clona ou atualiza (`git pull`) o repositorio configurado em `DProject.repoUrl`
   * no diretório do `projectSlug` vinculado ao agente.
   */
  @Post()
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Provisionar repositório do projeto na VPS',
    description:
      'Dispara PROVISION_PROJECT no agent. Requer repoUrl valido no projeto e projectSlug no vinculo.',
  })
  @ApiParam({ name: 'id', description: 'ID do projeto (DProject)' })
  @ApiParam({ name: 'agentId', description: 'ID do agente (DEntidade -156)' })
  @ApiBody({ type: ProvisionRequestDto, required: false })
  @ApiResponse({ status: 200, type: ProvisionResponseDto })
  @ApiResponse({ status: 400, description: 'repoUrl ausente ou invalido' })
  @ApiResponse({ status: 401, description: 'JWT invalido/ausente' })
  @ApiResponse({ status: 403, description: 'Requer MANAGER projeto ou ADMIN org' })
  @ApiResponse({ status: 404, description: 'Projeto, agent ou vinculo nao encontrado' })
  @ApiResponse({ status: 409, description: 'Vinculo sem projectSlug ou pasta existe sem .git' })
  @ApiResponse({ status: 503, description: 'Agent offline, desatualizado ou ACK invalido' })
  async provision(
    @Param('id') projectId: string,
    @Param('agentId') agentId: string,
    @Body() dto: ProvisionRequestDto,
    @Request() req: JwtRequest,
  ): Promise<ProvisionResponseDto> {
    return this.provisionService.provision(
      BigInt(projectId),
      BigInt(agentId),
      dto?.useSshKey,
      BigInt(req.user.entidadeId),
    );
  }
}

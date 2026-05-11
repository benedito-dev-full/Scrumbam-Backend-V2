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
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { AgentInstallTokenService } from './agent-install-token.service';
import { AgentsService } from './agents.service';
import {
  GenerateInstallTokenDto,
  GenerateInstallTokenResponseDto,
} from './dto/generate-install-token.dto';
import { InstallAgentDto, InstallAgentResponseDto } from './dto/install-agent.dto';
import { HeartbeatDto, HeartbeatResponseDto } from './dto/heartbeat.dto';
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
}

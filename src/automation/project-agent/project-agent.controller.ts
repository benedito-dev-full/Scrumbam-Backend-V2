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
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { ProjectAgentLinkService } from './project-agent-link.service';
import { LinkAgentDto, LinkAgentResponseDto } from './dto/link-agent.dto';
import { ProjectAgentStatusResponseDto } from './dto/agent-status-response.dto';

interface JwtRequest {
  user: { entidadeId: string };
}

@ApiTags('automation-project-agent')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard)
@Controller('projects/:id/agent')
export class ProjectAgentController {
  constructor(private readonly projectAgentLinkService: ProjectAgentLinkService) {}

  @Post()
  @ApiOperation({ summary: 'Vincular agent a projeto como primary ou secondary' })
  @ApiParam({ name: 'id', description: 'ID do projeto' })
  @ApiResponse({ status: 201, type: LinkAgentResponseDto })
  @ApiResponse({ status: 403, description: 'Requer MANAGER do projeto ou ADMIN da org' })
  async linkAgent(
    @Param('id') projectId: string,
    @Body() dto: LinkAgentDto,
    @Request() req: JwtRequest,
  ): Promise<LinkAgentResponseDto> {
    return this.projectAgentLinkService.linkAgent(
      BigInt(projectId),
      BigInt(dto.agentId),
      dto.tipo,
      BigInt(req.user.entidadeId),
    );
  }

  @Delete(':agentId')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover vinculo project-agent' })
  @ApiParam({ name: 'id', description: 'ID do projeto' })
  @ApiParam({ name: 'agentId', description: 'ID do agent' })
  @ApiResponse({ status: 204, description: 'Vinculo removido' })
  @ApiResponse({ status: 409, description: 'Existe execution ativa para project/agent' })
  async unlinkAgent(
    @Param('id') projectId: string,
    @Param('agentId') agentId: string,
    @Request() req: JwtRequest,
  ): Promise<void> {
    await this.projectAgentLinkService.unlinkAgent(
      BigInt(projectId),
      BigInt(agentId),
      BigInt(req.user.entidadeId),
    );
  }

  @Get('status')
  @ApiOperation({ summary: 'Listar status operacional dos agents vinculados ao projeto' })
  @ApiParam({ name: 'id', description: 'ID do projeto' })
  @ApiResponse({ status: 200, type: ProjectAgentStatusResponseDto })
  @ApiResponse({ status: 403, description: 'Requer membro do projeto ou ADMIN da org' })
  async getStatus(
    @Param('id') projectId: string,
    @Request() req: JwtRequest,
  ): Promise<ProjectAgentStatusResponseDto> {
    return this.projectAgentLinkService.getStatus(
      BigInt(projectId),
      BigInt(req.user.entidadeId),
    );
  }
}

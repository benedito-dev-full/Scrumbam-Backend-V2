import {
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Body,
  Req,
  UnauthorizedException,
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
import { Request } from 'express';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { JwtPayload } from '../auth/decorators/current-user.decorator';
import { EntidadeService } from '../entidades/entidades.service';
import { CreateMcpKeyDto } from './dto/create-mcp-key.dto';
import { McpKeyCreatedResponseDto, McpKeyListItemDto } from './dto/mcp-key-response.dto';
import { McpEnabledGuard } from './guards/mcp-enabled.guard';
import { McpKeyService } from './services/mcp-key.service';

interface JwtRequest extends Request {
  user?: JwtPayload;
}

@ApiTags('MCP Keys')
@ApiBearerAuth()
@Controller('mcp/keys')
@UseGuards(McpEnabledGuard, JwtAuthGuard)
export class McpKeysController {
  constructor(
    private readonly mcpKeyService: McpKeyService,
    private readonly entidadeService: EntidadeService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Cria uma MCP Key para o usuário autenticado' })
  @ApiBody({ type: CreateMcpKeyDto })
  @ApiResponse({ status: 201, type: McpKeyCreatedResponseDto })
  async create(
    @Body() dto: CreateMcpKeyDto,
    @Req() request: JwtRequest,
  ): Promise<McpKeyCreatedResponseDto> {
    const dEntidadeId = await this.getCurrentDEntidadeId(request);
    return this.mcpKeyService.generate(dEntidadeId, dto.scopes ?? []);
  }

  @Get()
  @ApiOperation({ summary: 'Lista MCP Keys do usuário autenticado sem plaintext/hash' })
  @ApiResponse({ status: 200, type: [McpKeyListItemDto] })
  async list(@Req() request: JwtRequest): Promise<McpKeyListItemDto[]> {
    const dEntidadeId = await this.getCurrentDEntidadeId(request);
    return this.mcpKeyService.list(dEntidadeId);
  }

  @Delete(':id')
  @HttpCode(204)
  @ApiOperation({ summary: 'Revoga uma MCP Key do usuário autenticado' })
  @ApiParam({ name: 'id', description: 'ID da DTabela -472', example: '123' })
  @ApiResponse({ status: 204, description: 'Key revogada' })
  async revoke(@Param('id') id: string, @Req() request: JwtRequest): Promise<void> {
    const dEntidadeId = await this.getCurrentDEntidadeId(request);
    await this.mcpKeyService.revoke(dEntidadeId, BigInt(id));
  }

  private async getCurrentDEntidadeId(request: JwtRequest): Promise<bigint> {
    if (!request.user?.sub) {
      throw new UnauthorizedException('JWT obrigatório');
    }

    return this.entidadeService.getEntidadeIdFromUserGroup(BigInt(request.user.sub));
  }
}

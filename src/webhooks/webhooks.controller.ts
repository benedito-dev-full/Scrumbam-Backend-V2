import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { CreateWebhookDto } from './dto/create-webhook.dto';
import { ListAttemptsQueryDto } from './dto/list-attempts-query.dto';
import { ListWebhooksQueryDto } from './dto/list-webhooks-query.dto';
import { TestWebhookDto } from './dto/test-webhook.dto';
import { UpdateWebhookDto } from './dto/update-webhook.dto';
import {
  ListWebhookAttemptsResponseDto,
  ListWebhooksResponseDto,
  RedriveWebhookResponseDto,
  TestWebhookResponseDto,
  WebhookCreatedResponseDto,
  WebhookResponseDto,
} from './dto/webhook-response.dto';
import { WebhookOwnerGuard } from './guards/webhook-owner.guard';
import { WebhooksRedriveService } from './services/webhooks-redrive.service';
import { WebhooksService } from './services/webhooks.service';

@ApiTags('webhooks')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, WebhookOwnerGuard)
@Controller('webhooks')
export class WebhooksController {
  constructor(
    private readonly webhooksService: WebhooksService,
    private readonly redriveService: WebhooksRedriveService,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Criar webhook outbound' })
  @ApiResponse({ status: 201, type: WebhookCreatedResponseDto })
  create(@Body() dto: CreateWebhookDto): Promise<WebhookCreatedResponseDto> {
    return this.webhooksService.create(dto);
  }

  @Get()
  @ApiOperation({ summary: 'Listar webhooks por projeto' })
  @ApiResponse({ status: 200, type: ListWebhooksResponseDto })
  list(@Query() query: ListWebhooksQueryDto): Promise<ListWebhooksResponseDto> {
    return this.webhooksService.list(query);
  }

  @Get(':id')
  @ApiOperation({ summary: 'Buscar webhook por ID' })
  @ApiResponse({ status: 200, type: WebhookResponseDto })
  findOne(@Param('id') id: string): Promise<WebhookResponseDto> {
    return this.webhooksService.findOne(id);
  }

  @Post(':id/test')
  @ApiOperation({ summary: 'Executar teste sincrono do webhook' })
  @ApiResponse({ status: 200, type: TestWebhookResponseDto })
  test(@Param('id') id: string, @Body() dto: TestWebhookDto): Promise<TestWebhookResponseDto> {
    return this.redriveService.test(id, dto);
  }

  @Post(':id/redrive')
  @ApiOperation({ summary: 'Reabilitar webhook e zerar failureCount' })
  @ApiResponse({ status: 200, type: RedriveWebhookResponseDto })
  redrive(@Param('id') id: string): Promise<RedriveWebhookResponseDto> {
    return this.redriveService.redrive(id);
  }

  @Get(':id/attempts')
  @ApiOperation({ summary: 'Listar attempts do webhook com paginacao cursor' })
  @ApiResponse({ status: 200, type: ListWebhookAttemptsResponseDto })
  listAttempts(
    @Param('id') id: string,
    @Query() query: ListAttemptsQueryDto,
  ): Promise<ListWebhookAttemptsResponseDto> {
    return this.redriveService.listAttempts(id, query);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Atualizar webhook' })
  @ApiResponse({ status: 200, type: WebhookResponseDto })
  update(@Param('id') id: string, @Body() dto: UpdateWebhookDto): Promise<WebhookResponseDto> {
    return this.webhooksService.update(id, dto);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Remover webhook' })
  @ApiResponse({ status: 204 })
  async delete(@Param('id') id: string): Promise<void> {
    await this.webhooksService.delete(id);
  }
}

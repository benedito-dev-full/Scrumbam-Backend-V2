import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Logger,
  Post,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { TelegramSecretGuard } from './telegram-secret.guard';
import { TelegramWebhookService } from './telegram-webhook.service';
import { TelegramUpdateDto } from './dto/telegram-update.dto';

/**
 * Controller do webhook do Telegram.
 *
 * Responsabilidade única: receber o Update, validar o secret, retornar 200 rapidamente
 * e despachar processamento assíncrono via `setImmediate`.
 *
 * Rota: `POST /webhooks/telegram`
 * (Não `/channels/telegram` — o Telegram exige URL configurada via setWebhook)
 *
 * Segurança:
 * - Protegido por `TelegramSecretGuard` (header X-Telegram-Bot-Api-Secret-Token)
 * - Comparação em tempo constante (crypto.timingSafeEqual)
 *
 * Resposta rápida:
 * - Retorna 200 imediatamente após despachar `setImmediate`
 * - Processamento assíncrono em `TelegramWebhookService.handleUpdate`
 * - Erros de processamento são logados internamente, nunca propagam para o Telegram
 *
 * @see TelegramSecretGuard — validação do secret token
 * @see TelegramWebhookService — processamento do Update
 */
@ApiTags('Webhooks')
@Controller('webhooks')
export class TelegramWebhookController {
  private readonly logger = new Logger(TelegramWebhookController.name);

  constructor(private readonly webhookService: TelegramWebhookService) {}

  /**
   * Recebe Update do Telegram e despacha processamento assíncrono.
   *
   * O Telegram reenvia o Update caso o servidor retorne status != 200 ou não
   * responda em tempo hábil (<15s). Por isso:
   * - Retornamos 200 imediatamente após `setImmediate`
   * - Processamento ocorre em background (sem bloquear o response)
   * - Erros de processamento são logados internamente
   *
   * @param body - Update do Telegram validado pelo DTO
   *
   * @example
   * ```bash
   * curl -X POST https://myapp.com/webhooks/telegram \
   *   -H "X-Telegram-Bot-Api-Secret-Token: meu-secret" \
   *   -H "Content-Type: application/json" \
   *   -d '{"update_id": 123456789, "message": {"message_id": 42, "chat": {"id": 987, "type": "private"}, "text": "hello", "date": 1746000000}}'
   * ```
   */
  @Post('telegram')
  @UseGuards(TelegramSecretGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Webhook do Telegram',
    description:
      'Recebe Updates do Telegram. Protegido por X-Telegram-Bot-Api-Secret-Token. ' +
      'Retorna 200 imediatamente e processa em background.',
  })
  @ApiResponse({ status: 200, description: 'Update recebido e enfileirado para processamento' })
  @ApiResponse({ status: 403, description: 'Secret token inválido ou ausente' })
  handleWebhook(@Body() body: TelegramUpdateDto): void {
    // Despachar processamento assíncrono IMEDIATAMENTE — retornar 200 ao Telegram
    setImmediate(() => {
      this.webhookService.handleUpdate(body).catch((err) => {
        // Captura erros não tratados pelo service (double-safety)
        this.logger.error(
          `Erro não tratado em handleUpdate: update_id=${body.update_id} error=${(err as Error).message}`,
          (err as Error).stack,
        );
      });
    });
    // Void — NestJS enviará 200 com body vazio (HttpCode(200) definido acima)
  }
}

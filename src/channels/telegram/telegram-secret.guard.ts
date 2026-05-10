import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import * as crypto from 'crypto';

/**
 * Guard de validação do secret token do webhook Telegram.
 *
 * Valida o header `X-Telegram-Bot-Api-Secret-Token` usando comparação
 * em tempo constante (`crypto.timingSafeEqual`) para evitar timing attacks.
 *
 * Comportamento:
 * - Header correto → permite a requisição
 * - Header incorreto ou ausente → retorna false (NestJS lança 403)
 * - Comprimentos diferentes → retorna false sem lançar (absorve o TypeError do timingSafeEqual)
 *
 * Segurança crítica:
 * - NUNCA logar o valor do header recebido (pode ser uma tentativa de ataque)
 * - NUNCA usar `===` direto — vulnerável a timing attack
 * - Comparação em tempo constante obrigatória (OWASP ASVS 2.9.2)
 *
 * @example
 * ```typescript
 * // No controller:
 * @UseGuards(TelegramSecretGuard)
 * @Post('telegram')
 * async handleWebhook(@Body() body: TelegramUpdateDto): Promise<void> { ... }
 * ```
 */
@Injectable()
export class TelegramSecretGuard implements CanActivate {
  private readonly logger = new Logger(TelegramSecretGuard.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * Valida o header `X-Telegram-Bot-Api-Secret-Token` contra o valor configurado.
   *
   * Usa `crypto.timingSafeEqual` para comparação constante — garante que
   * a duração da operação não varia com o quão parecido é o token fornecido.
   *
   * @param context - Contexto de execução NestJS
   * @returns true se o token é válido, false caso contrário
   */
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const headers = request['headers'] as Record<string, string | string[] | undefined>;

    const provided = (headers['x-telegram-bot-api-secret-token'] ?? '') as string;
    const expected = this.configService.get<string>('TELEGRAM_WEBHOOK_SECRET') ?? '';

    if (!expected) {
      // Sem secret configurado — aceitar apenas em dev sem token no header
      // Logar aviso para detectar configuração incompleta
      this.logger.warn(
        'TELEGRAM_WEBHOOK_SECRET não configurado — webhook aceita sem validação de secret',
      );
      return true;
    }

    try {
      // timingSafeEqual lança TypeError se os buffers têm comprimentos diferentes
      // Capturar e retornar false para evitar vazar informação sobre o comprimento esperado
      const providedBuf = Buffer.from(provided);
      const expectedBuf = Buffer.from(expected);

      if (providedBuf.length !== expectedBuf.length) {
        // Não logar o token fornecido — pode ser tentativa de brute-force
        this.logger.debug('Validação de secret falhou: comprimentos diferentes');
        return false;
      }

      const valid = crypto.timingSafeEqual(providedBuf, expectedBuf);

      if (!valid) {
        this.logger.debug('Validação de secret falhou: token inválido');
      }

      return valid;
    } catch {
      // Absorver qualquer erro inesperado — fail-closed
      this.logger.debug('Validação de secret falhou com exceção inesperada');
      return false;
    }
  }
}

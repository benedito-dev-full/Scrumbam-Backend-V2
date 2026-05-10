import { Module } from '@nestjs/common';
import { EntidadesModule } from '../../entidades/entidades.module';
import { GroqModule } from '../../integrations/groq/groq.module';
import { AccountLinkService } from '../core/account-link.service';
import { MessageRouterService } from '../core/message-router.service';
import { CommandRegistryService } from '../core/command-registry.service';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramWebhookService } from './telegram-webhook.service';
import { TelegramSendService } from './telegram-send.service';
import { TelegramFileDownloadService } from './telegram-file-download.service';
import { TelegramSecretGuard } from './telegram-secret.guard';

/**
 * TelegramModule — integração com o Telegram (F10 Bloco B).
 *
 * Implementa o webhook do Telegram com:
 * - Validação de secret via `TelegramSecretGuard`
 * - Processamento assíncrono de updates (setImmediate)
 * - Deduplicação por update_id via Redis
 * - Persistência de mensagens em DEvento -493
 * - Transcrição de voz via Groq Whisper
 * - Registro de webhook em `onModuleInit`
 *
 * ADR-V2-010: módulo desativável via `CHANNELS_ENABLED`.
 * Verificação feita em `TelegramWebhookService.onModuleInit`.
 *
 * Importa:
 * - `EntidadesModule` — EntidadeService (getEntidadeIdFromUserGroup)
 * - `GroqModule` — GroqWhisperService (transcrição de voz)
 *
 * Não importa `ChannelsModule` — os services do core (AccountLink,
 * MessageRouter, CommandRegistry) são providos diretamente para evitar
 * importação circular. O `ChannelsModule` importa `TelegramModule`.
 *
 * Não exporta providers (módulo encapsulado).
 *
 * @see TelegramWebhookService — processamento principal
 * @see TelegramSecretGuard — validação de assinatura
 * @see GroqWhisperService — transcrição de voz
 */
@Module({
  imports: [
    EntidadesModule,
    GroqModule,
  ],
  controllers: [TelegramWebhookController],
  providers: [
    TelegramWebhookService,
    TelegramSendService,
    TelegramFileDownloadService,
    TelegramSecretGuard,
    // Core channel services reutilizados (sem importar ChannelsModule inteiro)
    AccountLinkService,
    MessageRouterService,
    CommandRegistryService,
  ],
})
export class TelegramModule {}

import { Module } from '@nestjs/common';
import { EntidadesModule } from '../../entidades/entidades.module';
import { GroqModule } from '../../integrations/groq/groq.module';
import { ProjectsModule } from '../../projects/projects.module';
import { TasksModule } from '../../tasks/tasks.module';
import { AccountLinkService } from '../core/account-link.service';
import { MessageRouterService } from '../core/message-router.service';
import { CommandRegistryService } from '../core/command-registry.service';
import { PairingService } from '../core/pairing.service';
import { TelegramWebhookController } from './telegram-webhook.controller';
import { TelegramWebhookService } from './telegram-webhook.service';
import { TelegramSendService } from './telegram-send.service';
import { TelegramFileDownloadService } from './telegram-file-download.service';
import { TelegramMetricsService } from './telegram-metrics.service';
import { TelegramRateLimitService } from './telegram-rate-limit.service';
import { TelegramSecretGuard } from './telegram-secret.guard';
// Commands (F10 Bloco C)
import { StartHandler } from './commands/start.handler';
import { PairHandler } from './commands/pair.handler';
import { TasksHandler } from './commands/tasks.handler';
import { CreateTaskHandler } from './commands/create-task.handler';
import { StatusHandler } from './commands/status.handler';
// Intents (F10 Bloco C)
import { CreateTaskFromTextIntent } from './intents/create-task-from-text.intent';

/**
 * TelegramModule — integração com o Telegram (F10 Blocos B + C).
 *
 * Implementa o webhook do Telegram com:
 * - Validação de secret via `TelegramSecretGuard`
 * - Processamento assíncrono de updates (setImmediate)
 * - Deduplicação por update_id via Redis
 * - Persistência de mensagens em DEvento -493
 * - Transcrição de voz via Groq Whisper
 * - Registro de webhook em `onModuleInit`
 * - 5 command handlers + 1 intent handler (Bloco C)
 *
 * ADR-V2-010: módulo desativável via `CHANNELS_ENABLED`.
 * Verificação feita em `TelegramWebhookService.onModuleInit`.
 *
 * Importa:
 * - `EntidadesModule` — EntidadeService (getEntidadeIdFromUserGroup)
 * - `GroqModule` — GroqWhisperService (transcrição de voz)
 * - `TasksModule` — TasksService (listagem e criação de tasks)
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
 * @see StartHandler — comando /start
 * @see PairHandler — comando /pair
 * @see TasksHandler — comando /tasks
 * @see CreateTaskHandler — comando /create
 * @see StatusHandler — comando /status
 * @see CreateTaskFromTextIntent — intent para texto livre
 */
@Module({
  imports: [
    EntidadesModule,
    GroqModule,
    ProjectsModule,
    TasksModule,
  ],
  controllers: [TelegramWebhookController],
  providers: [
    TelegramWebhookService,
    TelegramSendService,
    TelegramFileDownloadService,
    TelegramMetricsService,
    TelegramRateLimitService,
    TelegramSecretGuard,
    // Core channel services reutilizados (sem importar ChannelsModule inteiro)
    AccountLinkService,
    MessageRouterService,
    CommandRegistryService,
    PairingService,
    // Command handlers (F10 Bloco C) — se autorregistram em onModuleInit
    StartHandler,
    PairHandler,
    TasksHandler,
    CreateTaskHandler,
    StatusHandler,
    // Intent handlers (F10 Bloco C) — se autorregistram em onModuleInit
    CreateTaskFromTextIntent,
  ],
})
export class TelegramModule {}

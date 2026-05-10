import {
  Injectable,
  Logger,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../prisma.service';
import { AccountLinkService } from '../core/account-link.service';
import { MessageRouterService } from '../core/message-router.service';
import { TelegramSendService } from './telegram-send.service';
import { TelegramFileDownloadService } from './telegram-file-download.service';
import { TelegramMetricsService } from './telegram-metrics.service';
import { TelegramRateLimitService } from './telegram-rate-limit.service';
import { GroqWhisperService } from '../../integrations/groq/groq-whisper.service';
import { EventProducerService } from '../../eventos/core/event-producer.service';
import { TelegramUpdateDto } from './dto/telegram-update.dto';
import { Redis } from 'ioredis';
import { InboundMessage } from '../core/channel-adapter.interface';

/**
 * Serviço principal do webhook Telegram (F10 Bloco B).
 *
 * Responsabilidades:
 * 1. `onModuleInit` — registrar webhook via `setWebhook` (idempotente)
 * 2. `handleUpdate` — deduplicar, resolver usuário, processar texto ou voz
 * 3. `handleText` — persistir em DEvento + atualizar DVincula em transação
 * 4. `handleVoice` — baixar arquivo, transcrever, persistir DEvento (mesmo se Groq falhar)
 *
 * Regras V2 canônicas:
 * - ZERO Engine (F10 não usa Operacao*)
 * - `chatId` sempre como `BigInt` — nunca Number ou parseInt
 * - `prisma.$transaction` em operações multi-tabela (handleText: DEvento + DVincula)
 * - Eventos emitidos APÓS commit confirmado (Padrão #7)
 * - `idUsuario` do DEvento aponta para `DEntidade.chave` (via AccountLinkService)
 *
 * Deduplicação:
 * - Chave Redis: `tg:dedup:{update_id}` com TTL 3600s (1 hora)
 * - Operação atômica: SET NX PX
 *
 * @see TelegramSecretGuard — validação do header X-Telegram-Bot-Api-Secret-Token
 * @see AccountLinkService — resolução de userId por chatId
 * @see PairingService — criação do vínculo DVincula -483
 */
@Injectable()
export class TelegramWebhookService implements OnModuleInit {
  private readonly logger = new Logger(TelegramWebhookService.name);

  /** idClasse do DEvento para mensagens recebidas via canal (CHANNEL_MESSAGE_IN). */
  private static readonly CHANNEL_MESSAGE_IN_CLASS = BigInt(-493);

  /** idClasse do DVincula para vínculo canal↔usuário (CHANNEL_LINK). */
  private static readonly CHANNEL_LINK_CLASS = BigInt(-483);

  /** Prefixo de chave Redis para deduplicação de update_id. */
  private static readonly DEDUP_KEY_PREFIX = 'tg:dedup:';

  /** TTL em ms para chaves de deduplicação (1 hora). */
  private static readonly DEDUP_TTL_MS = 3_600_000;

  private redis: Redis | null = null;

  constructor(
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
    private readonly accountLinkService: AccountLinkService,
    private readonly messageRouterService: MessageRouterService,
    private readonly telegramSendService: TelegramSendService,
    private readonly fileDownloadService: TelegramFileDownloadService,
    private readonly metricsService: TelegramMetricsService,
    private readonly rateLimitService: TelegramRateLimitService,
    private readonly groqWhisperService: GroqWhisperService,
    private readonly eventProducer: EventProducerService,
  ) {}

  /**
   * Registra o webhook no Telegram ao inicializar o módulo.
   *
   * Verifica `CHANNELS_ENABLED` antes de tentar o registro.
   * Falha no registro é logada mas não derruba o processo.
   * Inicializa cliente Redis para deduplicação.
   */
  async onModuleInit(): Promise<void> {
    const enabled = this.configService.get<string>('CHANNELS_ENABLED');

    if (enabled !== 'true') {
      this.logger.debug('TelegramWebhookService: CHANNELS_ENABLED !== "true" — setWebhook ignorado');
      return;
    }

    // Inicializar Redis para deduplicação
    this.initRedis();

    // Registrar webhook (idempotente)
    try {
      await this.telegramSendService.setWebhook();
      this.logger.log('Telegram webhook registrado com sucesso');
    } catch (err) {
      // Não derrubar o processo — o bot pode ter sido registrado anteriormente
      this.logger.error(
        `Falha ao registrar Telegram webhook: ${(err as Error).message}`,
      );
    }
  }

  /**
   * Processa um Update do Telegram.
   *
   * Chamado via `setImmediate` pelo controller — retorna void assincronamente.
   * Erros são capturados e logados internamente; nunca propagam para o controller.
   *
   * Fluxo:
   * 1. Deduplicar pelo update_id (Redis SET NX)
   * 2. Verificar se há mensagem processável
   * 3. Extrair chatId como BigInt
   * 4. Resolver userId via AccountLinkService
   * 5. Se não pareado: enviar orientação e retornar
   * 6. Se texto: handleText
   * 7. Se voz: handleVoice
   *
   * @param update - Update do Telegram (validado pelo DTO)
   */
  async handleUpdate(update: TelegramUpdateDto): Promise<void> {
    const correlationId = update.update_id.toString();

    try {
      // Passo 1: Deduplicação
      const isDuplicate = await this.isDuplicate(update.update_id);
      if (isDuplicate) {
        this.logger.debug(
          `Update duplicado ignorado: update_id=${update.update_id}`,
        );
        return;
      }

      // Passo 2: Verificar se há mensagem processável
      if (!update.message) {
        this.logger.debug(
          `Update sem mensagem ignorado: update_id=${update.update_id}`,
        );
        return;
      }

      const message = update.message;

      // Passo 3: Extrair chatId como BigInt (NUNCA parseInt/Number)
      const chatId = BigInt(message.chat.id);

      const rateLimit = await this.rateLimitService.check(chatId, correlationId);
      if (!rateLimit.allowed) {
        return;
      }

      // Passo 4: Resolver userId
      const userId = await this.accountLinkService.findByChat('telegram', chatId);

      // Passo 5: Chat não pareado
      if (userId === null) {
        this.logger.debug(
          `Chat não pareado: chatId=${chatId} update_id=${update.update_id}`,
        );
        await this.sendPairingOrientation(chatId);
        return;
      }

      // Passo 6/7: Processar por tipo
      if (message.voice) {
        this.metricsService.recordEvent('voice', correlationId);
        await this.handleVoice(
          chatId,
          userId,
          message.voice.file_id,
          message.voice.mime_type,
          correlationId,
        );
      } else if (message.text) {
        this.metricsService.recordEvent('text', correlationId);
        this.metricsService.recordEvent(
          message.text.trim().startsWith('/') ? 'command' : 'intent',
          correlationId,
        );
        await this.handleText(
          chatId,
          userId,
          message.text,
          message.message_id,
          message.date,
          correlationId,
        );
      } else {
        this.logger.debug(
          `Tipo de mensagem não suportado: update_id=${update.update_id} chatId=${chatId}`,
        );
      }
    } catch (err) {
      // Nunca propagar para o controller — Telegram já recebeu 200
      this.logger.error(
        `Erro ao processar update_id=${update.update_id}: ${(err as Error).message}`,
        (err as Error).stack,
      );
    }
  }

  /**
   * Processa mensagem de texto: persiste DEvento + atualiza DVincula em transação.
   *
   * Usa `prisma.$transaction` para atomicidade (DEvento + DVincula na mesma tx).
   * Emite evento `telegram.message.received` APENAS após commit confirmado.
   *
   * @param chatId - chatId do Telegram (BigInt)
   * @param userId - DEntidade.chave do usuário (BigInt)
   * @param text - Texto da mensagem
   * @param messageId - ID da mensagem Telegram
   * @param date - Timestamp Unix da mensagem
   * @param correlationId - ID de correlação (update_id.toString())
   */
  async handleText(
    chatId: bigint,
    userId: bigint,
    text: string,
    messageId: number,
    date: number,
    correlationId: string,
  ): Promise<void> {
    // Operação atômica: DEvento + DVincula na mesma transação
    await this.prisma.$transaction(async (tx) => {
      // 1. Gravar DEvento -493 (CHANNEL_MESSAGE_IN)
      await tx.dEvento.create({
        data: {
          idClasse: TelegramWebhookService.CHANNEL_MESSAGE_IN_CLASS,
          idEntidade: userId,
          identificadorExterno: correlationId,
          descricao: `Telegram message: ${text.slice(0, 200)}`,
          metaDados: {
            channelName: 'telegram',
            chatId: chatId.toString(),
            text,
            type: 'text',
            messageId,
            timestamp: new Date(date * 1000).toISOString(),
          } as import('@prisma/client').Prisma.JsonObject,
        },
      });

      // 2. Atualizar lastSeenAt em DVincula -483 (CHANNEL_LINK)
      await this.updateLastSeen(tx, userId, chatId);
    });

    // Emitir evento APÓS commit (Padrão #7)
    await this.eventProducer
      .addInternalEvent(
        'telegram.message.received',
        {
          chatId: chatId.toString(),
          userId: userId.toString(),
          text,
          messageId,
        },
        correlationId,
        { source: 'TelegramWebhookService' },
      )
      .catch((err) => {
        // Falha de evento não derruba o processamento
        this.logger.warn(
          `Falha ao emitir telegram.message.received: ${(err as Error).message}`,
        );
      });

    // Rotear para MessageRouterService (após persistência)
    const inboundMessage: InboundMessage = this.buildInboundMessage(chatId, text);
    await this.messageRouterService.handleInbound('telegram', inboundMessage).catch((err) => {
      this.logger.warn(`Falha ao rotear mensagem: ${(err as Error).message}`);
    });
  }

  /**
   * Processa mensagem de voz: baixa, transcreve e persiste DEvento.
   *
   * Grava DEvento SEMPRE — mesmo se o Groq falhar (transcript=null + error gravado).
   * Não usa `prisma.$transaction` aqui: operação em tabela única (DEvento).
   * Emite evento `telegram.voice.received` APENAS após commit.
   *
   * @param chatId - chatId do Telegram (BigInt)
   * @param userId - DEntidade.chave do usuário (BigInt)
   * @param fileId - File ID do arquivo de voz no Telegram
   * @param mimeType - MIME type do arquivo (ex: 'audio/ogg')
   * @param correlationId - ID de correlação
   */
  async handleVoice(
    chatId: bigint,
    userId: bigint,
    fileId: string,
    mimeType: string | undefined,
    correlationId: string,
  ): Promise<void> {
    const startedAt = Date.now();
    let transcription: string | null = null;
    let transcriptError: string | null = null;

    // Passo 1: Baixar arquivo de voz
    let audioBuffer: Buffer | null = null;
    try {
      audioBuffer = await this.fileDownloadService.download(fileId);
    } catch (err) {
      transcriptError = `download_failed: ${(err as Error).message.slice(0, 100)}`;
      this.logger.warn(
        `Falha ao baixar arquivo de voz fileId=${fileId}: ${(err as Error).message}`,
      );
    }

    // Passo 2: Transcrever (somente se download bem-sucedido)
    if (audioBuffer) {
      try {
        transcription = await this.groqWhisperService.transcribe(audioBuffer, mimeType);
      } catch (err) {
        transcriptError = `groq_unavailable: ${(err as Error).message.slice(0, 100)}`;
        this.logger.warn(
          `Falha ao transcrever áudio via Groq (fileId=${fileId}): ${(err as Error).message}`,
        );
      }
    }

    this.metricsService.recordTranscriptionLatency(Date.now() - startedAt, correlationId);

    // Passo 3: Gravar DEvento SEMPRE (mesmo com falha)
    await this.prisma.dEvento.create({
      data: {
        idClasse: TelegramWebhookService.CHANNEL_MESSAGE_IN_CLASS,
        idEntidade: userId,
        identificadorExterno: correlationId,
        descricao: transcription
          ? `Telegram voice: ${transcription.slice(0, 200)}`
          : `Telegram voice (sem transcrição)`,
        metaDados: {
          channelName: 'telegram',
          chatId: chatId.toString(),
          type: 'voice',
          fileId,
          transcription,
          transcriptError,
        } as import('@prisma/client').Prisma.JsonObject,
      },
    });

    // Emitir evento APÓS commit (Padrão #7)
    await this.eventProducer
      .addInternalEvent(
        'telegram.voice.received',
        {
          chatId: chatId.toString(),
          userId: userId.toString(),
          fileId,
          hasTranscription: transcription !== null,
          transcription: transcription ?? undefined,
        },
        correlationId,
        { source: 'TelegramWebhookService' },
      )
      .catch((err) => {
        this.logger.warn(
          `Falha ao emitir telegram.voice.received: ${(err as Error).message}`,
        );
      });

    // Rotear transcrição como texto se disponível
    if (transcription) {
      const inboundMessage: InboundMessage = this.buildInboundMessage(chatId, transcription);
      await this.messageRouterService
        .handleInbound('telegram', inboundMessage)
        .catch((err) => {
          this.logger.warn(
            `Falha ao rotear transcrição de voz: ${(err as Error).message}`,
          );
        });
    }
  }

  /**
   * Atualiza o `lastSeenAt` no DVincula -483 do usuário.
   *
   * Chamado dentro de `prisma.$transaction` em handleText.
   * Usa `updateMany` para evitar NotFoundException se o vínculo não existir.
   */
  private async updateLastSeen(
    tx: Parameters<Parameters<typeof this.prisma.$transaction>[0]>[0],
    userId: bigint,
    chatId: bigint,
  ): Promise<void> {
    // Buscar o vínculo para este userId + chatId
    const links = await tx.dVincula.findMany({
      where: {
        idClasse: TelegramWebhookService.CHANNEL_LINK_CLASS,
        idLocEscritu: userId,
        excluido: false,
      },
      select: { chave: true, metaDados: true },
    });

    // Filtrar pelo chatId no metaDados
    const link = links.find((l) => {
      const meta = l.metaDados as { chatId?: string } | null;
      return meta?.chatId === chatId.toString();
    });

    if (!link) {
      // Não é erro crítico — apenas logar em debug
      this.logger.debug(
        `DVincula -483 não encontrado para userId=${userId} chatId=${chatId} — lastSeenAt não atualizado`,
      );
      return;
    }

    const existingMeta = link.metaDados as Record<string, unknown>;
    await tx.dVincula.update({
      where: { chave: link.chave },
      data: {
        metaDados: {
          ...existingMeta,
          lastSeenAt: new Date().toISOString(),
        } as import('@prisma/client').Prisma.JsonObject,
      },
    });
  }

  /**
   * Verifica se o update_id já foi processado (deduplicação Redis).
   *
   * Operação atômica: SET NX PX — garante que apenas um processo marca a chave.
   * Retorna true se já foi processado (duplicado), false se é novo.
   */
  private async isDuplicate(updateId: number): Promise<boolean> {
    if (!this.redis) {
      // Redis não inicializado — usar fallback in-memory (degraded mode)
      this.logger.debug(
        `Redis não disponível — deduplicação desabilitada para update_id=${updateId}`,
      );
      return false;
    }

    const key = `${TelegramWebhookService.DEDUP_KEY_PREFIX}${updateId}`;

    // SET NX PX é atômico — retorna 'OK' se a chave foi criada, null se já existia
    // ioredis: set(key, value, 'PX', ttlMs, 'NX')
    const result = await this.redis
      .set(key, '1', 'PX', TelegramWebhookService.DEDUP_TTL_MS, 'NX')
      .catch((err) => {
        this.logger.warn(
          `Falha na deduplicação Redis: ${(err as Error).message} — permitindo processamento`,
        );
        return 'OK' as string | null; // Em caso de falha do Redis, permite processar
      });

    // Se result === null, a chave já existia → é duplicado
    return result === null;
  }

  /**
   * Inicializa o cliente Redis para deduplicação.
   *
   * Usa a URL do Redis configurada em `REDIS_URL` (padrão BullMQ no projeto).
   * Falha silenciosa — o módulo funciona sem Redis em modo degradado.
   */
  private initRedis(): void {
    try {
      const redisUrl = this.configService.get<string>('REDIS_URL') ?? 'redis://localhost:6379';
      this.redis = new Redis(redisUrl, {
        lazyConnect: true,
        enableReadyCheck: false,
        maxRetriesPerRequest: 1,
      });

      this.redis.on('error', (err) => {
        this.logger.warn(`Redis error (deduplicação): ${(err as Error).message}`);
      });
    } catch (err) {
      this.logger.warn(
        `Falha ao inicializar Redis para deduplicação: ${(err as Error).message}`,
      );
      this.redis = null;
    }
  }

  /**
   * Envia mensagem de orientação de pareamento para chat não pareado.
   */
  private async sendPairingOrientation(chatId: bigint): Promise<void> {
    const message =
      'Olá! Para usar o bot, você precisa parear sua conta.\n\n' +
      '1. Acesse o Scrumban e vá em *Configurações > Canais*\n' +
      '2. Clique em *Gerar código de pareamento*\n' +
      '3. Envie o código aqui: `/pair <código>`\n\n' +
      'O código expira em 15 minutos.';

    await this.telegramSendService.sendMessage(chatId, message).catch((err) => {
      this.logger.warn(
        `Falha ao enviar orientação de pareamento para chatId=${chatId}: ${(err as Error).message}`,
      );
    });
  }

  /**
   * Constrói uma InboundMessage normalizada para roteamento.
   *
   * Detecta se o texto é um comando slash (começa com '/').
   */
  private buildInboundMessage(chatId: bigint, text: string): InboundMessage {
    const trimmed = text.trim();

    if (trimmed.startsWith('/')) {
      const parts = trimmed.slice(1).split(' ');
      const commandName = parts[0] ?? '';
      const commandArgs = parts.slice(1);
      return {
        chatId,
        type: 'command',
        commandName,
        commandArgs,
      };
    }

    return {
      chatId,
      type: 'text',
      text: trimmed,
    };
  }
}

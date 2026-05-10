import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Serviço de transcrição de áudio via Groq Whisper API.
 *
 * Chama `POST https://api.groq.com/openai/v1/audio/transcriptions`
 * com `multipart/form-data`, modelo `whisper-large-v3`, idioma `pt`.
 *
 * Segurança:
 * - `GROQ_API_KEY` nunca é logada — nem em debug, nem em mensagens de erro.
 * - Erros da API são propagados sem vazar detalhes da key.
 *
 * Comportamento de falha:
 * - `GROQ_API_KEY` ausente → lança `ServiceUnavailableException` imediatamente.
 * - API Groq indisponível → propaga o erro para o caller (TelegramWebhookService
 *   captura e grava DEvento com `transcriptError`).
 *
 * @example
 * ```typescript
 * const text = await groqWhisperService.transcribe(audioBuffer, 'audio/ogg');
 * // "Criar tarefa implementar login para amanhã"
 * ```
 */
@Injectable()
export class GroqWhisperService {
  private readonly logger = new Logger(GroqWhisperService.name);

  private static readonly GROQ_API_URL =
    'https://api.groq.com/openai/v1/audio/transcriptions';

  private static readonly MODEL = 'whisper-large-v3';

  constructor(private readonly configService: ConfigService) {}

  /**
   * Transcreve um buffer de áudio para texto usando Groq Whisper.
   *
   * Constrói o payload `multipart/form-data` nativamente com Node.js `Buffer`
   * e `fetch` (Node 18+). Não depende de `form-data` externo.
   *
   * @param audioBuffer - Buffer com dados do arquivo de áudio
   * @param mimeType - MIME type do áudio (ex: 'audio/ogg', 'audio/mpeg')
   * @returns Texto transcrito
   *
   * @throws {ServiceUnavailableException} Se `GROQ_API_KEY` não estiver configurada
   * @throws {Error} Se a API Groq retornar erro HTTP ou falha de rede
   *
   * @example
   * ```typescript
   * const text = await service.transcribe(buffer, 'audio/ogg');
   * // Retorna: "Implementar feature de login"
   * ```
   */
  async transcribe(audioBuffer: Buffer, mimeType?: string): Promise<string> {
    const apiKey = this.configService.get<string>('GROQ_API_KEY');

    if (!apiKey) {
      this.logger.error(
        'GroqWhisperService: GROQ_API_KEY não configurada — transcrição indisponível',
      );
      throw new ServiceUnavailableException(
        'Serviço de transcrição de voz não está disponível no momento',
      );
    }

    const effectiveMimeType = mimeType ?? 'audio/ogg';
    const filename = this.resolveFilename(effectiveMimeType);

    // Construir multipart/form-data manualmente (sem dependência form-data)
    const boundary = `----WebKitFormBoundary${Math.random().toString(36).slice(2)}`;

    const bodyParts: Buffer[] = [];

    // Campo: file (buffer de áudio)
    const fileHeader =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="file"; filename="${filename}"\r\n` +
      `Content-Type: ${effectiveMimeType}\r\n\r\n`;
    bodyParts.push(Buffer.from(fileHeader));
    bodyParts.push(audioBuffer);
    bodyParts.push(Buffer.from('\r\n'));

    // Campo: model
    const modelPart =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="model"\r\n\r\n` +
      `${GroqWhisperService.MODEL}\r\n`;
    bodyParts.push(Buffer.from(modelPart));

    // Campo: language
    const langPart =
      `--${boundary}\r\n` +
      `Content-Disposition: form-data; name="language"\r\n\r\npt\r\n`;
    bodyParts.push(Buffer.from(langPart));

    // Fechamento boundary
    bodyParts.push(Buffer.from(`--${boundary}--\r\n`));

    const body = Buffer.concat(bodyParts);

    this.logger.debug(
      `Transcrevendo áudio: mimeType=${effectiveMimeType} size=${audioBuffer.length}B`,
    );

    const response = await fetch(GroqWhisperService.GROQ_API_URL, {
      method: 'POST',
      headers: {
        // API key presente mas nunca logada
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': `multipart/form-data; boundary=${boundary}`,
      },
      body,
    });

    if (!response.ok) {
      const errorText = await response.text().catch(() => 'unknown error');
      // Não logar API key — apenas status e descrição sem token
      this.logger.error(
        `Groq Whisper API retornou erro: status=${response.status} message=${errorText.slice(0, 200)}`,
      );
      throw new Error(
        `Groq API error: ${response.status} — ${errorText.slice(0, 100)}`,
      );
    }

    const result = (await response.json()) as { text: string };

    if (!result.text) {
      this.logger.warn('Groq Whisper retornou resposta sem campo text');
      return '';
    }

    this.logger.debug(
      `Transcrição concluída: ${result.text.slice(0, 50)}${result.text.length > 50 ? '...' : ''}`,
    );

    return result.text;
  }

  /**
   * Resolve o nome do arquivo de upload com base no MIME type.
   *
   * Groq Whisper aceita ogg, mp3, wav, webm, m4a, flac, mpeg.
   */
  private resolveFilename(mimeType: string): string {
    const extensionMap: Record<string, string> = {
      'audio/ogg': 'audio.ogg',
      'audio/mpeg': 'audio.mp3',
      'audio/mp4': 'audio.m4a',
      'audio/wav': 'audio.wav',
      'audio/webm': 'audio.webm',
      'audio/flac': 'audio.flac',
    };
    return extensionMap[mimeType] ?? 'audio.ogg';
  }
}

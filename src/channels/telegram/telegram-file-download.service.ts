import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Serviço de download de arquivos do Telegram.
 *
 * Fluxo de download:
 * 1. `GET /getFile?file_id={fileId}` → obtém `file_path` no servidor Telegram
 * 2. `GET /file/bot{TOKEN}/{file_path}` → baixa o buffer do arquivo
 *
 * Timeout de 10s em ambas as chamadas via `AbortController`.
 *
 * Segurança:
 * - `TELEGRAM_BOT_TOKEN` nunca é logado.
 * - URLs construídas com o token nunca aparecem em logs.
 *
 * @example
 * ```typescript
 * const buffer = await telegramFileDownloadService.download('BQACAgIAAxkBAAI...');
 * // Buffer com dados do arquivo de voz
 * ```
 */
@Injectable()
export class TelegramFileDownloadService {
  private readonly logger = new Logger(TelegramFileDownloadService.name);

  /** Timeout em ms para cada chamada HTTP ao Telegram. */
  private static readonly TIMEOUT_MS = 10_000;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Baixa um arquivo do Telegram por fileId e retorna o Buffer.
   *
   * Executa 2 chamadas sequenciais:
   * 1. `getFile` — resolve fileId para file_path
   * 2. Download direto do CDN do Telegram
   *
   * Ambas com timeout de 10s via `AbortController`.
   *
   * @param fileId - File ID do arquivo (retornado pela API do Telegram)
   * @returns Buffer com os dados binários do arquivo
   *
   * @throws {Error} Se getFile falhar, timeout ou download falhar
   *
   * @example
   * ```typescript
   * const buffer = await service.download('BQACAgIAAxkBAAI...');
   * await groqWhisperService.transcribe(buffer, 'audio/ogg');
   * ```
   */
  async download(fileId: string): Promise<Buffer> {
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');

    if (!token) {
      throw new Error('TELEGRAM_BOT_TOKEN não configurado — não é possível baixar arquivo');
    }

    // Passo 1: Obter file_path via getFile
    const filePath = await this.getFilePath(token, fileId);

    // Passo 2: Download do arquivo
    return this.downloadFile(token, filePath);
  }

  /**
   * Resolve o file_path a partir do fileId usando a API getFile.
   */
  private async getFilePath(token: string, fileId: string): Promise<string> {
    // URL com token — NUNCA logar
    const url = `https://api.telegram.org/bot${token}/getFile?file_id=${encodeURIComponent(fileId)}`;

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      TelegramFileDownloadService.TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        const errorBody = await response.text().catch(() => '');
        // Logar apenas status, não a URL
        this.logger.error(`Falha ao obter file_path: status=${response.status} fileId=${fileId}`);
        throw new Error(`Telegram getFile failed: ${response.status} — ${errorBody.slice(0, 100)}`);
      }

      const result = (await response.json()) as {
        ok: boolean;
        result?: { file_path?: string };
      };

      if (!result.ok || !result.result?.file_path) {
        throw new Error(`Telegram getFile retornou resultado inválido para fileId=${fileId}`);
      }

      return result.result.file_path;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Timeout ao obter file_path do Telegram (${TelegramFileDownloadService.TIMEOUT_MS}ms)`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  /**
   * Baixa o conteúdo binário do arquivo usando o file_path resolvido.
   */
  private async downloadFile(token: string, filePath: string): Promise<Buffer> {
    // URL com token — NUNCA logar
    const url = `https://api.telegram.org/file/bot${token}/${filePath}`;

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      TelegramFileDownloadService.TIMEOUT_MS,
    );

    try {
      const response = await fetch(url, { signal: controller.signal });

      if (!response.ok) {
        // Logar apenas status, não a URL
        this.logger.error(`Falha ao baixar arquivo Telegram: status=${response.status}`);
        throw new Error(`Telegram file download failed: ${response.status}`);
      }

      const arrayBuffer = await response.arrayBuffer();
      const buffer = Buffer.from(arrayBuffer);

      this.logger.debug(`Arquivo baixado com sucesso: ${buffer.length} bytes`);

      return buffer;
    } catch (error) {
      if ((error as Error).name === 'AbortError') {
        throw new Error(`Timeout ao baixar arquivo do Telegram (${TelegramFileDownloadService.TIMEOUT_MS}ms)`);
      }
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

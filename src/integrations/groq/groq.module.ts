import { Module } from '@nestjs/common';
import { GroqWhisperService } from './groq-whisper.service';

/**
 * GroqModule — integração com a API Groq (Whisper para transcrição de voz).
 *
 * Provê:
 * - `GroqWhisperService` — transcrição de áudio para texto via Groq Whisper API
 *
 * Configuração necessária via variáveis de ambiente:
 * - `GROQ_API_KEY` — chave de API Groq (obrigatória em produção)
 *
 * Se `GROQ_API_KEY` não estiver configurada, `GroqWhisperService.transcribe()`
 * lança `ServiceUnavailableException` sem derrubar o módulo.
 * Isso permite deployments sem Groq ativo (ex: CI, ambientes de testes).
 *
 * Exporta `GroqWhisperService` para que `TelegramModule` possa injetar.
 *
 * @see GroqWhisperService
 */
@Module({
  providers: [GroqWhisperService],
  exports: [GroqWhisperService],
})
export class GroqModule {}

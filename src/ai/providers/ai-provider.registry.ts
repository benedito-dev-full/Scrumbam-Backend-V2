import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { AiProvider } from './ai-provider.interface';
import { ClaudeProvider } from './claude.provider';
import { GeminiProvider } from './gemini.provider';
import { OpenAiProvider } from './openai.provider';

/**
 * Nome do provider default historico (compat retroativa).
 *
 * Antes do multi-provider, o Nexus era acoplado exclusivamente ao Gemini.
 * Toda chamada sem `provider` explicito (no body) e sem preferencia de org
 * deve continuar usando o Gemini — este e o fallback final da cascata de
 * roteamento do `AiChatService`.
 */
const DEFAULT_PROVIDER_NAME = 'gemini';

/**
 * Registry de providers de IA do Nexus.
 *
 * Recebe os 3 providers concretos via DI (`GeminiProvider`, `ClaudeProvider`,
 * `OpenAiProvider`), indexa cada um pelo seu `.name` e expoe um `resolve(name)`
 * que devolve a instancia correta. Substitui o acoplamento direto do
 * `AiChatService` ao `GeminiProvider`.
 *
 * Idiomatico em Nest: os providers ja sao singletons gerenciados pelo container,
 * o registry apenas os indexa — nenhuma instancia e recriada por request.
 *
 * @see AiProviderRegistry#resolve — resolucao por nome.
 * @see AiChatService — consumidor (roteamento de provider).
 * @see ADR-V2-064 — Provider Registry + cascata de resolucao.
 */
@Injectable()
export class AiProviderRegistry {
  private readonly logger = new Logger(AiProviderRegistry.name);

  /** Mapa `name` → instancia do provider (indexado no construtor). */
  private readonly providers = new Map<string, AiProvider>();

  constructor(
    gemini: GeminiProvider,
    claude: ClaudeProvider,
    openai: OpenAiProvider,
  ) {
    for (const provider of [gemini, claude, openai]) {
      this.providers.set(provider.name, provider);
    }
    this.logger.log(`ai_provider_registry_ready providers=${this.listNames().join(',')}`);
  }

  /**
   * Nome do provider default (compat retroativa — `'gemini'`).
   *
   * Usado como fallback final da cascata de roteamento quando o request nao
   * traz `provider` e a org nao tem preferencia configurada.
   */
  get defaultName(): string {
    return DEFAULT_PROVIDER_NAME;
  }

  /**
   * Resolve a instancia do provider pelo nome.
   *
   * @param name - Nome curto do provider (`'gemini' | 'claude' | 'openai'`).
   * @returns A instancia do `AiProvider` correspondente.
   *
   * @throws {BadRequestException} Quando o nome nao corresponde a nenhum
   *   provider registrado. Nunca retorna `undefined` silenciosamente.
   *
   * @example
   * ```typescript
   * const provider = registry.resolve('claude');
   * const result = await provider.chat({ ... });
   * ```
   */
  resolve(name: string): AiProvider {
    const provider = this.providers.get(name);
    if (!provider) {
      throw new BadRequestException(`Provider de IA desconhecido: ${name}`);
    }
    return provider;
  }

  /**
   * Lista os nomes de todos os providers registrados.
   *
   * @returns Array com os nomes (`['gemini', 'claude', 'openai']`).
   */
  listNames(): string[] {
    return Array.from(this.providers.keys());
  }
}

import { BadRequestException } from '@nestjs/common';
import { AiProviderRegistry } from './ai-provider.registry';
import { AiProvider } from './ai-provider.interface';
import { ClaudeProvider } from './claude.provider';
import { GeminiProvider } from './gemini.provider';
import { OpenAiProvider } from './openai.provider';

/**
 * Cria um stub minimo de `AiProvider` com o `name` dado. Nao chama o SDK —
 * o registry so depende de `.name` e da identidade da instancia.
 */
function makeProvider(name: string): AiProvider {
  return {
    name,
    chat: jest.fn(),
  };
}

describe('AiProviderRegistry', () => {
  let gemini: AiProvider;
  let claude: AiProvider;
  let openai: AiProvider;
  let registry: AiProviderRegistry;

  beforeEach(() => {
    gemini = makeProvider('gemini');
    claude = makeProvider('claude');
    openai = makeProvider('openai');
    registry = new AiProviderRegistry(
      gemini as GeminiProvider,
      claude as ClaudeProvider,
      openai as OpenAiProvider,
    );
  });

  it('resolve("gemini") retorna a instancia do Gemini', () => {
    expect(registry.resolve('gemini')).toBe(gemini);
  });

  it('resolve("claude") retorna a instancia do Claude', () => {
    expect(registry.resolve('claude')).toBe(claude);
  });

  it('resolve("openai") retorna a instancia do OpenAI', () => {
    expect(registry.resolve('openai')).toBe(openai);
  });

  it('resolve com nome desconhecido lanca BadRequestException', () => {
    expect(() => registry.resolve('xpto')).toThrow(BadRequestException);
  });

  it('defaultName e "gemini" (compat retroativa)', () => {
    expect(registry.defaultName).toBe('gemini');
  });

  it('listNames retorna os 3 providers registrados', () => {
    expect(registry.listNames().sort()).toEqual(['claude', 'gemini', 'openai']);
  });
});

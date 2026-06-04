import {
  BadGatewayException,
  GatewayTimeoutException,
  HttpException,
  ServiceUnavailableException,
} from '@nestjs/common';

/**
 * Categorias canonicas de falha de um provider de IA.
 *
 * Cada categoria mapeia 1:1 para uma `HttpException` + mensagem amigavel
 * padronizada (ver `CATEGORY_MESSAGE`). A traducao do erro bruto do vendor
 * para uma destas categorias e responsabilidade de cada provider (via
 * `classifyProviderError`), pois cada SDK expoe `status`/`code`/`type` de
 * forma diferente.
 */
export type AiErrorCategory =
  | 'auth' // 401 / chave invalida → 502
  | 'rate_limit' // 429 rate limit temporario → 503
  | 'quota' // 429 insufficient_quota (billing/cota) → 503 (msg distinta)
  | 'timeout' // timeout local (Promise.race) → 504
  | 'overloaded' // 529 (Anthropic) sobrecarga → 503
  | 'upstream'; // 5xx / desconhecido → 502

/**
 * Contexto extraido do erro do vendor, normalizado para a traducao.
 *
 * `status` e o HTTP status numerico (quando deu para extrair). `code`/`type`
 * sao os campos textuais que alguns SDKs expoem (ex: OpenAI usa
 * `error.code='insufficient_quota'` para distinguir cota de rate limit).
 */
export interface ProviderErrorContext {
  /** HTTP status do vendor (ex: 401, 429, 500, 529) ou null se nao extraido. */
  status: number | null;
  /** Codigo textual do erro do vendor (ex: 'insufficient_quota'), se houver. */
  code?: string | null;
  /** Tipo textual do erro do vendor (ex: 'rate_limit_error'), se houver. */
  type?: string | null;
}

/**
 * Mensagens amigaveis CANONICAS por categoria, parametrizadas pelo nome do
 * provider (claude/openai/gemini). PT-BR, tom consistente com o restante do
 * projeto. NUNCA contem detalhe cru do vendor nem a chave — o detalhe tecnico
 * vai apenas para o log (responsabilidade do provider).
 */
const CATEGORY_MESSAGE: Record<AiErrorCategory, (provider: string) => string> = {
  auth: () => 'Falha de autenticacao com o provedor de IA. Verifique a chave configurada.',
  rate_limit: () =>
    'Limite de requisicoes do provedor de IA atingido. Tente novamente em instantes.',
  quota: () => 'Cota do provedor de IA esgotada. Contate o administrador.',
  timeout: () => 'O provedor de IA demorou a responder. Tente novamente.',
  overloaded: () =>
    'O provedor de IA esta sobrecarregado. Tente novamente em instantes.',
  upstream: () => 'Erro ao comunicar com o provedor de IA. Tente novamente.',
};

/**
 * Mapeia uma `AiErrorCategory` + nome do provider para a `HttpException` final
 * (status HTTP correto + mensagem amigavel canonica).
 *
 * Centraliza a decisao de status/mensagem para os 3 providers — garante
 * consistencia e evita divergencia/duplicacao. A mensagem produzida e SEMPRE
 * generica (nunca ecoa corpo bruto do vendor, stack ou chave).
 *
 * @param category - Categoria canonica de falha.
 * @param provider - Nome do provider (para a mensagem citar de forma neutra).
 * @returns A `HttpException` pronta para ser lancada ao client.
 *
 * @example
 * ```typescript
 * throw httpExceptionFor('auth', 'claude'); // BadGatewayException (502)
 * throw httpExceptionFor('quota', 'openai'); // ServiceUnavailableException (503)
 * ```
 */
export function httpExceptionFor(
  category: AiErrorCategory,
  provider: string,
): HttpException {
  const message = CATEGORY_MESSAGE[category](provider);
  switch (category) {
    case 'auth':
    case 'upstream':
      return new BadGatewayException(message);
    case 'rate_limit':
    case 'quota':
    case 'overloaded':
      return new ServiceUnavailableException(message);
    case 'timeout':
      return new GatewayTimeoutException(message);
    default: {
      // Exaustividade: se uma categoria nova for adicionada sem case, o
      // compilador acusa aqui (never). Fallback defensivo em runtime.
      const _exhaustive: never = category;
      void _exhaustive;
      return new BadGatewayException(CATEGORY_MESSAGE.upstream(provider));
    }
  }
}

/**
 * Classifica o contexto de erro do vendor em uma `AiErrorCategory` canonica.
 *
 * Regras (comuns aos 3 providers):
 *  - 401 → `auth`.
 *  - 429 com `code/type` indicando cota esgotada (`insufficient_quota` —
 *    OpenAI) → `quota` (problema de billing, mensagem distinta).
 *  - 429 demais → `rate_limit` (temporario).
 *  - 529 → `overloaded` (Anthropic sobrecarga).
 *  - 5xx ou status desconhecido → `upstream`.
 *
 * Timeout NAO passa por aqui — e tratado antes, no `Promise.race` de cada
 * provider, que lanca `GatewayTimeoutException` diretamente.
 *
 * @param ctx - Status + code/type extraidos do erro do vendor.
 * @returns A categoria canonica correspondente.
 */
export function classifyProviderError(ctx: ProviderErrorContext): AiErrorCategory {
  const { status } = ctx;
  if (status === 401) return 'auth';
  if (status === 429) {
    return isQuotaExhausted(ctx) ? 'quota' : 'rate_limit';
  }
  if (status === 529) return 'overloaded';
  // 5xx ou qualquer status nao mapeado → falha generica de upstream.
  return 'upstream';
}

/**
 * Traduz o contexto de erro do vendor diretamente para a `HttpException`
 * amigavel — atalho que combina `classifyProviderError` + `httpExceptionFor`.
 *
 * Ponto unico de traducao reutilizado pelos 3 providers. A `HttpException`
 * resultante NUNCA inclui a chave nem o corpo cru do vendor.
 *
 * @param ctx - Status + code/type do erro do vendor.
 * @param provider - Nome do provider (para a mensagem).
 * @returns `HttpException` pronta (502/503/504 conforme a categoria).
 */
export function translateProviderError(
  ctx: ProviderErrorContext,
  provider: string,
): HttpException {
  return httpExceptionFor(classifyProviderError(ctx), provider);
}

/**
 * Constroi a `GatewayTimeoutException` (504) canonica de timeout para um
 * provider. Usada pelo `Promise.race` de cada provider (o timeout local NAO
 * passa por `classifyProviderError` — e disparado antes de qualquer resposta
 * do vendor). Centraliza a mensagem amigavel de timeout.
 *
 * @param provider - Nome do provider (para a mensagem).
 * @returns `GatewayTimeoutException` com mensagem amigavel canonica.
 */
export function timeoutExceptionFor(provider: string): GatewayTimeoutException {
  return httpExceptionFor('timeout', provider) as GatewayTimeoutException;
}

/**
 * Heuristica para distinguir cota esgotada (billing) de rate limit temporario
 * dentro de um 429. OpenAI sinaliza via `error.code='insufficient_quota'`;
 * outros vendors podem usar `type`. Sem sinal explicito → assume rate limit
 * (temporario) por ser o caso mais comum e recuperavel.
 */
function isQuotaExhausted(ctx: ProviderErrorContext): boolean {
  const code = (ctx.code ?? '').toLowerCase();
  const type = (ctx.type ?? '').toLowerCase();
  return code.includes('insufficient_quota') || type.includes('insufficient_quota');
}

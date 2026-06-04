import { createHash } from 'crypto';
import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import OpenAI from 'openai';
import { AiKeyResolverService } from '../ai-key-resolver.service';
import {
  AiProvider,
  AiProviderChatOptions,
  AiProviderMessage,
  AiProviderResult,
  AiToolDefinition,
} from './ai-provider.interface';

/** Modelo OpenAI default — gpt-4o equilibra qualidade e custo.
 *  Pode ser sobrescrito por `opts.model` (override opcional). */
const OPENAI_MODEL = 'gpt-4o';

/** Hard limit do loop de tool calling (defesa em profundidade — R-5). */
const DEFAULT_MAX_TOOL_ITERATIONS = 5;

/** Timeout total por chamada `chat.completions.create` ao OpenAI (ms). */
const OPENAI_TIMEOUT_MS = 30_000;

/** Tamanho maximo do preview do resultado da tool no audit. */
const TOOL_RESULT_PREVIEW_MAX = 200;

/** Tool call no formato OpenAI (function calling). */
interface OpenAiToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** Mensagem do assistant retornada pelo OpenAI. */
interface OpenAiAssistantMessage {
  role: 'assistant';
  content: string | null;
  tool_calls?: OpenAiToolCall[];
}

/** Subconjunto da resposta `chat.completions.create` que este provider consome. */
interface OpenAiChatResponse {
  choices: Array<{
    message: OpenAiAssistantMessage;
    finish_reason: string | null;
  }>;
  usage?: { prompt_tokens?: number; completion_tokens?: number };
}

/** Mensagem no formato OpenAI enviada ao modelo (system/user/assistant/tool). */
type OpenAiMessageParam =
  | { role: 'system'; content: string }
  | { role: 'user'; content: string }
  | { role: 'assistant'; content: string | null; tool_calls?: OpenAiToolCall[] }
  | { role: 'tool'; tool_call_id: string; content: string };

/**
 * Provider OpenAI do Nexus — implementa `AiProvider`.
 *
 * Espelha integralmente a estrutura e as defesas do `GeminiProvider`, mudando
 * apenas o SDK e o formato de tool calling (OpenAI Chat Completions API):
 *  - `systemPrompt` vai como primeira mensagem `{ role:'system' }`.
 *  - Resultados de tool voltam como `{ role:'tool', tool_call_id }`.
 *  - A mensagem do assistant que pediu tools leva `tool_calls`.
 *  - Loop de tool calling enquanto a resposta tiver `message.tool_calls`.
 *
 * Responsabilidades:
 *  - Traduzir `AiProviderMessage[]` → `OpenAiMessageParam[]`.
 *  - Traduzir `AiToolDefinition[]` → tools OpenAI (`type:'function'`).
 *  - Executar o loop de tool calling (max 5 iteracoes — defesa contra loop
 *    infinito quando o modelo insiste em chamar uma tool com erro).
 *  - Aplicar timeout de 30s + 1 retry em 429/5xx.
 *  - Traduzir erros do vendor para `HttpException` apropriado, SEM vazar a
 *    chave ou o detalhe cru do vendor.
 *
 * Persistencia NAO eh responsabilidade deste provider — o `AiChatService`
 * eh quem persiste a mensagem do user (antes) e do assistant (depois).
 *
 * @see AiProvider — contrato implementado.
 * @see GeminiProvider — molde de referencia (mesmas defesas/estrutura).
 * @see ADR-V2-064 — multi-provider de IA + cascata de chave.
 */
@Injectable()
export class OpenAiProvider implements AiProvider {
  readonly name = 'openai';
  private readonly logger = new Logger(OpenAiProvider.name);

  constructor(private readonly keyResolver: AiKeyResolverService) {}

  /**
   * Executa uma rodada completa de chat com tool calling (OpenAI).
   *
   * Fluxo:
   *  1. Resolve API key via cascata (`AiKeyResolverService`).
   *  2. Cria cliente OpenAI (timeout no proprio SDK; retry manual).
   *  3. Monta `messages` com `system` na frente + historico.
   *  4. Loop ate `maxToolIterations`:
   *     a. `chat.completions.create(...)` (com timeout + retry 1x em 429/5xx).
   *     b. Se `message.tool_calls` → executa todas, anexa a msg do assistant
   *        (com tool_calls) + as msgs `role:'tool'`, repete.
   *     c. Caso contrario → fim do loop, captura `message.content`.
   *  5. Retorna `AiProviderResult` com audit das tools executadas.
   *
   * @throws {ServiceUnavailableException} OpenAI 429 (rate limit/quota).
   * @throws {GatewayTimeoutException} Timeout > 30s.
   * @throws {BadGatewayException} Outros erros do vendor (401/5xx persistentes).
   */
  async chat(opts: AiProviderChatOptions): Promise<AiProviderResult> {
    const apiKey = await this.keyResolver.resolveKey({
      provider: 'openai',
      ...(opts.orgId !== undefined ? { orgId: opts.orgId } : {}),
      ...(opts.userEntidadeId !== undefined ? { userEntidadeId: opts.userEntidadeId } : {}),
    });
    const maxIterations = opts.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    const modelName = opts.model ?? OPENAI_MODEL;

    // O SDK OpenAI faz timeout proprio; mantemos tambem a defesa manual
    // (Promise.race + 1 retry) para consistencia com o GeminiProvider.
    const client = new OpenAI({ apiKey, timeout: OPENAI_TIMEOUT_MS, maxRetries: 0 });

    const tools = opts.tools.map((t) => this.toOpenAiTool(t));

    if (opts.messages.length === 0) {
      throw new BadGatewayException('Historico vazio — nada a enviar para o provider');
    }
    // System prompt na frente; depois o historico mapeado.
    const messages: OpenAiMessageParam[] = [
      { role: 'system', content: opts.systemPrompt },
      ...opts.messages
        .map((m) => this.toOpenAiMessage(m))
        .filter((m): m is OpenAiMessageParam => m !== null),
    ];

    const executed: AiProviderResult['toolCallsExecuted'] = [];
    let iteration = 0;
    let lastUsage: { prompt_tokens?: number; completion_tokens?: number } | undefined;
    let finalText = '';
    let finishReason: string | undefined;

    while (iteration < maxIterations) {
      const response = await this.callWithTimeoutAndRetry(() =>
        client.chat.completions.create({
          model: modelName,
          messages: messages as unknown as OpenAI.Chat.ChatCompletionMessageParam[],
          ...(tools.length > 0 ? { tools } : {}),
        }) as unknown as Promise<OpenAiChatResponse>,
      );

      lastUsage = response.usage;
      const choice = response.choices[0];
      const message = choice?.message;
      const toolCalls = message?.tool_calls ?? [];

      if (toolCalls.length === 0) {
        finalText = message?.content ?? '';
        finishReason = this.mapFinishReason(choice?.finish_reason ?? null);
        break;
      }

      this.logger.debug(`openai_tool_calls iter=${iteration} count=${toolCalls.length}`);

      // A mensagem do assistant (com tool_calls) entra no historico.
      messages.push({
        role: 'assistant',
        content: message?.content ?? null,
        tool_calls: toolCalls,
      });

      // Executa todas as tool calls em paralelo. Erros sao capturados e
      // devolvidos ao modelo como mensagem role:'tool' — modelo decide reagir.
      const toolMessages = await Promise.all(
        toolCalls.map(async (call): Promise<OpenAiMessageParam> => {
          const tool = opts.tools.find((t) => t.name === call.function.name);
          const args = this.parseArgs(call.function.arguments);
          if (!tool) {
            this.logger.warn(`openai_tool_unknown name=${call.function.name}`);
            return {
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify({ error: `tool desconhecida: ${call.function.name}` }),
            };
          }
          try {
            const out = await tool.execute(args);
            const safeOut = this.normalizeToolOutput(out);
            executed.push({
              name: call.function.name,
              argsHash: this.hashArgs(args),
              resultPreview: this.previewOutput(safeOut),
            });
            return {
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify(safeOut),
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`openai_tool_failed name=${call.function.name} error=${message}`);
            executed.push({
              name: call.function.name,
              argsHash: this.hashArgs(args),
              resultPreview: `error: ${message}`.slice(0, TOOL_RESULT_PREVIEW_MAX),
            });
            return {
              role: 'tool',
              tool_call_id: call.id,
              content: JSON.stringify({ error: message }),
            };
          }
        }),
      );

      messages.push(...toolMessages);
      iteration++;
    }

    if (iteration >= maxIterations) {
      this.logger.warn(`openai_tool_loop_exceeded iterations=${iteration}`);
      finishReason = 'TOOL_LOOP_EXCEEDED';
      if (!finalText) {
        finalText =
          'Encontrei dificuldade para concluir a operacao apos varias tentativas. Pode me dar mais detalhes?';
      }
    }

    const tokensUsed = this.extractTokens(lastUsage);

    return {
      finalMessage: finalText,
      model: modelName,
      toolCallsExecuted: executed,
      ...(tokensUsed ? { tokensUsed } : {}),
      ...(finishReason ? { finishReason } : {}),
    };
  }

  // -------------------------------------------------------------------------
  // Helpers internos
  // -------------------------------------------------------------------------

  /**
   * Encapsula a chamada do SDK com:
   *  - Timeout duro de `OPENAI_TIMEOUT_MS` (Promise.race).
   *  - 1 retry em 429/5xx com backoff 1s.
   *  - Traducao de erros para HttpException apropriada.
   */
  private async callWithTimeoutAndRetry(
    fn: () => Promise<OpenAiChatResponse>,
  ): Promise<OpenAiChatResponse> {
    const attempt = async (): Promise<OpenAiChatResponse> => {
      let timerId: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timerId = setTimeout(
          () =>
            reject(
              new GatewayTimeoutException('A IA demorou demais para responder. Tente novamente.'),
            ),
          OPENAI_TIMEOUT_MS,
        );
      });
      try {
        return await Promise.race([fn(), timeout]);
      } finally {
        if (timerId) clearTimeout(timerId);
      }
    };

    try {
      return await attempt();
    } catch (err) {
      if (err instanceof GatewayTimeoutException) {
        throw err;
      }
      const status = this.extractHttpStatus(err);
      if (status === 429 || (status !== null && status >= 500 && status < 600)) {
        this.logger.warn(`openai_retry status=${status}`);
        await new Promise((r) => setTimeout(r, 1000));
        try {
          return await attempt();
        } catch (err2) {
          throw this.translateError(err2);
        }
      }
      throw this.translateError(err);
    }
  }

  private translateError(err: unknown): Error {
    if (err instanceof GatewayTimeoutException) return err;
    const status = this.extractHttpStatus(err);
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(`openai_error status=${status ?? '?'} message=${message}`);
    if (status === 401) {
      return new BadGatewayException('Configuracao da IA com problema. Contate o suporte.');
    }
    if (status === 429) {
      // 'insufficient_quota' e 'rate_limit_exceeded' ambos vem como 429;
      // ambos sao tratados como indisponibilidade temporaria para o usuario.
      return new ServiceUnavailableException(
        'Limite de uso da IA atingido. Tente em alguns segundos.',
      );
    }
    return new BadGatewayException('A IA falhou ao responder. Tente novamente em instantes.');
  }

  private extractHttpStatus(err: unknown): number | null {
    if (!err || typeof err !== 'object') return null;
    const anyErr = err as { status?: unknown; statusCode?: unknown; message?: string };
    if (typeof anyErr.status === 'number') return anyErr.status;
    if (typeof anyErr.statusCode === 'number') return anyErr.statusCode;
    if (typeof anyErr.message === 'string') {
      const match = anyErr.message.match(/\b(4\d\d|5\d\d)\b/);
      if (match) return parseInt(match[1], 10);
    }
    return null;
  }

  /** Converte uma tool do contrato para o formato OpenAI (function calling). */
  private toOpenAiTool(tool: AiToolDefinition): {
    type: 'function';
    function: { name: string; description: string; parameters: Record<string, unknown> };
  } {
    return {
      type: 'function',
      function: {
        name: tool.name,
        description: tool.description,
        parameters: tool.parameters,
      },
    };
  }

  /**
   * Traduz uma `AiProviderMessage` para o formato OpenAI.
   *
   * O system prompt e injetado separadamente (primeira mensagem) — mensagens
   * 'system' do historico sao ignoradas aqui para evitar duplicidade. 'tool'
   * de historico persistido e raro no fluxo atual e exige pareamento com um
   * tool_call anterior; representamos como texto user para nao quebrar a API.
   */
  private toOpenAiMessage(msg: AiProviderMessage): OpenAiMessageParam | null {
    if (msg.role === 'system') return null;
    if (msg.role === 'assistant') return { role: 'assistant', content: msg.content };
    return { role: 'user', content: msg.content };
  }

  /** Parseia os argumentos JSON da tool call (defensivo — pode vir malformado). */
  private parseArgs(raw: string): Record<string, unknown> {
    try {
      const parsed = JSON.parse(raw || '{}');
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        return parsed as Record<string, unknown>;
      }
      return {};
    } catch {
      return {};
    }
  }

  /** Mapeia `finish_reason` do OpenAI para o vocabulario do contrato. */
  private mapFinishReason(finishReason: string | null): string | undefined {
    if (!finishReason) return undefined;
    if (finishReason === 'stop') return 'STOP';
    if (finishReason === 'length') return 'MAX_TOKENS';
    return finishReason;
  }

  private extractTokens(
    usage: { prompt_tokens?: number; completion_tokens?: number } | undefined,
  ): { input?: number; output?: number } | undefined {
    if (!usage) return undefined;
    return {
      ...(typeof usage.prompt_tokens === 'number' ? { input: usage.prompt_tokens } : {}),
      ...(typeof usage.completion_tokens === 'number' ? { output: usage.completion_tokens } : {}),
    };
  }

  private normalizeToolOutput(out: unknown): Record<string, unknown> {
    if (out === null || out === undefined) return { result: null };
    if (typeof out === 'object' && !Array.isArray(out)) return out as Record<string, unknown>;
    return { result: out };
  }

  private previewOutput(out: Record<string, unknown>): string {
    try {
      const json = JSON.stringify(out);
      return json.length > TOOL_RESULT_PREVIEW_MAX
        ? json.slice(0, TOOL_RESULT_PREVIEW_MAX) + '...'
        : json;
    } catch {
      return '[unserializable]';
    }
  }

  private hashArgs(args: unknown): string {
    try {
      const json = JSON.stringify(args ?? {});
      return createHash('sha256').update(json).digest('hex').slice(0, 16);
    } catch {
      return 'nohash';
    }
  }
}

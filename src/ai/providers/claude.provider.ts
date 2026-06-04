import { createHash } from 'crypto';
import {
  BadGatewayException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import Anthropic from '@anthropic-ai/sdk';
import { AiKeyResolverService } from '../ai-key-resolver.service';
import {
  AiProvider,
  AiProviderChatOptions,
  AiProviderMessage,
  AiProviderResult,
  AiToolDefinition,
} from './ai-provider.interface';

/** Modelo Claude default — Sonnet 4.5 equilibra qualidade e custo.
 *  Pode ser sobrescrito por `opts.model` (override opcional). */
const CLAUDE_MODEL = 'claude-sonnet-4-5';

/** Limite de tokens de saida por chamada (obrigatorio na Messages API). */
const CLAUDE_MAX_TOKENS = 4096;

/** Hard limit do loop de tool calling (defesa em profundidade — R-5). */
const DEFAULT_MAX_TOOL_ITERATIONS = 5;

/** Timeout total por chamada `messages.create` ao Claude (ms). */
const CLAUDE_TIMEOUT_MS = 30_000;

/** Tamanho maximo do preview do resultado da tool no audit. */
const TOOL_RESULT_PREVIEW_MAX = 200;

/** Shape minimo de um content block de texto na resposta Anthropic. */
interface AnthropicTextBlock {
  type: 'text';
  text: string;
}

/** Shape minimo de um content block de tool_use na resposta Anthropic. */
interface AnthropicToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

/** Bloco generico da resposta (text | tool_use | outros ignorados). */
type AnthropicContentBlock = AnthropicTextBlock | AnthropicToolUseBlock | { type: string };

/** Subconjunto da resposta `messages.create` que este provider consome. */
interface AnthropicMessageResponse {
  content: AnthropicContentBlock[];
  stop_reason: string | null;
  usage?: { input_tokens?: number; output_tokens?: number };
}

/** Bloco de content de mensagem ENVIADA ao modelo (user/assistant). */
type AnthropicSendBlock =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }
  | {
      type: 'tool_result';
      tool_use_id: string;
      content: string;
      is_error?: boolean;
    };

/** Mensagem no formato Anthropic (sem role 'system' — esse vai no top-level). */
interface AnthropicMessageParam {
  role: 'user' | 'assistant';
  content: AnthropicSendBlock[];
}

/**
 * Provider Claude (Anthropic) do Nexus — implementa `AiProvider`.
 *
 * Espelha integralmente a estrutura e as defesas do `GeminiProvider`, mudando
 * apenas o SDK e o formato de tool calling (Anthropic Messages API):
 *  - `systemPrompt` vai no parametro `system` (top-level), NAO como mensagem.
 *  - Anthropic nao tem role 'system'/'tool' nas mensagens: resultados de tool
 *    voltam como `role:'user'` com content block `tool_result`.
 *  - Loop de tool calling enquanto `stop_reason === 'tool_use'`.
 *
 * Responsabilidades:
 *  - Traduzir `AiProviderMessage[]` → `AnthropicMessageParam[]`.
 *  - Traduzir `AiToolDefinition[]` → tools Anthropic (`name`, `description`,
 *    `input_schema`).
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
export class ClaudeProvider implements AiProvider {
  readonly name = 'claude';
  private readonly logger = new Logger(ClaudeProvider.name);

  constructor(private readonly keyResolver: AiKeyResolverService) {}

  /**
   * Executa uma rodada completa de chat com tool calling (Anthropic).
   *
   * Fluxo:
   *  1. Resolve API key via cascata (`AiKeyResolverService`).
   *  2. Cria cliente Anthropic (timeout + retries no proprio SDK).
   *  3. Monta `system` + `messages` (historico ja em formato Anthropic).
   *  4. Loop ate `maxToolIterations`:
   *     a. `messages.create(...)` (com timeout + retry 1x em 429/5xx).
   *     b. Se `stop_reason === 'tool_use'` → executa todos os blocos
   *        `tool_use`, devolve `tool_result` como `role:'user'`, repete.
   *     c. Caso contrario → fim do loop, captura texto final dos blocos `text`.
   *  5. Retorna `AiProviderResult` com audit das tools executadas.
   *
   * @throws {ServiceUnavailableException} Claude 429 (rate limit/overloaded).
   * @throws {GatewayTimeoutException} Timeout > 30s.
   * @throws {BadGatewayException} Outros erros do vendor (401/5xx persistentes).
   */
  async chat(opts: AiProviderChatOptions): Promise<AiProviderResult> {
    const apiKey = await this.keyResolver.resolveKey({
      provider: 'claude',
      ...(opts.orgId !== undefined ? { orgId: opts.orgId } : {}),
      ...(opts.userEntidadeId !== undefined ? { userEntidadeId: opts.userEntidadeId } : {}),
    });
    const maxIterations = opts.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    const modelName = opts.model ?? CLAUDE_MODEL;

    // O SDK Anthropic ja faz timeout + retry; mantemos tambem a defesa manual
    // (Promise.race + 1 retry) para consistencia com o GeminiProvider.
    const client = new Anthropic({ apiKey, timeout: CLAUDE_TIMEOUT_MS, maxRetries: 0 });

    const tools = opts.tools.map((t) => this.toAnthropicTool(t));

    if (opts.messages.length === 0) {
      throw new BadGatewayException('Historico vazio — nada a enviar para o provider');
    }
    const messages: AnthropicMessageParam[] = opts.messages
      .map((m) => this.toAnthropicMessage(m))
      .filter((m): m is AnthropicMessageParam => m !== null);

    const executed: AiProviderResult['toolCallsExecuted'] = [];
    let iteration = 0;
    let lastUsage: { input_tokens?: number; output_tokens?: number } | undefined;
    let finalText = '';
    let finishReason: string | undefined;

    while (iteration < maxIterations) {
      const createParams = {
        model: modelName,
        max_tokens: CLAUDE_MAX_TOKENS,
        system: opts.systemPrompt,
        messages,
        ...(tools.length > 0 ? { tools } : {}),
      } as unknown as Anthropic.MessageCreateParamsNonStreaming;

      const response = await this.callWithTimeoutAndRetry(
        () => client.messages.create(createParams) as unknown as Promise<AnthropicMessageResponse>,
      );

      lastUsage = response.usage;

      if (response.stop_reason !== 'tool_use') {
        finalText = this.extractText(response);
        finishReason = this.mapFinishReason(response.stop_reason);
        break;
      }

      // Extrai os blocos tool_use desta resposta.
      const toolUseBlocks = response.content.filter(
        (b): b is AnthropicToolUseBlock => b.type === 'tool_use',
      );

      this.logger.debug(`claude_tool_calls iter=${iteration} count=${toolUseBlocks.length}`);

      // A resposta do assistant (com os blocos tool_use) entra no historico.
      messages.push({
        role: 'assistant',
        content: response.content as unknown as AnthropicSendBlock[],
      });

      // Executa todas as tool calls em paralelo. Erros sao capturados e
      // devolvidos ao modelo como tool_result is_error — modelo decide reagir.
      const resultBlocks = await Promise.all(
        toolUseBlocks.map(async (block): Promise<AnthropicSendBlock> => {
          const tool = opts.tools.find((t) => t.name === block.name);
          if (!tool) {
            this.logger.warn(`claude_tool_unknown name=${block.name}`);
            return {
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ error: `tool desconhecida: ${block.name}` }),
              is_error: true,
            };
          }
          try {
            const out = await tool.execute(block.input ?? {});
            const safeOut = this.normalizeToolOutput(out);
            executed.push({
              name: block.name,
              argsHash: this.hashArgs(block.input),
              resultPreview: this.previewOutput(safeOut),
            });
            return {
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify(safeOut),
            };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`claude_tool_failed name=${block.name} error=${message}`);
            executed.push({
              name: block.name,
              argsHash: this.hashArgs(block.input),
              resultPreview: `error: ${message}`.slice(0, TOOL_RESULT_PREVIEW_MAX),
            });
            return {
              type: 'tool_result',
              tool_use_id: block.id,
              content: JSON.stringify({ error: message }),
              is_error: true,
            };
          }
        }),
      );

      // Os tool_result voltam como role:'user' (formato Anthropic).
      messages.push({ role: 'user', content: resultBlocks });
      iteration++;
    }

    if (iteration >= maxIterations) {
      this.logger.warn(`claude_tool_loop_exceeded iterations=${iteration}`);
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
   *  - Timeout duro de `CLAUDE_TIMEOUT_MS` (Promise.race).
   *  - 1 retry em 429/5xx com backoff 1s.
   *  - Traducao de erros para HttpException apropriada.
   */
  private async callWithTimeoutAndRetry(
    fn: () => Promise<AnthropicMessageResponse>,
  ): Promise<AnthropicMessageResponse> {
    const attempt = async (): Promise<AnthropicMessageResponse> => {
      let timerId: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timerId = setTimeout(
          () =>
            reject(
              new GatewayTimeoutException('A IA demorou demais para responder. Tente novamente.'),
            ),
          CLAUDE_TIMEOUT_MS,
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
        this.logger.warn(`claude_retry status=${status}`);
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
    this.logger.error(`claude_error status=${status ?? '?'} message=${message}`);
    if (status === 401) {
      return new BadGatewayException('Configuracao da IA com problema. Contate o suporte.');
    }
    if (status === 429) {
      return new ServiceUnavailableException(
        'Limite de uso da IA atingido. Tente em alguns segundos.',
      );
    }
    // 'overloaded' (529) do Anthropic tambem cai como indisponibilidade.
    if (status === 529) {
      return new ServiceUnavailableException(
        'A IA esta sobrecarregada no momento. Tente em alguns segundos.',
      );
    }
    return new BadGatewayException('A IA falhou ao responder. Tente novamente em instantes.');
  }

  private extractHttpStatus(err: unknown): number | null {
    if (!err || typeof err !== 'object') return null;
    const anyErr = err as { status?: unknown; statusCode?: unknown; message?: string };
    if (typeof anyErr.status === 'number') return anyErr.status;
    if (typeof anyErr.statusCode === 'number') return anyErr.statusCode;
    // SDK Anthropic as vezes embute o status no message.
    if (typeof anyErr.message === 'string') {
      const match = anyErr.message.match(/\b(4\d\d|5\d\d)\b/);
      if (match) return parseInt(match[1], 10);
    }
    return null;
  }

  /** Converte uma tool do contrato para o formato Anthropic. */
  private toAnthropicTool(tool: AiToolDefinition): {
    name: string;
    description: string;
    input_schema: Record<string, unknown>;
  } {
    return {
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters,
    };
  }

  /**
   * Traduz uma `AiProviderMessage` para o formato Anthropic.
   *
   * - 'system' → null (vai no parametro top-level `system`, nao no historico).
   * - 'assistant' → role 'assistant' com bloco de texto.
   * - 'user' / 'tool' → role 'user' com bloco de texto. (Mensagens 'tool' de
   *   historico ja persistido sao raras no fluxo atual; representamos como
   *   texto user para nao quebrar o contrato Anthropic de tool_result, que
   *   exige pareamento com um tool_use anterior na mesma sessao.)
   */
  private toAnthropicMessage(msg: AiProviderMessage): AnthropicMessageParam | null {
    if (msg.role === 'system') return null;
    const role: 'user' | 'assistant' = msg.role === 'assistant' ? 'assistant' : 'user';
    return { role, content: [{ type: 'text', text: msg.content }] };
  }

  /** Extrai e concatena o texto dos blocos `text` da resposta. */
  private extractText(response: AnthropicMessageResponse): string {
    try {
      return response.content
        .filter((b): b is AnthropicTextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('');
    } catch {
      return '';
    }
  }

  /** Mapeia `stop_reason` do Anthropic para o vocabulario do contrato. */
  private mapFinishReason(stopReason: string | null): string | undefined {
    if (!stopReason) return undefined;
    if (stopReason === 'end_turn' || stopReason === 'stop_sequence') return 'STOP';
    if (stopReason === 'max_tokens') return 'MAX_TOKENS';
    return stopReason;
  }

  private extractTokens(
    usage: { input_tokens?: number; output_tokens?: number } | undefined,
  ): { input?: number; output?: number } | undefined {
    if (!usage) return undefined;
    return {
      ...(typeof usage.input_tokens === 'number' ? { input: usage.input_tokens } : {}),
      ...(typeof usage.output_tokens === 'number' ? { output: usage.output_tokens } : {}),
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

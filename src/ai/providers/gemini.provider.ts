import { createHash } from 'crypto';
import { BadGatewayException, GatewayTimeoutException, Injectable, Logger } from '@nestjs/common';
import {
  FunctionCall,
  FunctionDeclaration,
  FunctionDeclarationSchema,
  FunctionDeclarationsTool,
  GenerateContentResult,
  GoogleGenerativeAI,
  Part,
} from '@google/generative-ai';
import { AiKeyResolverService } from '../ai-key-resolver.service';
import { toGeminiSchema } from './gemini-schema.util';
import {
  AiProvider,
  AiProviderChatOptions,
  AiProviderMessage,
  AiProviderResult,
  AiToolDefinition,
} from './ai-provider.interface';
import { timeoutExceptionFor, translateProviderError } from './provider-error.util';

/** Modelo Gemini default — flash equilibra custo e latencia para chat MVP.
 *  NOTA: gemini-1.5-* foi descontinuado pelo Google em 2025; 2.5-flash e o atual.
 *  Pode ser sobrescrito por `opts.model` (override opcional). */
const GEMINI_MODEL = 'gemini-2.5-flash';

/** Hard limit do loop de tool calling (defesa em profundidade — R-5). */
const DEFAULT_MAX_TOOL_ITERATIONS = 5;

/** Timeout total por chamada `sendMessage` ao Gemini (ms). */
const GEMINI_TIMEOUT_MS = 30_000;

/** Tamanho maximo do preview do resultado da tool no audit. */
const TOOL_RESULT_PREVIEW_MAX = 200;

/**
 * Provider Gemini do Nexus — implementa `AiProvider` para o `AiChatService`.
 *
 * Responsabilidades:
 *  - Traduzir `AiProviderMessage[]` → formato Gemini (`Content[]`).
 *  - Traduzir `AiToolDefinition[]` → `FunctionDeclarationsTool`.
 *  - Executar o loop de tool calling (max 5 iteracoes — defesa contra loop
 *    infinito quando o modelo insiste em chamar uma tool com erro).
 *  - Aplicar timeout de 30s + 1 retry em 429/5xx.
 *  - Traduzir erros do vendor para `HttpException` apropriado.
 *
 * Persistencia NAO eh responsabilidade deste provider — o `AiChatService`
 * eh quem persiste a mensagem do user (antes) e do assistant (depois).
 *
 * @see AiProvider — contrato implementado.
 * @see AiChatService — orquestrador que consome este provider.
 */
@Injectable()
export class GeminiProvider implements AiProvider {
  readonly name = 'gemini';
  private readonly logger = new Logger(GeminiProvider.name);

  constructor(private readonly keyResolver: AiKeyResolverService) {}

  /**
   * Executa uma rodada completa de chat com tool calling.
   *
   * Fluxo:
   *  1. Resolve API key.
   *  2. Cria cliente + modelo com system instruction + tools.
   *  3. Inicia chat session com historico (exceto a ultima mensagem do user).
   *  4. Loop ate `maxToolIterations`:
   *     a. `sendMessage(content)` (com timeout + retry 1x em 429/5xx).
   *     b. Se response tem `functionCalls()` → executa todas em paralelo,
   *        empacota como `functionResponse` parts, devolve ao modelo.
   *     c. Se nao tem → fim do loop, captura texto final.
   *  5. Retorna `AiProviderResult` com audit de tools executadas.
   *
   * @throws {ServiceUnavailableException} Gemini 429 persistente.
   * @throws {GatewayTimeoutException} Timeout > 30s.
   * @throws {BadGatewayException} Outros erros do vendor (401/5xx persistentes).
   */
  async chat(opts: AiProviderChatOptions): Promise<AiProviderResult> {
    const apiKey = await this.keyResolver.resolveKey({
      provider: 'gemini',
      ...(opts.orgId !== undefined ? { orgId: opts.orgId } : {}),
      ...(opts.userEntidadeId !== undefined ? { userEntidadeId: opts.userEntidadeId } : {}),
    });
    const maxIterations = opts.maxToolIterations ?? DEFAULT_MAX_TOOL_ITERATIONS;
    const modelName = opts.model ?? GEMINI_MODEL;

    const genAI = new GoogleGenerativeAI(apiKey);

    const tools: FunctionDeclarationsTool[] | undefined =
      opts.tools.length > 0
        ? [{ functionDeclarations: opts.tools.map((t) => this.toGeminiDeclaration(t)) }]
        : undefined;

    const model = genAI.getGenerativeModel({
      model: modelName,
      systemInstruction: opts.systemPrompt,
      ...(tools ? { tools } : {}),
    });

    // Separar a ultima mensagem do user (sera enviada via sendMessage) do
    // resto do historico (vai como `history` no startChat).
    const allMessages = opts.messages;
    const lastIdx = allMessages.length - 1;
    if (lastIdx < 0) {
      throw new BadGatewayException('Historico vazio — nada a enviar para o provider');
    }
    const lastMessage = allMessages[lastIdx];
    if (lastMessage.role !== 'user') {
      throw new BadGatewayException(
        `Ultima mensagem deve ser role=user (recebido: ${lastMessage.role})`,
      );
    }
    const history = allMessages
      .slice(0, lastIdx)
      .map((m) => this.toGeminiContent(m))
      .filter((c) => c !== null) as { role: string; parts: Part[] }[];

    const chat = model.startChat({ history });

    const executed: AiProviderResult['toolCallsExecuted'] = [];
    let iteration = 0;
    let result: GenerateContentResult = await this.callWithTimeoutAndRetry(() =>
      chat.sendMessage(lastMessage.content),
    );

    let finalText = '';
    let finishReason: string | undefined;

    while (iteration < maxIterations) {
      const calls: FunctionCall[] = result.response.functionCalls() ?? [];

      if (calls.length === 0) {
        // Sem tool calls — terminamos. Captura texto final + finishReason.
        finalText = this.safeText(result);
        finishReason = result.response.candidates?.[0]?.finishReason;
        break;
      }

      this.logger.debug(`gemini_tool_calls iter=${iteration} count=${calls.length}`);

      // Executa todas as tool calls em paralelo. Erros sao capturados e
      // devolvidos ao modelo como response — modelo decide como reagir.
      const responses = await Promise.all(
        calls.map(async (c) => {
          const tool = opts.tools.find((t) => t.name === c.name);
          if (!tool) {
            this.logger.warn(`gemini_tool_unknown name=${c.name}`);
            return {
              name: c.name,
              response: { error: `tool desconhecida: ${c.name}` } as Record<string, unknown>,
            };
          }
          try {
            const out = await tool.execute(c.args as Record<string, unknown>);
            const safeOut = this.normalizeToolOutput(out);
            executed.push({
              name: c.name,
              argsHash: this.hashArgs(c.args),
              resultPreview: this.previewOutput(safeOut),
            });
            return { name: c.name, response: safeOut };
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            this.logger.warn(`gemini_tool_failed name=${c.name} error=${message}`);
            executed.push({
              name: c.name,
              argsHash: this.hashArgs(c.args),
              resultPreview: `error: ${message}`.slice(0, TOOL_RESULT_PREVIEW_MAX),
            });
            return { name: c.name, response: { error: message } as Record<string, unknown> };
          }
        }),
      );

      // Empacota como functionResponse parts e manda de volta ao modelo.
      const parts: Part[] = responses.map((r) => ({
        functionResponse: { name: r.name, response: r.response },
      }));

      result = await this.callWithTimeoutAndRetry(() => chat.sendMessage(parts));
      iteration++;
    }

    if (iteration >= maxIterations) {
      this.logger.warn(`gemini_tool_loop_exceeded iterations=${iteration}`);
      finishReason = 'TOOL_LOOP_EXCEEDED';
      // Mesmo apos exceder, tentamos extrair o que houver de texto.
      finalText = this.safeText(result);
      if (!finalText) {
        finalText =
          'Encontrei dificuldade para concluir a operacao apos varias tentativas. Pode me dar mais detalhes?';
      }
    }

    const tokensUsed = this.extractTokens(result);

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
   *  - Timeout duro de `GEMINI_TIMEOUT_MS` (Promise.race).
   *  - 1 retry em 429/5xx com backoff 1s.
   *  - Traducao de erros para HttpException apropriada.
   */
  private async callWithTimeoutAndRetry(
    fn: () => Promise<GenerateContentResult>,
  ): Promise<GenerateContentResult> {
    const attempt = async (): Promise<GenerateContentResult> => {
      let timerId: NodeJS.Timeout | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timerId = setTimeout(() => reject(timeoutExceptionFor(this.name)), GEMINI_TIMEOUT_MS);
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
        this.logger.warn(`gemini_retry status=${status}`);
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

  /**
   * Traduz um erro do vendor para a `HttpException` amigavel canonica.
   *
   * A EXTRACAO do status/code e especifica do SDK Gemini; a TRADUCAO
   * (status HTTP + mensagem amigavel) e delegada ao util compartilhado
   * (`translateProviderError`), garantindo consistencia entre os 3 providers.
   * O detalhe tecnico vai apenas para o log — a `HttpException` devolvida ao
   * client tem mensagem generica (sem chave, sem corpo cru do vendor).
   */
  private translateError(err: unknown): Error {
    if (err instanceof GatewayTimeoutException) return err;
    const status = this.extractHttpStatus(err);
    const code = this.extractErrorCode(err);
    const message = err instanceof Error ? err.message : String(err);
    this.logger.error(`gemini_error status=${status ?? '?'} message=${message}`);
    return translateProviderError({ status, code }, this.name);
  }

  private extractHttpStatus(err: unknown): number | null {
    if (!err || typeof err !== 'object') return null;
    const anyErr = err as { status?: unknown; statusCode?: unknown; message?: string };
    if (typeof anyErr.status === 'number') return anyErr.status;
    if (typeof anyErr.statusCode === 'number') return anyErr.statusCode;
    // Gemini SDK as vezes embute no message: "[GoogleGenerativeAI Error]: ... [429 ...]".
    if (typeof anyErr.message === 'string') {
      const match = anyErr.message.match(/\b(4\d\d|5\d\d)\b/);
      if (match) return parseInt(match[1], 10);
    }
    return null;
  }

  /** Extrai o code/status textual do erro do vendor (para distinguir cota). */
  private extractErrorCode(err: unknown): string | null {
    if (!err || typeof err !== 'object') return null;
    const anyErr = err as { code?: unknown; status?: unknown };
    if (typeof anyErr.code === 'string') return anyErr.code;
    if (typeof anyErr.status === 'string') return anyErr.status;
    return null;
  }

  /**
   * Converte uma tool para o formato de `functionDeclaration` do Gemini.
   *
   * O `parameters` NÃO pode ser passado adiante como está: as tools vêm da camada
   * única de Capabilities (compartilhada com o MCP) e usam JSON Schema completo
   * — `type: ['string','null']`, `additionalProperties`, `uniqueItems`. O Gemini
   * valida contra um Protobuf derivado do OpenAPI e devolve **400** para qualquer
   * uma dessas palavras. Claude e OpenAI aceitam; o Gemini não.
   *
   * Aqui existia um `as unknown as FunctionDeclarationSchema` — um cast que calava
   * o compilador sem converter nada, e o erro só aparecia em produção.
   *
   * @see toGeminiSchema — a tradução JSON Schema → subconjunto do Gemini.
   */
  private toGeminiDeclaration(tool: AiToolDefinition): FunctionDeclaration {
    return {
      name: tool.name,
      description: tool.description,
      parameters: toGeminiSchema(tool.parameters) as unknown as FunctionDeclarationSchema,
    };
  }

  private toGeminiContent(msg: AiProviderMessage): { role: string; parts: Part[] } | null {
    // Gemini aceita roles 'user' e 'model' no historico. 'system' vai no
    // systemInstruction (nao no historico). 'tool'/'assistant' sao mapeados.
    if (msg.role === 'system') return null;
    const role = msg.role === 'assistant' ? 'model' : 'user';
    return {
      role,
      parts: [{ text: msg.content }],
    };
  }

  private safeText(result: GenerateContentResult): string {
    try {
      return result.response.text() ?? '';
    } catch {
      return '';
    }
  }

  private extractTokens(
    result: GenerateContentResult,
  ): { input?: number; output?: number } | undefined {
    const usage = result.response.usageMetadata;
    if (!usage) return undefined;
    return {
      ...(typeof usage.promptTokenCount === 'number' ? { input: usage.promptTokenCount } : {}),
      ...(typeof usage.candidatesTokenCount === 'number'
        ? { output: usage.candidatesTokenCount }
        : {}),
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

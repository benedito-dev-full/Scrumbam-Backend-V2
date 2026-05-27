/**
 * Contrato abstrato para providers de IA do Nexus.
 *
 * v1 implementa apenas `GeminiProvider`. Os tipos abaixo sao deliberadamente
 * genericos para que `ClaudeProvider` / `OpenAiProvider` (v2 — expansao futura)
 * possam ser plugados sem refactor no `AiChatService`.
 *
 * O provider e responsavel UNICAMENTE por:
 *  - Traduzir o array de mensagens em formato do SDK do vendor.
 *  - Executar o loop de tool calling ate o modelo retornar texto final
 *    ou o limite `maxToolIterations` ser atingido.
 *  - Devolver `{ finalMessage, model, toolCallsExecuted, tokensUsed }`
 *    para o orquestrador persistir.
 *
 * O provider NUNCA persiste nada — toda persistencia fica no
 * `AiChatService` / `ChatMessagesService`.
 *
 * @see GeminiProvider — implementacao v1.
 * @see AiChatService — orquestrador que consome o provider.
 */
export interface AiProviderMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  toolCallId?: string;
  toolName?: string;
}

/**
 * Definicao de uma tool exposta ao modelo (function calling).
 *
 * `parameters` deve ser um JSON Schema (Draft-07 compativel). `execute`
 * recebe os argumentos ja parseados pelo SDK do vendor + recebe `ctx`
 * com o `userEntidadeId` e `orgId` extraidos do JWT da request original
 * (a IA NUNCA escolhe quem e o user — isso vem do auth do request).
 */
export interface AiToolDefinition {
  readonly name: string;
  readonly description: string;
  readonly parameters: Record<string, unknown>; // JSON Schema
  execute(args: Record<string, unknown>): Promise<unknown>;
}

/**
 * Resultado de uma rodada completa de chat com tool calling.
 */
export interface AiProviderResult {
  /** Texto final produzido pelo modelo (apos todas as tool calls). */
  finalMessage: string;
  /** Nome do modelo usado (ex: 'gemini-1.5-flash'). */
  model: string;
  /** Auditoria das tools executadas — preview de cada chamada. */
  toolCallsExecuted: Array<{
    name: string;
    argsHash: string;
    resultPreview: string;
  }>;
  /** Tokens consumidos (best-effort — pode ser undefined). */
  tokensUsed?: { input?: number; output?: number };
  /** Razao de parada (ex: 'STOP', 'MAX_TOKENS', 'TOOL_LOOP_EXCEEDED'). */
  finishReason?: string;
}

/**
 * Parametros do `chat()`. Estrutura mantida estavel — adicoes futuras
 * devem ser via campos opcionais para nao quebrar implementacoes existentes.
 */
export interface AiProviderChatOptions {
  /** System prompt completo (personalidade Nexus). */
  systemPrompt: string;
  /** Historico de mensagens em ordem cronologica (mais antiga primeiro). */
  messages: AiProviderMessage[];
  /** Tools disponiveis nesta chamada. */
  tools: AiToolDefinition[];
  /** Limite duro de idas/voltas do loop de tool calling. Default: 5. */
  maxToolIterations?: number;
}

/**
 * Contrato que TODO provider de IA deve implementar.
 */
export interface AiProvider {
  /** Nome curto do provider (ex: 'gemini', 'claude', 'openai'). */
  readonly name: string;

  /**
   * Executa uma rodada completa de chat com tool calling.
   *
   * @throws Erro de provider (401/429/timeout) — `AiChatService` traduz
   *   para HTTP exception apropriada antes de devolver ao client.
   */
  chat(opts: AiProviderChatOptions): Promise<AiProviderResult>;
}

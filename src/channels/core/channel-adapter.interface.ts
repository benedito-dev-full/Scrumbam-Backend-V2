/**
 * Mensagem inbound normalizada — produzida pelo ChannelAdapter após parsear o payload bruto do canal.
 *
 * Permite que o MessageRouterService processe mensagens de qualquer canal de forma uniforme.
 */
export interface InboundMessage {
  /** chatId do canal externo (ex: Telegram chat.id). Sempre BigInt — nunca Number. */
  chatId: bigint;
  /** Tipo de mensagem. Comanda slash, texto livre ou voz. */
  type: 'text' | 'voice' | 'command';
  /** Texto da mensagem (para type='text'). */
  text?: string;
  /** Nome do comando sem a barra (ex: 'pair', 'tasks'). Para type='command'. */
  commandName?: string;
  /** Argumentos do comando (ex: ['<code>', '...']). Para type='command'. */
  commandArgs?: string[];
  /** File ID externo do arquivo de voz. Para type='voice'. */
  rawFileId?: string;
}

/**
 * Contrato de adaptador de canal.
 *
 * Cada canal de comunicação (Telegram, WhatsApp, Slack, etc.) implementa
 * esta interface para que o core de channels possa operar de forma desacoplada.
 *
 * Regras de implementação:
 * - `send` deve ser idempotente (reenvio ao mesmo chatId com mesmo texto é seguro)
 * - `parseInbound` deve lançar se o payload não for reconhecível
 * - `verifySignature` deve usar comparação em tempo constante (nunca `===`)
 * - `chatId` SEMPRE como BigInt — nunca parseInt ou Number
 *
 * @example
 * ```typescript
 * class TelegramAdapter implements ChannelAdapter {
 *   readonly channelName = 'telegram';
 *   async send(chatId: bigint, text: string): Promise<void> { ... }
 *   parseInbound(raw: unknown): InboundMessage { ... }
 *   verifySignature(payload: Buffer, signature: string): boolean { ... }
 * }
 * ```
 */
export interface ChannelAdapter {
  /** Nome único e imutável do canal. Usado em DVincula -483 dados.channelName. */
  readonly channelName: string;

  /**
   * Envia texto ao usuário identificado pelo chatId externo do canal.
   *
   * @param chatId - ID do chat no canal externo (BigInt)
   * @param text - Texto a enviar (markdown simples suportado)
   */
  send(chatId: bigint, text: string): Promise<void>;

  /**
   * Parseia o payload bruto recebido pelo webhook e retorna InboundMessage normalizado.
   *
   * @param raw - Payload bruto do webhook (unknown para forçar validação no adaptador)
   * @returns InboundMessage normalizado
   * @throws {Error} Se o payload não puder ser interpretado
   */
  parseInbound(raw: unknown): InboundMessage;

  /**
   * Verifica assinatura HMAC do webhook usando comparação em tempo constante.
   *
   * CRÍTICO: NUNCA usar `===` direto — vulnerável a timing attack.
   * Usar `crypto.timingSafeEqual`.
   *
   * @param payload - Buffer com o corpo do request
   * @param signature - Assinatura recebida no header
   * @returns true se a assinatura é válida
   */
  verifySignature(payload: Buffer, signature: string): boolean;
}

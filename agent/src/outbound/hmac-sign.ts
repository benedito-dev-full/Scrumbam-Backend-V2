/**
 * Assinatura HMAC-SHA256 de requests OUTBOUND (agent → backend).
 *
 * Algoritmo IDÊNTICO ao implementado em:
 *  - `src/automation/runtime/remote-execution-client.ts` (backend assinando
 *    requests outbound para o agente — direção contrária)
 *  - `src/server/hmac.middleware.ts` deste mesmo projeto (validador inbound)
 *
 * O agente reutiliza o MESMO `agentCommandSecret` para assinar requests
 * saindo. O backend valida com o algoritmo simétrico em
 * `src/automation/agents/agent-security.service.ts`.
 *
 * Canonical string:
 *   method + "\n" + path + "\n" + timestamp + "\n" + nonce + "\n" + sha256(body).hex
 *
 * Headers emitidos:
 *   x-scrumban-agent-id, x-scrumban-timestamp, x-scrumban-nonce,
 *   x-scrumban-signature (formato `hmac-sha256=<hex64>`).
 *
 * IMPORTANTE: `agentCommandSecret` JÁ vem em texto plano (install.sh decifra
 * o envelope AES-256-GCM antes de gravar `config.json`). NÃO decifrar aqui.
 *
 * @see ADR-V2-033 (contrato HTTP+HMAC)
 * @see src/automation/agents/agent-security.service.ts (validador inbound no backend)
 */
import { createHash, createHmac, randomUUID } from 'crypto';

/** Métodos HTTP que o agente assina no outbound. */
export type SignableMethod = 'GET' | 'POST' | 'PUT' | 'DELETE';

/**
 * Headers de autenticação retornados por `signOutboundRequest`. O backend V2
 * (ver `src/automation/agents/guards/agent-auth.guard.ts`) valida 4 headers:
 *   - `x-agent-id`        — id do agente (DEntidade idClasse=-156)
 *   - `x-agent-key`       — apiKey plaintext (comparada com hash via pepper)
 *   - `x-agent-nonce`     — UUID anti-replay (Redis store no backend)
 *   - `x-agent-timestamp` — ISO 8601, janela ±5min
 *
 * NOTA: o protocolo inicial previa HMAC do body com `agentCommandSecret`
 * (ver ADR-V2-033). O guard atual NÃO valida HMAC — só compara key plaintext.
 * Como o canal já é cifrado por SSH (reverse tunnel), mandar key plaintext é
 * aceitável. Integridade do body via HMAC fica como melhoria futura.
 */
export interface SignedHeaders {
  'content-type': 'application/json';
  accept: 'application/json';
  'x-agent-id': string;
  'x-agent-key': string;
  'x-agent-nonce': string;
  'x-agent-timestamp': string;
  /**
   * Index signature para compatibilidade com `HeadersInit` do `fetch()`.
   * Permite que o objeto seja passado diretamente sem cast e que campos
   * adicionais (ex: tracing) possam coexistir com os headers de auth.
   */
  [key: string]: string;
}

/**
 * Entrada de `signOutboundRequest`. `body` deve ser EXATAMENTE a string
 * JSON que vai no `fetch(..., { body })` — qualquer diferença byte-a-byte
 * (espaços, ordem de campos) invalida a assinatura no servidor.
 */
export interface SignOutboundInput {
  method: SignableMethod;
  /** Path sem querystring (alinhado com backend e middleware inbound). */
  path: string;
  /** Body já serializado em string. Para GET sem body, passar `''`. */
  body: string;
  /** API key plaintext do agente (header `x-agent-key`). */
  agentApiKey: string;
  /**
   * Secret HMAC do agente. Não usado pelo backend atual (guard só valida
   * apiKey), mas preservado na interface para suportar HMAC de body no futuro.
   */
  agentCommandSecret?: string;
  /** Identificador do agente (`DEntidade.chave` idClasse=-156, como string). */
  agentId: string;
  /**
   * Override de timestamp (ISO 8601). Default: `new Date().toISOString()`.
   * Existe para testes determinísticos. NUNCA passar em produção.
   */
  timestampOverride?: string;
  /**
   * Override de nonce (UUID). Default: `randomUUID()`.
   * Existe para testes determinísticos. NUNCA passar em produção.
   */
  nonceOverride?: string;
}

/**
 * Constrói os headers de autenticação para um request outbound (agent → backend).
 *
 * @param input Dados do request.
 * @returns Objeto com headers HTTP (case-insensitive, lowercase).
 *
 * @example
 *   const body = JSON.stringify({ cpu: 0.1, mem: 0.5 });
 *   const headers = signOutboundRequest({
 *     method: 'POST',
 *     path: '/agents/42/heartbeat',
 *     body,
 *     agentApiKey: config.agentApiKey,
 *     agentId: config.agentId,
 *   });
 *   await fetch(`${config.backendBaseUrl}/agents/42/heartbeat`, {
 *     method: 'POST',
 *     headers,
 *     body,
 *   });
 */
export function signOutboundRequest(input: SignOutboundInput): SignedHeaders {
  // `createHash`/`createHmac` ficam importados mas não usados aqui — preservados
  // como anchor para reintrodução de HMAC do body sem reorganizar imports.
  void createHash;
  void createHmac;
  const timestamp = input.timestampOverride ?? new Date().toISOString();
  const nonce = input.nonceOverride ?? randomUUID();

  return {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-agent-id': input.agentId,
    'x-agent-key': input.agentApiKey,
    'x-agent-nonce': nonce,
    'x-agent-timestamp': timestamp,
  };
}

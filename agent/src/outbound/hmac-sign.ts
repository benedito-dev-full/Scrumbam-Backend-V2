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
 * Headers HMAC padronizados retornados por `signOutboundRequest`. Inclui
 * `content-type` e `accept` por conveniência — o `backend-client` só
 * precisa fazer `fetch(url, { headers: { ...signed } })`.
 */
export interface SignedHeaders {
  'content-type': 'application/json';
  accept: 'application/json';
  'x-scrumban-agent-id': string;
  'x-scrumban-timestamp': string;
  'x-scrumban-nonce': string;
  'x-scrumban-signature': string;
  /**
   * Index signature para compatibilidade com `HeadersInit` do `fetch()`.
   * Permite que o objeto seja passado diretamente sem cast e que campos
   * adicionais (ex: tracing) possam coexistir com os headers HMAC.
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
  /** Secret HMAC já em texto plano (vide `AgentConfig.agentCommandSecret`). */
  agentCommandSecret: string;
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

const SIGNATURE_PREFIX = 'hmac-sha256=';

/**
 * Assina um request outbound e retorna os headers HMAC prontos para `fetch`.
 *
 * @param input Dados do request a assinar.
 * @returns Objeto com headers HTTP (case-insensitive, lowercase).
 *
 * @example
 *   const body = JSON.stringify({ cpu: 0.1, mem: 0.5 });
 *   const headers = signOutboundRequest({
 *     method: 'POST',
 *     path: '/agents/42/heartbeat',
 *     body,
 *     agentCommandSecret: config.agentCommandSecret,
 *     agentId: config.agentId,
 *   });
 *   await fetch(`${config.backendBaseUrl}/agents/42/heartbeat`, {
 *     method: 'POST',
 *     headers,
 *     body,
 *   });
 */
export function signOutboundRequest(input: SignOutboundInput): SignedHeaders {
  const timestamp = input.timestampOverride ?? new Date().toISOString();
  const nonce = input.nonceOverride ?? randomUUID();
  const method = input.method.toUpperCase();

  const bodyHash = createHash('sha256').update(input.body, 'utf8').digest('hex');
  const canonical = [method, input.path, timestamp, nonce, bodyHash].join('\n');
  const signatureHex = createHmac('sha256', input.agentCommandSecret)
    .update(canonical, 'utf8')
    .digest('hex');

  return {
    'content-type': 'application/json',
    accept: 'application/json',
    'x-scrumban-agent-id': input.agentId,
    'x-scrumban-timestamp': timestamp,
    'x-scrumban-nonce': nonce,
    'x-scrumban-signature': `${SIGNATURE_PREFIX}${signatureHex}`,
  };
}

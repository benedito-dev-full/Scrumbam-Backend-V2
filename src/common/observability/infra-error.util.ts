import { Prisma } from '@prisma/client';

/**
 * Classificação de uma exceção capturada no caminho de autenticação.
 *
 * - `isInfra` — a falha é de **infraestrutura** (banco, pool, Redis, timeout),
 *   NÃO de credencial. É a prova da hipótese B3 do plano ("lentidão de banco
 *   desloga usuário").
 * - `kind` — família do erro (`prisma_known`, `prisma_init`, `prisma_panic`,
 *   `redis`, `timeout`, `credential`, `unknown`).
 * - `code` — código do erro quando existe (ex: `P2024` = pool timeout).
 */
export interface InfraErrorInfo {
  isInfra: boolean;
  kind: string;
  code?: string;
  name?: string;
}

/**
 * Códigos Prisma que representam **falha de infraestrutura**, não erro de dado.
 *
 * P1001/P1002 — servidor inalcançável / timeout de conexão
 * P1008        — timeout de operação
 * P1010/P1011  — acesso negado / erro de TLS
 * P1017        — servidor fechou a conexão
 * P2024        — **pool esgotado** (o mais provável no incidente)
 * P2028/P2034  — transação abortada / write conflict sob carga
 */
const PRISMA_INFRA_CODES = new Set([
  'P1000',
  'P1001',
  'P1002',
  'P1008',
  'P1010',
  'P1011',
  'P1017',
  'P2024',
  'P2028',
  'P2034',
]);

/** Padrões de mensagem que denunciam falha de rede/infra (Redis, socket, DNS). */
const INFRA_MESSAGE_PATTERNS = [
  /econnrefused/i,
  /econnreset/i,
  /etimedout/i,
  /enotfound/i,
  /ehostunreach/i,
  /socket closed/i,
  /connection (is )?closed/i,
  /connection terminated/i,
  /timed? ?out/i,
  /redis/i,
  /pool/i,
];

/**
 * Classifica uma exceção capturada nos guards de autenticação.
 *
 * **F0 — apenas observação.** Esta função NÃO muda comportamento: quem chama
 * usa o resultado exclusivamente para escolher qual contador emitir. A decisão
 * de responder 503 em vez de 401 (D4 do plano) é da **F1**.
 *
 * @param err - Exceção capturada (tipo desconhecido)
 * @returns Classificação estruturada, segura para log (sem PII, sem stack)
 *
 * @example
 * ```typescript
 * try { await guard.canActivate(ctx); }
 * catch (err) {
 *   const info = classifyInfraError(err);
 *   if (info.isInfra) {
 *     this.metrics?.increment('auth.guard.infra_error', { code: info.code, kind: info.kind });
 *   }
 * }
 * ```
 */
export function classifyInfraError(err: unknown): InfraErrorInfo {
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    return {
      isInfra: PRISMA_INFRA_CODES.has(err.code),
      kind: 'prisma_known',
      code: err.code,
      name: err.name,
    };
  }

  if (err instanceof Prisma.PrismaClientInitializationError) {
    return {
      isInfra: true,
      kind: 'prisma_init',
      code: err.errorCode,
      name: err.name,
    };
  }

  if (err instanceof Prisma.PrismaClientRustPanicError) {
    return { isInfra: true, kind: 'prisma_panic', name: err.name };
  }

  if (err instanceof Prisma.PrismaClientUnknownRequestError) {
    return { isInfra: true, kind: 'prisma_unknown', name: err.name };
  }

  if (err instanceof Error) {
    const haystack = `${err.name} ${err.message}`;
    if (INFRA_MESSAGE_PATTERNS.some((pattern) => pattern.test(haystack))) {
      return { isInfra: true, kind: 'network_or_timeout', name: err.name };
    }
    return { isInfra: false, kind: 'credential', name: err.name };
  }

  return { isInfra: false, kind: 'unknown' };
}

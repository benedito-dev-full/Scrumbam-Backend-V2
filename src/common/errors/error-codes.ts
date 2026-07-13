/**
 * Catálogo de códigos de erro machine-readable (F1 — item 1.4 do plano
 * `plan-sessao-auth-hardening.md`; ancoragem: RFC 9457 — Problem Details).
 *
 * O `HttpExceptionFilter` propaga este campo (`code`) para o corpo do response:
 *
 * ```json
 * { "statusCode": 401, "code": "TOKEN_INVALID", "message": "…", "correlationId": "…" }
 * ```
 *
 * **Por que isto existe:** sem discriminador, o frontend não distingue
 * "seu refresh token não existe" de "o banco caiu" de "você não tem workspace" —
 * e trata tudo como logout. Foi uma das razões de o incidente ter sido tão
 * difícil de diagnosticar. Cada `code` mapeia para UMA ação de cliente:
 *
 * | code                      | HTTP | Ação esperada do cliente                    |
 * |---------------------------|------|---------------------------------------------|
 * | `TOKEN_EXPIRED`           | 401  | refresh silencioso + retry                   |
 * | `TOKEN_INVALID`           | 401  | logout (o token não serve para nada)         |
 * | `SESSION_REUSE_DETECTED`  | 401  | logout (sessão revogada por segurança)       |
 * | `SESSION_REVOKED`         | 401  | logout                                       |
 * | `NO_WORKSPACE`            | 403  | tela de onboarding (`<NoWorkspaces />`)      |
 * | `ORG_CONTEXT_STALE`       | 401  | refresh silencioso + retry (NÃO deslogar)    |
 * | `FORBIDDEN_ROLE`          | 403  | mostrar "sem permissão" (NÃO deslogar)       |
 * | `AUTH_BACKEND_UNAVAILABLE`| 503  | **backoff + retry — NUNCA deslogar**         |
 * | `INTERNAL_ERROR`          | 500  | mostrar erro genérico                        |
 *
 * @see HttpExceptionFilter — preserva o `code` no corpo do response
 */
export const AUTH_ERROR_CODES = {
  /** Access token expirado por idade — refresh silencioso resolve. */
  TOKEN_EXPIRED: 'TOKEN_EXPIRED',
  /** Token desconhecido/malformado — não corresponde a nenhuma sessão. */
  TOKEN_INVALID: 'TOKEN_INVALID',
  /** Replay REAL de refresh token detectado (RFC 9700) — sessão revogada. */
  SESSION_REUSE_DETECTED: 'SESSION_REUSE_DETECTED',
  /** Sessão revogada (logout, troca de senha, revoke administrativo). */
  SESSION_REVOKED: 'SESSION_REVOKED',
  /** Usuário autenticado, porém sem nenhuma workspace ativa (ADR-V2-038). */
  NO_WORKSPACE: 'NO_WORKSPACE',
  /**
   * O `organizationId` do JWT não corresponde mais a uma membership real
   * (usuário removido da org, org excluída, claim corrompido) — F4, item 4.2.
   *
   * **Não é logout.** O cliente deve fazer refresh silencioso (o novo token é
   * emitido com a org correta, ou órfão conforme ADR-V2-038) e **repetir** o
   * request. Antes da F4 este caso devolvia **200 com lista vazia** — o
   * usuário via "sumiram todos os meus projetos" e nada acusava.
   *
   * **Nunca** é emitido quando o usuário tem membership válida e simplesmente
   * não possui projetos (org nova / usuário novo) — esse caso continua 200 `[]`.
   */
  ORG_CONTEXT_STALE: 'ORG_CONTEXT_STALE',
  /** Autenticado e com acesso de leitura, mas sem o papel exigido. */
  FORBIDDEN_ROLE: 'FORBIDDEN_ROLE',
  /**
   * Falha de INFRAESTRUTURA no caminho de autenticação (pool do Postgres
   * esgotado, banco inalcançável, Redis fora, timeout).
   *
   * **NÃO é `invalid_token`** (RFC 6750) — por isso 503 e não 401. Responder
   * 401 aqui é mentira, e é literalmente o que derrubava o CEO quando o banco
   * ficava lento.
   */
  AUTH_BACKEND_UNAVAILABLE: 'AUTH_BACKEND_UNAVAILABLE',
  /** Exceção não-HTTP que escapou até o filter. */
  INTERNAL_ERROR: 'INTERNAL_ERROR',
} as const;

/** União dos códigos do catálogo. */
export type AuthErrorCode = (typeof AUTH_ERROR_CODES)[keyof typeof AUTH_ERROR_CODES];

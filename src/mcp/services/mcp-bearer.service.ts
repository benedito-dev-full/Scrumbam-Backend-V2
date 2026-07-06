import { createHash } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  createRemoteJWKSet,
  jwtVerify,
  type JWTPayload,
  type JWTVerifyGetKey,
} from 'jose';

import { ALL_MCP_SCOPES } from '../constants';
import type { McpUserContext } from '../interfaces/mcp.types';
import {
  MCP_OAUTH_SCOPE_CLAIM,
  MCP_OAUTH_SUBJECT_CLAIM,
  resolveMcpBearerConfig,
} from '../oauth.constants';

/**
 * Serviço de validação de Bearer tokens OAuth 2.1 emitidos pelo Auth0
 * (Reforma 2 — F2). O backend atua APENAS como Resource Server (RS) stateless:
 * valida o token contra o JWKS remoto do Auth0 e deriva um {@link McpUserContext}
 * — não persiste nada, não abre sessão.
 *
 * Biblioteca escolhida: **`jose`** (`createRemoteJWKSet` + `jwtVerify`). O plano
 * (ADR-V2-072, F6) lista `jwks-rsa`+passport como Alt A; `jose` é o fallback
 * explicitamente autorizado (Alt B) — API direta para `aud`/`iss`/`exp` sem
 * atrito com o provider assíncrono do passport. O `passport-jwt` existente é
 * HS256 simétrico e NÃO é reutilizável para o RS256+JWKS do Auth0.
 *
 * Segurança (RFC 8707 — audience binding, item nº1 do plano): o token TEM que
 * ter sido emitido para o NOSSO canonical resource URI. Um token com `aud`
 * diferente é rejeitado sem exceção (anti token-passthrough — a spec MCP
 * proíbe passthrough). `iss` e `exp` também são validados; qualquer falha
 * resulta em `null` (a exceção do `jose` nunca vaza para fora).
 *
 * Config-driven (espelha o pattern do `McpOriginGuard`): se as envs OAuth não
 * estiverem configuradas, `validate` devolve `null` (OAuth simplesmente não
 * está ativo) em vez de crashar — mantendo o comportamento aditivo.
 *
 * @see RFC 8707 (Resource Indicators — audience binding)
 * @see ADR-V2-072 (OAuth 2.1 Resource-Server-only, Auth0 como AS)
 * @see McpUserContext (shape produzido, idêntico ao caminho X-MCP-Key)
 */
@Injectable()
export class McpBearerService {
  private readonly logger = new Logger(McpBearerService.name);

  /**
   * Cache do JWKS remoto por `jwksUri`. `createRemoteJWKSet` já faz cache e
   * rotação de chaves internamente; memoizamos o `getKey` por URI para não
   * recriar o fetcher (e perder o cache) a cada request.
   */
  private jwksCache: { uri: string; getKey: JWTVerifyGetKey } | null = null;

  constructor(private readonly configService: ConfigService) {}

  /**
   * Valida um Bearer JWT do Auth0 e deriva o {@link McpUserContext}.
   *
   * Verifica, nesta ordem, via `jose.jwtVerify`: assinatura RS256 (JWKS
   * remoto), `iss` == issuer configurado, `aud` == canonical resource URI
   * (RFC 8707) e `exp` (não expirado). Qualquer falha — incluindo token
   * malformado, envs OAuth ausentes ou JWKS inacessível — resulta em `null`
   * (o motivo é logado em debug, sem vazar o token).
   *
   * O `McpUserContext` retornado tem o shape COMPLETO (todos os campos
   * não-opcionais) para que router, scope-enforcement (ADR-V2-068),
   * rate-limit (ADR-V2-011) e audit (-495) continuem intocados no caminho
   * OAuth. Valores sintéticos determinísticos são usados onde não há
   * DTabela-key (ver JSDoc dos métodos privados).
   *
   * @param token - O JWT cru (sem o prefixo `Bearer `).
   * @returns O `McpUserContext` derivado, ou `null` em qualquer falha.
   */
  async validate(token: string): Promise<McpUserContext | null> {
    const config = resolveMcpBearerConfig(this.configService);
    if (!config) {
      // OAuth não configurado — comportamento aditivo: não crashar.
      this.logger.debug('Validação Bearer ignorada: OAuth não configurado');
      return null;
    }

    if (!token || token.trim().length === 0) {
      this.logger.debug('Validação Bearer falhou: token ausente/vazio');
      return null;
    }

    let payload: JWTPayload;
    try {
      const getKey = this.getJwksKeyResolver(config.jwksUri);
      const result = await jwtVerify(token, getKey, {
        issuer: config.issuer,
        audience: config.audience,
        algorithms: ['RS256'],
      });
      payload = result.payload;
    } catch (error) {
      // Não confiar apenas no jwtVerify: qualquer falha (assinatura, iss, aud,
      // exp, malformado) cai aqui e vira null. Nunca vaza o token no log.
      const reason = error instanceof Error ? error.message : 'unknown';
      this.logger.debug(`Validação Bearer falhou: ${reason}`);
      return null;
    }

    // Defense-in-depth: reconfirmar o audience binding (RFC 8707) mesmo o
    // jwtVerify já tendo validado — a spec proíbe token passthrough.
    if (!this.audienceMatches(payload.aud, config.audience)) {
      this.logger.debug('Validação Bearer falhou: audience binding (RFC 8707)');
      return null;
    }

    const subject = this.extractSubject(payload);
    if (!subject) {
      this.logger.debug('Validação Bearer falhou: claim de identidade ausente');
      return null;
    }

    return {
      dEntidadeId: this.deriveSyntheticEntidadeId(subject),
      scopes: this.extractScopes(payload),
      keyChave: BigInt(0),
      keyPrefix: 'oauth',
      keyHash: this.deriveKeyHash(config.issuer, subject, config.audience),
    };
  }

  /**
   * Devolve (memoizado por URI) o resolver de chaves do JWKS remoto do Auth0.
   * `createRemoteJWKSet` cuida de cache, rotação e matching por `kid`.
   *
   * @param jwksUri - URI absoluta do JWKS do Authorization Server.
   * @returns O `getKey` a ser passado ao `jwtVerify`.
   */
  private getJwksKeyResolver(jwksUri: string): JWTVerifyGetKey {
    if (this.jwksCache && this.jwksCache.uri === jwksUri) {
      return this.jwksCache.getKey;
    }
    const getKey = createRemoteJWKSet(new URL(jwksUri));
    this.jwksCache = { uri: jwksUri, getKey };
    return getKey;
  }

  /**
   * Confere se o canonical resource URI está contido no claim `aud`. Aceita
   * `aud` como string única (igualdade) ou array (contém o URI) — RFC 8707.
   *
   * @param aud - O claim `aud` do token (string | string[] | undefined).
   * @param expected - O canonical resource URI esperado.
   * @returns `true` se o audience casa.
   */
  private audienceMatches(aud: JWTPayload['aud'], expected: string): boolean {
    if (typeof aud === 'string') {
      return aud === expected;
    }
    if (Array.isArray(aud)) {
      return aud.includes(expected);
    }
    return false;
  }

  /**
   * Extrai a identidade do sujeito do claim configurado (`sub` por padrão).
   *
   * @param payload - Payload validado do JWT.
   * @returns A string de identidade, ou `undefined` se ausente.
   */
  private extractSubject(payload: JWTPayload): string | undefined {
    const raw = payload[MCP_OAUTH_SUBJECT_CLAIM];
    return typeof raw === 'string' && raw.length > 0 ? raw : undefined;
  }

  /**
   * Mapeia o claim `scope` (string space-delimited, padrão Auth0) para o array
   * de scopes do MCP, descartando qualquer scope fora do catálogo canônico
   * {@link ALL_MCP_SCOPES} (ADR-V2-068 — previne privilege escalation por
   * scope arbitrário no token).
   *
   * @param payload - Payload validado do JWT.
   * @returns Os scopes reconhecidos (interseção com o catálogo).
   */
  private extractScopes(payload: JWTPayload): string[] {
    const raw = payload[MCP_OAUTH_SCOPE_CLAIM];
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      return [];
    }
    const requested = raw.split(/\s+/).filter((s) => s.length > 0);
    const catalog = new Set<string>(ALL_MCP_SCOPES);
    return requested.filter((scope) => catalog.has(scope));
  }

  /**
   * Deriva um `dEntidadeId` sintético e determinístico a partir do `sub` do
   * Auth0 (que é string, ex. `auth0|abc123`, sem mapeamento direto para uma
   * DEntidade). Usa SHA-256 do `sub` e converte os primeiros 8 bytes em BigInt
   * positivo — estável por identidade.
   *
   * LIMITAÇÃO (follow-up, ADR-V2-072 / risco MÉDIO do plano): este é um ID
   * SINTÉTICO, não uma DEntidade real. O mapeamento rico Auth0↔DEntidade é
   * trabalho futuro; não bloqueia conectar/listar tools no Claude Web.
   *
   * @param subject - O `sub` do token.
   * @returns Um `bigint` positivo determinístico para a identidade.
   */
  private deriveSyntheticEntidadeId(subject: string): bigint {
    const digest = createHash('sha256').update(subject).digest();
    // 8 bytes → BigInt; máscara para 63 bits mantém o valor positivo.
    const value = digest.readBigUInt64BE(0) & BigInt('0x7fffffffffffffff');
    return value;
  }

  /**
   * Deriva um `keyHash` estável e determinístico para a identidade OAuth,
   * usado como chave de rate-limit (ADR-V2-011) e de audit (F3). Mesma
   * identidade (`iss|sub|aud`) ⇒ mesmo `keyHash`, sempre.
   *
   * Prefixo `oauth:` distingue do hash de DTabela-key (caminho X-MCP-Key),
   * evitando colisão entre os dois espaços de identidade.
   *
   * @param issuer - Issuer do token.
   * @param subject - Sujeito (`sub`) do token.
   * @param audience - Canonical resource URI (audience validado).
   * @returns O `keyHash` no formato `oauth:<sha256hex>`.
   */
  private deriveKeyHash(issuer: string, subject: string, audience: string): string {
    const hex = createHash('sha256')
      .update(`${issuer}|${subject}|${audience}`)
      .digest('hex');
    return `oauth:${hex}`;
  }
}

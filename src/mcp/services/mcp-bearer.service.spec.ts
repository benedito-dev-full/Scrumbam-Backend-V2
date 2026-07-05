import { ConfigService } from '@nestjs/config';
import { Test } from '@nestjs/testing';
import {
  generateKeyPair,
  SignJWT,
  type KeyLike,
  type JWTVerifyGetKey,
} from 'jose';

import { McpBearerService } from './mcp-bearer.service';
import { McpKeyService } from './mcp-key.service';
import { McpRateLimitService } from './mcp-rate-limit.service';

/**
 * Suíte de validação do McpBearerService (Reforma 2 — F2).
 *
 * Estratégia: gerar um par RS256 real com `jose.generateKeyPair` e assinar
 * tokens de teste com `SignJWT`. O JWKS remoto é mockado fazendo o resolver
 * privado `getJwksKeyResolver` devolver a chave pública local — assim a
 * verificação de assinatura é REAL (não um `jwtVerify` mockado), cobrindo o
 * caminho de assinatura inválida de forma fidedigna.
 */
describe('McpBearerService', () => {
  const ISSUER = 'https://tenant.us.auth0.com/';
  const AUDIENCE = 'https://host.example.com/mcp';
  const JWKS_URI = 'https://tenant.us.auth0.com/.well-known/jwks.json';

  let service: McpBearerService;
  let publicKey: KeyLike;
  let privateKey: KeyLike;
  let otherPrivateKey: KeyLike;

  /** Config com OAuth totalmente configurado. */
  const oauthEnv: Record<string, string> = {
    MCP_OAUTH_RESOURCE_URI: AUDIENCE,
    MCP_OAUTH_ISSUER: ISSUER,
    MCP_OAUTH_JWKS_URI: JWKS_URI,
  };

  async function buildService(env: Record<string, string>): Promise<McpBearerService> {
    const module = await Test.createTestingModule({
      providers: [
        McpBearerService,
        {
          provide: ConfigService,
          useValue: { get: (key: string): string | undefined => env[key] },
        },
      ],
    }).compile();
    return module.get(McpBearerService);
  }

  /** Faz o resolver de JWKS devolver a chave pública local (mock do JWKS remoto). */
  function stubJwks(target: McpBearerService, key: KeyLike): void {
    const getKey: JWTVerifyGetKey = () => Promise.resolve(key);
    jest
      .spyOn(target as unknown as { getJwksKeyResolver: () => JWTVerifyGetKey }, 'getJwksKeyResolver')
      .mockReturnValue(getKey);
  }

  interface TokenOverrides {
    issuer?: string;
    audience?: string | string[];
    scope?: string;
    subject?: string;
    expiresIn?: string | number;
    signer?: KeyLike;
    omitSubject?: boolean;
  }

  async function signToken(overrides: TokenOverrides = {}): Promise<string> {
    const builder = new SignJWT({
      ...(overrides.scope !== undefined ? { scope: overrides.scope } : {}),
    })
      .setProtectedHeader({ alg: 'RS256' })
      .setIssuedAt()
      .setIssuer(overrides.issuer ?? ISSUER)
      .setAudience(overrides.audience ?? AUDIENCE)
      .setExpirationTime(overrides.expiresIn ?? '5m');

    if (!overrides.omitSubject) {
      builder.setSubject(overrides.subject ?? 'auth0|abc123');
    }

    return builder.sign(overrides.signer ?? privateKey);
  }

  beforeAll(async () => {
    ({ publicKey, privateKey } = await generateKeyPair('RS256'));
    ({ privateKey: otherPrivateKey } = await generateKeyPair('RS256'));
  });

  beforeEach(async () => {
    service = await buildService(oauthEnv);
    stubJwks(service, publicKey);
  });

  it('(a) token válido → retorna userCtx completo com identidade derivada', async () => {
    const token = await signToken({ scope: 'tasks:read tasks:write' });

    const ctx = await service.validate(token);

    expect(ctx).not.toBeNull();
    expect(ctx?.keyPrefix).toBe('oauth');
    expect(ctx?.keyChave).toBe(BigInt(0));
    expect(ctx?.scopes).toEqual(['tasks:read', 'tasks:write']);
    expect(typeof ctx?.dEntidadeId).toBe('bigint');
    expect(ctx?.dEntidadeId).toBeGreaterThan(BigInt(0));
    expect(ctx?.keyHash).toMatch(/^oauth:[a-f0-9]{64}$/);
  });

  it('(b) aud errado → null [BLOQUEANTE]', async () => {
    const token = await signToken({ audience: 'https://evil.example.com/mcp' });
    expect(await service.validate(token)).toBeNull();
  });

  it('(c) token expirado → null [BLOQUEANTE]', async () => {
    // `exp` como epoch absoluto no passado (jose v4 não aceita durações negativas).
    const token = await signToken({ expiresIn: Math.floor(Date.now() / 1000) - 3600 });
    expect(await service.validate(token)).toBeNull();
  });

  it('(d) assinatura inválida → null [BLOQUEANTE]', async () => {
    // Assinado por outra chave; o JWKS mockado só conhece a publicKey correta.
    const token = await signToken({ signer: otherPrivateKey });
    expect(await service.validate(token)).toBeNull();
  });

  it('(e) iss errado → null [BLOQUEANTE]', async () => {
    const token = await signToken({ issuer: 'https://attacker.us.auth0.com/' });
    expect(await service.validate(token)).toBeNull();
  });

  it('(f) scopes fora do catálogo ALL_MCP_SCOPES são descartados', async () => {
    const token = await signToken({ scope: 'tasks:read admin:root not:a:scope notifications:read' });

    const ctx = await service.validate(token);

    expect(ctx?.scopes).toEqual(['tasks:read', 'notifications:read']);
  });

  it('(g) mesmo iss|sub|aud ⇒ mesmo keyHash e dEntidadeId (determinístico)', async () => {
    const t1 = await signToken({ subject: 'auth0|stable', scope: 'tasks:read' });
    const t2 = await signToken({ subject: 'auth0|stable', scope: 'tasks:write' });

    const c1 = await service.validate(t1);
    const c2 = await service.validate(t2);

    expect(c1?.keyHash).toBe(c2?.keyHash);
    expect(c1?.dEntidadeId).toBe(c2?.dEntidadeId);
  });

  it('subjects diferentes ⇒ keyHash diferente', async () => {
    const t1 = await signToken({ subject: 'auth0|one' });
    const t2 = await signToken({ subject: 'auth0|two' });

    const c1 = await service.validate(t1);
    const c2 = await service.validate(t2);

    expect(c1?.keyHash).not.toBe(c2?.keyHash);
  });

  it('token com aud em array contendo o canonical URI → aceito', async () => {
    const token = await signToken({ audience: ['https://other/api', AUDIENCE] });
    expect(await service.validate(token)).not.toBeNull();
  });

  it('token sem claim de identidade (sub) → null', async () => {
    const token = await signToken({ omitSubject: true });
    expect(await service.validate(token)).toBeNull();
  });

  it('token sem claim de scope → userCtx com scopes vazios', async () => {
    const token = await signToken();
    const ctx = await service.validate(token);
    expect(ctx?.scopes).toEqual([]);
  });

  it('(h) envs OAuth ausentes ⇒ validate retorna null sem crashar', async () => {
    const noOauth = await buildService({});
    const token = await signToken();
    await expect(noOauth.validate(token)).resolves.toBeNull();
  });

  it('token vazio → null', async () => {
    expect(await service.validate('')).toBeNull();
    expect(await service.validate('   ')).toBeNull();
  });

  it('token malformado → null (sem vazar exceção)', async () => {
    expect(await service.validate('not-a-jwt')).toBeNull();
  });

  /**
   * Coerência rate-limit/audit do caminho Bearer (Reforma 2 — F3, DoD "a" e "c").
   *
   * Não altera a LÓGICA de rate-limit (ADR-V2-011): apenas prova que o `keyHash`
   * sintético (`oauth:<sha256>`) do Bearer é uma chave de rate-limit VÁLIDA e
   * ESTÁVEL por identidade, e que ele coexiste com o `keyHash` REAL do caminho
   * X-MCP-Key (namespaces disjuntos).
   */
  describe('coerência com rate-limit e X-MCP-Key (F3)', () => {
    /**
     * Redis in-memory keyed por chave `mcp:rl:*`. Reproduz o contrato usado por
     * `McpRateLimitService.check`: `multi().incr(key).expire(key,s).exec()`, com
     * `exec()` devolvendo `[[null, novoCount], [null, 1]]` (extractCount lê [0][1]).
     */
    function buildStatefulRedis(): {
      client: Parameters<McpRateLimitService['setRedisClientForTesting']>[0];
      counters: Map<string, number>;
    } {
      const counters = new Map<string, number>();
      const client = {
        multi() {
          let incrKey = '';
          const chain = {
            incr(key: string) {
              incrKey = key;
              return chain;
            },
            expire(_key: string, _seconds: number) {
              return chain;
            },
            async exec(): Promise<Array<[Error | null, unknown]>> {
              const next = (counters.get(incrKey) ?? 0) + 1;
              counters.set(incrKey, next);
              return [
                [null, next],
                [null, 1],
              ];
            },
          };
          return chain;
        },
      };
      return { client, counters };
    }

    function buildRateLimit(
      redis: ReturnType<typeof buildStatefulRedis>['client'],
    ): McpRateLimitService {
      const rl = new McpRateLimitService({
        get: () => undefined,
      } as unknown as ConstructorParameters<typeof McpRateLimitService>[0]);
      rl.setRedisClientForTesting(redis);
      return rl;
    }

    it('(a) keyHash do Bearer é chave de rate-limit válida e estável por identidade', async () => {
      const { client, counters } = buildStatefulRedis();
      const rateLimit = buildRateLimit(client);

      const t1 = await signToken({ subject: 'auth0|rl-stable', scope: 'tasks:read' });
      const t2 = await signToken({ subject: 'auth0|rl-stable', scope: 'tasks:write' });
      const c1 = await service.validate(t1);
      const c2 = await service.validate(t2);

      expect(c1?.keyHash).toBe(c2?.keyHash);

      const r1 = await rateLimit.check(c1!.keyHash);
      const r2 = await rateLimit.check(c2!.keyHash);

      // Mesma identidade OAuth ⇒ MESMA janela: o contador incrementa de 1 → 2.
      expect(r1.allowed).toBe(true);
      expect(r1.count).toBe(1);
      expect(r2.count).toBe(2);
      // Uma única chave Redis foi tocada (mesma janela), no namespace mcp:rl:oauth:*.
      expect(counters.size).toBe(1);
      expect([...counters.keys()][0]).toBe(`mcp:rl:${c1!.keyHash}`);
      expect([...counters.keys()][0]).toContain('mcp:rl:oauth:');
    });

    it('(a) identidades OAuth diferentes ⇒ janelas de rate-limit independentes', async () => {
      const { client, counters } = buildStatefulRedis();
      const rateLimit = buildRateLimit(client);

      const ctxA = await service.validate(await signToken({ subject: 'auth0|rl-a' }));
      const ctxB = await service.validate(await signToken({ subject: 'auth0|rl-b' }));

      expect(ctxA?.keyHash).not.toBe(ctxB?.keyHash);

      const a = await rateLimit.check(ctxA!.keyHash);
      const b = await rateLimit.check(ctxB!.keyHash);

      // Cada identidade tem seu próprio contador (ambos começam em 1).
      expect(a.count).toBe(1);
      expect(b.count).toBe(1);
      expect(counters.size).toBe(2);
    });

    it('(c) keyHash do Bearer (oauth:...) é disjunto do keyHash real do X-MCP-Key', async () => {
      const ctx = await service.validate(await signToken({ subject: 'auth0|coexist' }));

      // Caminho X-MCP-Key: hash REAL = sha256(plaintext), 64 hex SEM prefixo.
      const realKeyHash = McpKeyService.sha256Hex('scrumban_mcp_qualquer-plaintext');

      // Bearer: sempre prefixado por "oauth:"; X-MCP-Key: nunca.
      expect(ctx?.keyPrefix).toBe('oauth');
      expect(ctx?.keyHash.startsWith('oauth:')).toBe(true);
      expect(realKeyHash).toMatch(/^[a-f0-9]{64}$/);
      expect(realKeyHash.startsWith('oauth:')).toBe(false);
      expect(ctx?.keyHash).not.toBe(realKeyHash);

      // ⇒ chaves de rate-limit distintas (namespaces disjuntos), sem colisão.
      expect(`mcp:rl:${ctx!.keyHash}`).not.toBe(`mcp:rl:${realKeyHash}`);
    });
  });
});

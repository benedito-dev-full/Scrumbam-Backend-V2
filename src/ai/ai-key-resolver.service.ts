import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { encrypt, isEncrypted, tryDecrypt } from './crypto/ai-key-crypto';

/**
 * Providers de IA suportados pelo Nexus.
 *
 * Generalizacao multi-provider do `GeminiApiKeyService` (aposentado nesta
 * fase). Cada provider tem uma DClasse de chave dedicada (seed negativo) e
 * uma env var de fallback.
 */
export type AiProviderName = 'gemini' | 'claude' | 'openai';

/**
 * Argumentos do `resolveKey()`. `orgId` e `userEntidadeId` sao `bigint`
 * (regra do projeto — IDs sempre BigInt). Ambos opcionais: sem org/sem user
 * a cascata cai direto no nivel global (`dEntidadeId=null`) → env.
 */
export interface ResolveKeyArgs {
  /** Provider para o qual resolver a chave. */
  provider: AiProviderName;
  /** Org ativa (DEntidade -152). Quando presente, consulta nivel org. */
  orgId?: bigint;
  /**
   * User logado (DEntidade.chave). Quando presente E o nivel user estiver
   * ligado (`ENABLE_USER_LEVEL_KEYS`), consulta nivel user antes do org.
   */
  userEntidadeId?: bigint;
}

/** Configuracao estatica por provider: DClasse da chave + env var de fallback. */
interface ProviderKeyConfig {
  /** idClasse da DTabela onde a chave plaintext desse provider e gravada. */
  idClasse: bigint;
  /** Nome da env var consultada como ultimo fallback (dev local). */
  envVar: string;
}

/**
 * Mapa estatico provider → { idClasse, envVar }.
 *
 * Chaves negativas fixas vindas do seed (`prisma/seeds/classes.seed.ts`):
 *  - gemini → -481 GEMINI_API_KEY (compat retroativa com a v1 mono-provider).
 *  - claude → -482 CLAUDE_API_KEY.
 *  - openai → -483 OPENAI_API_KEY.
 *
 * Adicionar um provider novo = +1 entrada aqui + +1 DClasse no seed.
 */
const PROVIDER_KEY_CONFIG: Record<AiProviderName, ProviderKeyConfig> = {
  gemini: { idClasse: BigInt(-481), envVar: 'GOOGLE_API_KEY' },
  claude: { idClasse: BigInt(-482), envVar: 'ANTHROPIC_API_KEY' },
  openai: { idClasse: BigInt(-483), envVar: 'OPENAI_API_KEY' },
};

/**
 * Flag de feature do nivel "user" (BYOK pessoal) da cascata.
 *
 * Nesta leva o degrau user fica **previsto no codigo mas DESLIGADO**: o
 * resolver so consulta a DTabela com `dEntidadeId=userEntidadeId` quando esta
 * flag estiver ligada. Default `false`. Ligar via env
 * `ENABLE_USER_LEVEL_KEYS=true` (gravacao de chave por user e Fase futura — o
 * endpoint nao e exposto agora). Avaliada uma vez no load do modulo.
 *
 * @see ADR-V2-064 — cascata user→org→global→env.
 */
const ENABLE_USER_LEVEL_KEYS = process.env.ENABLE_USER_LEVEL_KEYS === 'true';

/** TTL do cache em memoria da chave resolvida por escopo (ms). */
const CACHE_TTL_MS = 60_000;

/**
 * Resolve a API key ativa de um provider de IA por escopo, em cascata.
 *
 * Generalizacao multi-provider e multi-nivel do antigo `GeminiApiKeyService`.
 * A cascata para no PRIMEIRO hit, nesta ordem:
 *
 *   1. **user**  — DTabela `dEntidadeId=userEntidadeId` (so se a flag
 *      `ENABLE_USER_LEVEL_KEYS` estiver ligada — degrau previsto, desligado).
 *   2. **org**   — DTabela `dEntidadeId=orgId` (se `orgId` fornecido).
 *   3. **global**— DTabela `dEntidadeId=null` (comportamento da v1 Gemini).
 *   4. **env**   — `process.env[envVar]` (fallback dev local).
 *
 * Nenhum nivel resolveu → `InternalServerErrorException` com mensagem
 * amigavel (operador ve no log e configura). Mesma estrutura de storage do
 * `ApiKeyService` (-471): a chave fica em `dados.plaintext` (string).
 *
 * **Cache:** em memoria, TTL 60s, por escopo (`provider|nivel|id`). Trocar de
 * org/provider nao serve chave de outro escopo. `invalidateCache()` limpa
 * tudo; `invalidateScope()` limpa um escopo (para futuro upsert/delete).
 *
 * **R-2 (ADR-V2-064):** a chave fica CIFRADA at-rest (AES-256-GCM, formato
 * `enc:v1:...`) em `dados.plaintext`. O resolver isola o ponto de leitura:
 * decifra via `tryDecrypt` e, ao encontrar um registro legado ainda em
 * plaintext, dispara uma auto-migracao best-effort (fire-and-forget) que o
 * regrava cifrado — sem bloquear a resposta e sem mudanca de schema.
 *
 * @see GeminiProvider — consumer principal (provider gemini).
 * @see ApiKeyService (-471) — padrao espelhado de storage de chave.
 * @see ADR-V2-064 — Provider Registry + cascata de resolucao de chave.
 */
@Injectable()
export class AiKeyResolverService {
  private readonly logger = new Logger(AiKeyResolverService.name);

  /** Cache por escopo (`provider|nivel|id`) → chave + expiracao. */
  private readonly cache = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve a chave ativa de um provider seguindo a cascata user→org→global→env.
   *
   * Para no primeiro nivel que tiver chave. Cada nivel resolvido e cacheado
   * por 60s no seu escopo. Nivel user e pulado quando a flag esta desligada.
   *
   * @param args - Provider + escopo (orgId/userEntidadeId opcionais).
   * @returns A chave plaintext (string) para uso interno do provider.
   *
   * @throws {InternalServerErrorException} Quando NENHUM nivel (user/org/
   *   global/env) tem chave configurada para o provider. A chave NUNCA e
   *   logada — apenas o nivel/fonte que a resolveu.
   *
   * @example
   * ```typescript
   * // Gemini sem org → cai em global/env (compat retroativa v1).
   * const key = await resolver.resolveKey({ provider: 'gemini' });
   *
   * // Claude com org → tenta org, depois global, depois env.
   * const key = await resolver.resolveKey({ provider: 'claude', orgId: BigInt(152) });
   * ```
   */
  async resolveKey(args: ResolveKeyArgs): Promise<string> {
    const { provider, orgId, userEntidadeId } = args;
    const config = PROVIDER_KEY_CONFIG[provider];
    if (!config) {
      // Provider fora do mapa estatico — bug de chamada (type guard runtime).
      this.logger.error(`ai_key_provider_unknown provider=${String(provider)}`);
      throw new InternalServerErrorException(
        'Configuracao da IA com problema. Contate o suporte.',
      );
    }

    const now = Date.now();

    // ── Nivel 1: user (degrau previsto, DESLIGADO por flag nesta fase). ──
    if (ENABLE_USER_LEVEL_KEYS && userEntidadeId !== undefined) {
      const scope = this.scopeKey(provider, 'user', userEntidadeId);
      const cached = this.readCache(scope, now);
      if (cached) return cached;
      const fromUser = await this.tryReadFromDTabela(config.idClasse, userEntidadeId);
      if (fromUser) {
        this.logger.debug(`ai_key_source=dtabela:user provider=${provider}`);
        return this.store(scope, fromUser, now);
      }
    }

    // ── Nivel 2: org (se orgId fornecido). ──
    if (orgId !== undefined) {
      const scope = this.scopeKey(provider, 'org', orgId);
      const cached = this.readCache(scope, now);
      if (cached) return cached;
      const fromOrg = await this.tryReadFromDTabela(config.idClasse, orgId);
      if (fromOrg) {
        this.logger.debug(`ai_key_source=dtabela:org provider=${provider}`);
        return this.store(scope, fromOrg, now);
      }
    }

    // ── Nivel 3: global (dEntidadeId=null — comportamento v1 Gemini). ──
    {
      const scope = this.scopeKey(provider, 'global', null);
      const cached = this.readCache(scope, now);
      if (cached) return cached;
      const fromGlobal = await this.tryReadFromDTabela(config.idClasse, null);
      if (fromGlobal) {
        this.logger.debug(`ai_key_source=dtabela:global provider=${provider}`);
        return this.store(scope, fromGlobal, now);
      }
    }

    // ── Nivel 4: env (fallback dev local). ──
    const fromEnv = process.env[config.envVar];
    if (fromEnv && fromEnv.length > 0) {
      this.logger.warn(
        `ai_key_source=env provider=${provider} envVar=${config.envVar} (fallback) — ` +
          `registrar DTabela ${config.idClasse.toString()} para producao (ADR-V2-004)`,
      );
      const scope = this.scopeKey(provider, 'env', null);
      return this.store(scope, fromEnv, now);
    }

    // ── Nada disponivel — erro explicito (chave nunca aparece no log). ──
    this.logger.error(
      `ai_key_missing provider=${provider} — nem DTabela ${config.idClasse.toString()} ` +
        `nem process.env.${config.envVar} configurados`,
    );
    throw new InternalServerErrorException(
      `Nenhuma chave de IA configurada para o provedor ${provider}. Contate o administrador.`,
    );
  }

  /**
   * Invalida TODO o cache em memoria.
   *
   * Chamar apos rotacao manual de chave em qualquer escopo (ex: admin UI
   * futura, seed manual em prod). Os escopos serao recomputados no proximo
   * `resolveKey`.
   */
  invalidateCache(): void {
    this.cache.clear();
  }

  /**
   * Invalida o cache de UM escopo (provider + nivel + dono).
   *
   * Util para upsert/delete de chave de uma org/user especifica sem derrubar
   * o cache dos demais escopos. Para `global`/`env`, `ownerId` = null.
   *
   * @param provider - Provider afetado.
   * @param level - Nivel da cascata (`user` | `org` | `global` | `env`).
   * @param ownerId - Dono do escopo (orgId/userEntidadeId) ou null para global/env.
   */
  invalidateScope(
    provider: AiProviderName,
    level: 'user' | 'org' | 'global' | 'env',
    ownerId: bigint | null,
  ): void {
    this.cache.delete(this.scopeKey(provider, level, ownerId));
  }

  // ---------------------------------------------------------------------------
  // Helpers internos
  // ---------------------------------------------------------------------------

  /**
   * Le a primeira DTabela ativa (nao excluida, nao inativa) do `idClasse` e
   * `dEntidadeId` informados, retornando a chave DECIFRADA ou null.
   *
   * `dEntidadeId=null` → chave global. `bigint` → chave de org/user.
   *
   * O valor lido pode estar cifrado (`enc:v1:...`) ou em plaintext legado.
   * `tryDecrypt` resolve ambos. Quando o registro ainda esta em plaintext,
   * dispara uma auto-migracao best-effort (fire-and-forget) que o regrava
   * cifrado, mantendo os demais campos de `dados` intactos — sem bloquear a
   * leitura e sem nunca logar a chave.
   */
  private async tryReadFromDTabela(
    idClasse: bigint,
    dEntidadeId: bigint | null,
  ): Promise<string | null> {
    const row = await this.prisma.dTabela.findFirst({
      where: {
        idClasse,
        dEntidadeId,
        excluido: false,
        inativo: false,
      },
      // `chave` (PK) e necessaria para a auto-migracao do registro legado.
      select: { chave: true, dados: true },
      orderBy: { chave: 'desc' }, // rotacao: pega a mais nova
    });

    if (!row) return null;

    const dados = row.dados as Record<string, unknown> | null;
    const raw = dados?.plaintext;
    if (typeof raw !== 'string' || raw.length === 0) {
      return null;
    }

    // Auto-migracao best-effort: registro legado em plaintext → regrava cifrado.
    if (!isEncrypted(raw) && row.chave !== undefined && row.chave !== null) {
      this.migrateToEncrypted(row.chave, dados ?? {}, raw);
    }

    // Decifra (cifrado) ou passa-through (legado). Adulteracao propaga erro.
    return tryDecrypt(raw);
  }

  /**
   * Auto-migracao best-effort de um registro legado para o formato cifrado.
   *
   * Fire-and-forget: o UPDATE roda fora do caminho de resposta; falhas sao
   * apenas logadas (sem a chave) e NUNCA quebram a leitura. Preserva todos os
   * campos de `dados`, trocando apenas `plaintext` pelo valor cifrado.
   *
   * @param chave - PK do registro DTabela a regravar.
   * @param dados - `dados` atual (preservado, exceto `plaintext`).
   * @param rawPlaintext - Valor plaintext legado a cifrar.
   */
  private migrateToEncrypted(
    chave: bigint,
    dados: Record<string, unknown>,
    rawPlaintext: string,
  ): void {
    let encryptedDados: Record<string, unknown>;
    try {
      encryptedDados = { ...dados, plaintext: encrypt(rawPlaintext) };
    } catch (err) {
      // Cifra falhou (ex: chave-mestra ausente) — leitura segue normal.
      this.logger.warn(
        `ai_key_automigrate_encrypt_failed chave=${chave.toString()} ` +
          `err=${(err as Error)?.message ?? 'unknown'}`,
      );
      return;
    }

    void this.prisma.dTabela
      .update({
        where: { chave },
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        data: { dados: encryptedDados as any },
      })
      .then(() => {
        this.logger.debug(`ai_key_automigrated chave=${chave.toString()}`);
      })
      .catch((err: unknown) => {
        // Best-effort: proximo read tenta de novo. Chave NUNCA e logada.
        this.logger.warn(
          `ai_key_automigrate_update_failed chave=${chave.toString()} ` +
            `err=${(err as Error)?.message ?? 'unknown'}`,
        );
      });
  }

  /** Monta a chave de cache de um escopo. */
  private scopeKey(
    provider: AiProviderName,
    level: 'user' | 'org' | 'global' | 'env',
    ownerId: bigint | null,
  ): string {
    return `${provider}|${level}|${ownerId === null ? 'null' : ownerId.toString()}`;
  }

  /** Le do cache se o escopo existir e nao estiver expirado. */
  private readCache(scope: string, now: number): string | null {
    const hit = this.cache.get(scope);
    if (hit && hit.expiresAt > now) return hit.value;
    return null;
  }

  /** Grava no cache com TTL e devolve o valor (acucar sintatico). */
  private store(scope: string, value: string, now: number): string {
    this.cache.set(scope, { value, expiresAt: now + CACHE_TTL_MS });
    return value;
  }
}

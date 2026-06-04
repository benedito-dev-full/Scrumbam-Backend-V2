import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';

/** idClasse da DTabela de preferencia de provider/modelo padrao da org. */
const ID_CLASSE_AI_PROVIDER_PREF = BigInt(-484);

/** TTL do cache em memoria da preferencia por org (ms). */
const CACHE_TTL_MS = 60_000;

/**
 * Preferencia de provider/modelo padrao de uma org (Nexus).
 *
 * `model` e opcional — quando ausente, o provider usa seu modelo default.
 */
export interface AiProviderPref {
  /** Provider preferido (ex: 'gemini', 'claude', 'openai'). */
  provider: string;
  /** Modelo preferido dentro do provider (ex: 'gemini-2.5-flash'). Opcional. */
  model?: string;
}

/**
 * Le/grava a preferencia de provider/modelo padrao de uma organizacao.
 *
 * Storage canonico: `DTabela idClasse=-484 AI_PROVIDER_PREF`, com
 * `dEntidadeId=orgId` e `dados={ provider, model? }`. Uma linha por org
 * (a mais nova vence em caso de rotacao). Acesso estrutural via Prisma
 * direto — Pilar 1 N/A (nao e tabela transacional).
 *
 * Nesta fase apenas o GETTER e usado (fallback do default global na cascata
 * de roteamento — Fase 4). O setter existe no service mas NAO e exposto por
 * controller (a exposicao via endpoint `PUT /ai/preference` e Fase 5).
 *
 * @see AiKeyResolverService — irmao (resolucao de chave).
 * @see ADR-V2-064 — Provider Registry + preferencia da org.
 */
@Injectable()
export class AiProviderPrefService {
  private readonly logger = new Logger(AiProviderPrefService.name);

  /** Cache por org (`orgId`) → preferencia + expiracao. */
  private readonly cache = new Map<string, { value: AiProviderPref | null; expiresAt: number }>();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Le a preferencia de provider/modelo padrao de uma org.
   *
   * Cache hit (TTL 60s) → retorna imediatamente. Miss → consulta a DTabela
   * -484 da org. Retorna `null` quando a org nao definiu preferencia (o
   * chamador cai no default global).
   *
   * @param orgId - Org ativa (DEntidade -152).
   * @returns `{ provider, model? }` ou `null` se nao houver preferencia valida.
   *
   * @example
   * ```typescript
   * const pref = await prefService.getDefaultForOrg(BigInt(152));
   * const provider = pref?.provider ?? 'gemini';
   * ```
   */
  async getDefaultForOrg(orgId: bigint): Promise<AiProviderPref | null> {
    const now = Date.now();
    const scope = orgId.toString();
    const cached = this.cache.get(scope);
    if (cached && cached.expiresAt > now) {
      return cached.value;
    }

    const row = await this.prisma.dTabela.findFirst({
      where: {
        idClasse: ID_CLASSE_AI_PROVIDER_PREF,
        dEntidadeId: orgId,
        excluido: false,
        inativo: false,
      },
      select: { dados: true },
      orderBy: { chave: 'desc' },
    });

    const pref = this.parsePref(row?.dados ?? null);
    this.cache.set(scope, { value: pref, expiresAt: now + CACHE_TTL_MS });
    return pref;
  }

  /**
   * Grava (upsert logico) a preferencia de provider/modelo padrao de uma org.
   *
   * NAO exposto por controller nesta fase (endpoint e Fase 5). Atualiza a
   * linha existente da org se houver; caso contrario cria. Invalida o cache
   * da org ao final.
   *
   * @param orgId - Org dona da preferencia.
   * @param pref - Provider (+ model opcional) a persistir.
   * @returns A preferencia persistida.
   */
  async setDefaultForOrg(orgId: bigint, pref: AiProviderPref): Promise<AiProviderPref> {
    const dadosObj: Record<string, unknown> = { provider: pref.provider };
    if (pref.model !== undefined) {
      dadosObj.model = pref.model;
    }
    const dados = dadosObj as Prisma.InputJsonValue;

    const existing = await this.prisma.dTabela.findFirst({
      where: {
        idClasse: ID_CLASSE_AI_PROVIDER_PREF,
        dEntidadeId: orgId,
        excluido: false,
      },
      select: { chave: true },
      orderBy: { chave: 'desc' },
    });

    if (existing) {
      await this.prisma.dTabela.update({
        where: { chave: existing.chave },
        data: { dados, inativo: false },
      });
    } else {
      await this.prisma.dTabela.create({
        data: {
          idClasse: ID_CLASSE_AI_PROVIDER_PREF,
          dEntidadeId: orgId,
          nome: `AI provider pref org=${orgId.toString()}`,
          dados,
        },
      });
    }

    this.cache.delete(orgId.toString());
    this.logger.log(`ai_provider_pref_set org=${orgId.toString()} provider=${pref.provider}`);
    return pref;
  }

  /** Invalida o cache de uma org especifica. */
  invalidate(orgId: bigint): void {
    this.cache.delete(orgId.toString());
  }

  /**
   * Extrai `{ provider, model? }` de `dados`, validando que `provider` e uma
   * string nao-vazia. Retorna null para dados ausentes/invalidos.
   */
  private parsePref(dados: unknown): AiProviderPref | null {
    if (!dados || typeof dados !== 'object') return null;
    const obj = dados as Record<string, unknown>;
    const provider = obj.provider;
    if (typeof provider !== 'string' || provider.length === 0) return null;
    const model = obj.model;
    return {
      provider,
      ...(typeof model === 'string' && model.length > 0 ? { model } : {}),
    };
  }
}

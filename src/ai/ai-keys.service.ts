import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { createHash } from 'crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { AiKeyResolverService } from './ai-key-resolver.service';
import { AiProviderName } from './dto/send-message.dto';
import { AiKeyResponseDto } from './dto/ai-key-response.dto';
import { encrypt, tryDecrypt } from './crypto/ai-key-crypto';

/**
 * Mapa estatico provider → idClasse da DTabela da chave.
 *
 * Espelha o `PROVIDER_KEY_CONFIG` do `AiKeyResolverService` (fonte de verdade
 * da resolucao). Mantido local porque o resolver nao exporta o mapa; um
 * provider novo exige +1 entrada aqui + +1 no resolver + +1 DClasse no seed.
 *
 * Chaves negativas fixas do seed (`prisma/seeds/classes.seed.ts`):
 *  - gemini → -481 GEMINI_API_KEY
 *  - claude → -482 CLAUDE_API_KEY
 *  - openai → -483 OPENAI_API_KEY
 */
const PROVIDER_ID_CLASSE: Record<AiProviderName, bigint> = {
  gemini: BigInt(-481),
  claude: BigInt(-482),
  openai: BigInt(-483),
};

/**
 * Prefixos esperados por provider (validacao TOLERANTE).
 *
 * Usado apenas para emitir `warn` quando a chave nao bate o prefixo tipico —
 * NUNCA rejeita (vendor pode mudar prefixo; validar demais quebra o cadastro).
 */
const EXPECTED_PREFIX: Record<AiProviderName, string> = {
  gemini: 'AIza',
  claude: 'sk-ant-',
  openai: 'sk-',
};

/** Tamanho do prefixo publico exposto na mascara (espelha -471: 8 chars). */
const PREFIX_LEN = 8;

/** Forma interna de `dados` de uma chave de IA em DTabela. */
interface AiKeyDados {
  /**
   * Chave cifrada at-rest (AES-256-GCM, formato `enc:v1:...`) — R-2/ADR-V2-064.
   * Registros legados podem conter plaintext cru; a leitura usa `tryDecrypt`.
   */
  plaintext: string;
  /** Prefixo publico (identificacao). */
  prefix: string;
  /** Hash SHA-256 do plaintext (deteccao de duplicata/integridade). */
  hash: string;
  /** DEntidade.chave do ADMIN que criou/rotacionou (string). */
  createdBy: string;
  /** ISO da criacao do registro. */
  createdAt: string;
  /** ISO da ultima rotacao (== createdAt na 1a gravacao). */
  lastRotatedAt: string;
}

/**
 * CRUD das chaves de IA por organizacao (nivel org da cascata).
 *
 * Grava/le/remove a chave plaintext de um provider em `DTabela -481/-482/-483`
 * com `dEntidadeId=orgId`. Cadastro estrutural — acesso Prisma direto (Pilar 1
 * N/A, sem Engine). Espelha o molde de mascaramento do `ApiKeyService` (-471).
 *
 * **Seguranca (ponto nº1 desta fase):**
 *  - O `plaintext` NUNCA aparece em resposta HTTP nem em log — sempre mascarado.
 *  - O `orgId` e sempre o do JWT (o controller injeta), nunca do body.
 *  - Toda escrita/remocao invalida o cache do `AiKeyResolverService` para o
 *    escopo `(provider, 'org', orgId)` — sem isso a chave nova so valeria apos
 *    o TTL de 60s do resolver.
 *
 * @see ApiKeyService (-471) — molde de masking/prefix/hash.
 * @see AiKeyResolverService — consumidor da chave (cascata user→org→global→env).
 * @see ADR-V2-004 — chaves em DTabela. ADR-V2-064 — cascata multi-provider.
 */
@Injectable()
export class AiKeysService {
  private readonly logger = new Logger(AiKeysService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly keyResolver: AiKeyResolverService,
  ) {}

  /**
   * Cadastra ou rotaciona a chave de um provider para a org.
   *
   * Rotacao por UPDATE no registro ativo existente (o resolver le
   * `orderBy chave desc`, logo o registro permanece o mais novo). Se nao
   * houver registro, cria um. Apos persistir, invalida o cache do resolver
   * para o escopo da org.
   *
   * Validacao de formato e TOLERANTE: rejeita apenas chave vazia/curta (ja
   * coberto pelo DTO); prefixo inesperado gera `warn`, nao erro.
   *
   * @param orgId - Org dona da chave (DEntidade -152), do JWT.
   * @param provider - Provider alvo (gemini/claude/openai).
   * @param plaintextKey - Chave plaintext a gravar.
   * @param createdByEntidadeId - DEntidade.chave do ADMIN executante.
   * @returns Resposta MASCARADA da chave (nunca o plaintext).
   *
   * @throws {BadRequestException} Provider fora do mapa (type guard runtime).
   *
   * @example
   * ```typescript
   * const masked = await service.upsertKey(
   *   BigInt(152), 'claude', 'sk-ant-...', BigInt(900),
   * );
   * // masked.masked === 'sk-ant-…f3a9'
   * ```
   */
  async upsertKey(
    orgId: bigint,
    provider: AiProviderName,
    plaintextKey: string,
    createdByEntidadeId: bigint,
  ): Promise<AiKeyResponseDto> {
    const idClasse = PROVIDER_ID_CLASSE[provider];
    if (idClasse === undefined) {
      throw new BadRequestException(`Provider de IA invalido: ${String(provider)}`);
    }

    const key = plaintextKey.trim();
    if (key.length === 0) {
      throw new BadRequestException('Chave de IA nao pode ser vazia');
    }

    // Validacao TOLERANTE: prefixo inesperado e warn, nao rejeicao.
    if (!key.startsWith(EXPECTED_PREFIX[provider])) {
      this.logger.warn(
        `ai_key_prefix_unexpected provider=${provider} org=${orgId.toString()} ` +
          `(esperado iniciar com "${EXPECTED_PREFIX[provider]}") — gravando mesmo assim`,
      );
    }

    const prefix = key.slice(0, PREFIX_LEN);
    const hash = createHash('sha256').update(key).digest('hex');
    const nowIso = new Date().toISOString();

    // Registro ativo existente da org para este provider (rotacao por update).
    const existing = await this.prisma.dTabela.findFirst({
      where: { idClasse, dEntidadeId: orgId, excluido: false },
      select: { chave: true, dados: true },
      orderBy: { chave: 'desc' },
    });

    if (existing) {
      const prev = (existing.dados as Record<string, unknown> | null) ?? {};
      const createdAt =
        typeof prev.createdAt === 'string' && prev.createdAt.length > 0
          ? prev.createdAt
          : nowIso;
      // `prefix`/`hash` derivam do `key` CRU (mascara/duplicata); persiste cifrado.
      const dados: AiKeyDados = {
        plaintext: encrypt(key),
        prefix,
        hash,
        createdBy: createdByEntidadeId.toString(),
        createdAt,
        lastRotatedAt: nowIso,
      };
      await this.prisma.dTabela.update({
        where: { chave: existing.chave },
        data: {
          codigo: prefix,
          dados: dados as unknown as Prisma.InputJsonValue,
          inativo: false,
        },
      });
      this.invalidate(provider, orgId);
      this.logger.log(`ai_key_rotated provider=${provider} org=${orgId.toString()}`);
      return this.toResponse(provider, { ...dados });
    }

    // `prefix`/`hash` derivam do `key` CRU (mascara/duplicata); persiste cifrado.
    const dados: AiKeyDados = {
      plaintext: encrypt(key),
      prefix,
      hash,
      createdBy: createdByEntidadeId.toString(),
      createdAt: nowIso,
      lastRotatedAt: nowIso,
    };
    await this.prisma.dTabela.create({
      data: {
        idClasse,
        nome: `AI key ${provider} org=${orgId.toString()}`,
        codigo: prefix,
        dEntidadeId: orgId,
        dados: dados as unknown as Prisma.InputJsonValue,
      },
    });
    this.invalidate(provider, orgId);
    this.logger.log(`ai_key_created provider=${provider} org=${orgId.toString()}`);
    return this.toResponse(provider, { ...dados });
  }

  /**
   * Lista as chaves da org (1 por provider que existir), SEMPRE mascaradas.
   *
   * Uma unica query (`idClasse in [...]`) — ZERO N+1. Para cada provider com
   * registro, devolve `{ provider, prefix, masked, configured:true, ... }`. O
   * `plaintext` NUNCA e devolvido.
   *
   * @param orgId - Org dona das chaves (do JWT).
   * @returns Lista de chaves mascaradas (uma por provider configurado).
   *
   * @example
   * ```typescript
   * const keys = await service.listKeys(BigInt(152));
   * // keys[0].masked === 'AIza…9xQ2' (sem plaintext)
   * ```
   */
  async listKeys(orgId: bigint): Promise<AiKeyResponseDto[]> {
    const idClasses = Object.values(PROVIDER_ID_CLASSE);
    const rows = await this.prisma.dTabela.findMany({
      where: { idClasse: { in: idClasses }, dEntidadeId: orgId, excluido: false },
      select: { idClasse: true, dados: true, chave: true },
      orderBy: { chave: 'desc' },
    });

    // Mapeia idClasse → provider (inverso do PROVIDER_ID_CLASSE).
    const classeToProvider = new Map<string, AiProviderName>(
      (Object.entries(PROVIDER_ID_CLASSE) as [AiProviderName, bigint][]).map(
        ([prov, cls]) => [cls.toString(), prov],
      ),
    );

    // 1 registro por provider (o mais novo — primeiro pelo orderBy desc).
    const seen = new Set<string>();
    const result: AiKeyResponseDto[] = [];
    for (const row of rows) {
      const classeKey = row.idClasse.toString();
      if (seen.has(classeKey)) continue;
      const provider = classeToProvider.get(classeKey);
      if (!provider) continue;
      seen.add(classeKey);
      const dados = (row.dados as Record<string, unknown> | null) ?? {};
      result.push(this.toResponse(provider, dados));
    }
    return result;
  }

  /**
   * Remove (soft-delete) a chave da org para um provider.
   *
   * Idempotencia: chave inexistente lanca `NotFoundException` (404). Apos a
   * remocao invalida o cache do resolver para o escopo da org.
   *
   * @param orgId - Org dona da chave (do JWT).
   * @param provider - Provider cuja chave sera removida.
   *
   * @throws {BadRequestException} Provider fora do mapa.
   * @throws {NotFoundException} Org nao tem chave deste provider.
   *
   * @example
   * ```typescript
   * await service.deleteKey(BigInt(152), 'openai');
   * ```
   */
  async deleteKey(orgId: bigint, provider: AiProviderName): Promise<void> {
    const idClasse = PROVIDER_ID_CLASSE[provider];
    if (idClasse === undefined) {
      throw new BadRequestException(`Provider de IA invalido: ${String(provider)}`);
    }

    const existing = await this.prisma.dTabela.findFirst({
      where: { idClasse, dEntidadeId: orgId, excluido: false },
      select: { chave: true },
      orderBy: { chave: 'desc' },
    });

    if (!existing) {
      throw new NotFoundException(`Org nao possui chave de ${provider} cadastrada`);
    }

    // Soft-delete de TODOS os registros ativos do escopo (defesa contra
    // multiplos registros legados do mesmo provider/org).
    await this.prisma.dTabela.updateMany({
      where: { idClasse, dEntidadeId: orgId, excluido: false },
      data: { excluido: true },
    });

    this.invalidate(provider, orgId);
    this.logger.log(`ai_key_deleted provider=${provider} org=${orgId.toString()}`);
  }

  /**
   * Disponibilidade por provider para a org (sem dado sensivel).
   *
   * Usado por `GET /ai/providers` (acessivel a membro). Retorna apenas
   * `configured:boolean` por provider — nunca prefixo/mascara/plaintext. ZERO
   * N+1 (1 query agregada).
   *
   * @param orgId - Org ativa (do JWT).
   * @returns Map provider → boolean (tem chave de org configurada).
   */
  async getConfiguredMap(orgId: bigint): Promise<Record<AiProviderName, boolean>> {
    const idClasses = Object.values(PROVIDER_ID_CLASSE);
    const rows = await this.prisma.dTabela.findMany({
      where: { idClasse: { in: idClasses }, dEntidadeId: orgId, excluido: false },
      select: { idClasse: true },
    });
    const present = new Set(rows.map((r) => r.idClasse.toString()));
    const map = {} as Record<AiProviderName, boolean>;
    for (const [prov, cls] of Object.entries(PROVIDER_ID_CLASSE) as [
      AiProviderName,
      bigint,
    ][]) {
      map[prov] = present.has(cls.toString());
    }
    return map;
  }

  // ---------------------------------------------------------------------------
  // Helpers internos
  // ---------------------------------------------------------------------------

  /** Invalida o cache do resolver para o escopo `(provider, 'org', orgId)`. */
  private invalidate(provider: AiProviderName, orgId: bigint): void {
    this.keyResolver.invalidateScope(provider, 'org', orgId);
  }

  /**
   * Monta a resposta MASCARADA a partir de `dados`. NUNCA inclui `plaintext`.
   *
   * Mascara = `prefix…ultimos4`. Para chaves muito curtas (impossivel pelo
   * DTO minLength=10), cai num placeholder seguro.
   */
  private toResponse(
    provider: AiProviderName,
    dados: Record<string, unknown>,
  ): AiKeyResponseDto {
    // `plaintext` em `dados` esta cifrado (novos) ou cru (legados). `tryDecrypt`
    // resolve ambos: cifrado → decifra; legado → passa-through. So a mascara
    // usa o resultado; o plaintext real NUNCA entra na resposta.
    const stored = typeof dados.plaintext === 'string' ? dados.plaintext : '';
    const plaintext = stored.length > 0 ? tryDecrypt(stored) : '';
    const prefix =
      typeof dados.prefix === 'string' && dados.prefix.length > 0
        ? dados.prefix
        : plaintext.slice(0, PREFIX_LEN);
    const suffix = plaintext.length >= 4 ? plaintext.slice(-4) : '';
    const masked = suffix ? `${prefix}…${suffix}` : `${prefix}…`;

    const response: AiKeyResponseDto = {
      provider,
      prefix,
      masked,
      configured: true,
    };
    if (typeof dados.createdAt === 'string') response.createdAt = dados.createdAt;
    if (typeof dados.lastRotatedAt === 'string') response.lastRotatedAt = dados.lastRotatedAt;
    return response;
  }
}

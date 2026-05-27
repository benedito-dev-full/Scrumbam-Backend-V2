import { Injectable, InternalServerErrorException, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';

/** idClasse da DTabela de chaves Gemini (seed Frente B — ADR-V2-004). */
const ID_CLASSE_GEMINI_API_KEY = BigInt(-481);

/**
 * Service responsavel por obter a API key do Gemini para chamadas ao provider.
 *
 * Precedencia (definida no plano canonico):
 *   1. DTabela idClasse=-481 com `dados.plaintext` (caminho canonico para prod).
 *      Padrao ADR-V2-004 — mesma estrutura do ApiKeyService (-471).
 *   2. `process.env.GOOGLE_API_KEY` (fallback para dev local — permite usar
 *      .env sem precisar rodar seed admin antes).
 *
 * Cache em memoria por 60s para evitar query a cada request (a key muda
 * raramente — apenas em rotacao manual via Prisma Studio em prod). Invalidacao
 * automatica pelo TTL.
 *
 * **v1: 1 chave global** (`dEntidadeId=null`). v2 multi-tenant: trocar para
 * `dEntidadeId=orgId` e cachear por org. Schema ja suporta — sem mudanca.
 *
 * **R-2 (plano):** plaintext armazenado SEM criptografia na v1. Decisao
 * CEO aceita conscientemente — sprint futura migra para Vault/KMS.
 *
 * @see ApiKeyService (-471) — padrao espelhado para storage de chaves.
 * @see GeminiProvider — consumer principal.
 */
@Injectable()
export class GeminiApiKeyService {
  private readonly logger = new Logger(GeminiApiKeyService.name);

  /** Cache curto da chave ja resolvida — TTL 60s. */
  private cachedKey: { value: string; expiresAt: number } | null = null;
  private static readonly CACHE_TTL_MS = 60_000;

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Resolve a API key ativa do Gemini.
   *
   * Cache hit → retorna imediatamente.
   * Cache miss → tenta DTabela -481 → tenta env GOOGLE_API_KEY → erro.
   *
   * @throws {InternalServerErrorException} Quando NEM DTabela NEM env tem
   *   chave disponivel. Mensagem amigavel para que o operador veja no log
   *   e configure antes do proximo request.
   */
  async getActiveKey(): Promise<string> {
    const now = Date.now();
    if (this.cachedKey && this.cachedKey.expiresAt > now) {
      return this.cachedKey.value;
    }

    // 1. Tentar DTabela -481 (canonico ADR-V2-004).
    const fromDb = await this.tryReadFromDTabela();
    if (fromDb) {
      this.cachedKey = { value: fromDb, expiresAt: now + GeminiApiKeyService.CACHE_TTL_MS };
      return fromDb;
    }

    // 2. Fallback: env var (dev local).
    const fromEnv = process.env.GOOGLE_API_KEY;
    if (fromEnv && fromEnv.length > 0) {
      this.logger.warn(
        'gemini_api_key_source=env (fallback) — registrar DTabela -481 para producao (ADR-V2-004)',
      );
      this.cachedKey = { value: fromEnv, expiresAt: now + GeminiApiKeyService.CACHE_TTL_MS };
      return fromEnv;
    }

    // 3. Nada disponivel — erro explicito.
    this.logger.error(
      'gemini_api_key_missing — nem DTabela -481 nem process.env.GOOGLE_API_KEY configurados',
    );
    throw new InternalServerErrorException('Configuracao da IA com problema. Contate o suporte.');
  }

  /**
   * Invalida o cache em memoria — chamar apos rotacao manual da key
   * (ex: admin UI futura). v1 nao expoe endpoint — basta reiniciar o servico.
   */
  invalidateCache(): void {
    this.cachedKey = null;
  }

  /**
   * Busca a primeira DTabela -481 ativa (nao excluida, nao inativa) com
   * `dados.plaintext` preenchida. Retorna null se nao encontrar.
   *
   * v1: filtra por `dEntidadeId=null` (chave global). v2 multi-tenant
   * recebera `orgId` para cruzar com `dEntidadeId`.
   */
  private async tryReadFromDTabela(): Promise<string | null> {
    const row = await this.prisma.dTabela.findFirst({
      where: {
        idClasse: ID_CLASSE_GEMINI_API_KEY,
        dEntidadeId: null,
        excluido: false,
        inativo: false,
      },
      select: { dados: true },
      orderBy: { chave: 'desc' }, // se houver multiplas (rotacao), pega a mais nova
    });

    if (!row) return null;

    const dados = row.dados as Record<string, unknown> | null;
    const plaintext = dados?.plaintext;
    if (typeof plaintext === 'string' && plaintext.length > 0) {
      this.logger.debug('gemini_api_key_source=dtabela');
      return plaintext;
    }

    return null;
  }
}

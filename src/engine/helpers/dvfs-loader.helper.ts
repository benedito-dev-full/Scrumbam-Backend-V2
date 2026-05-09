import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';

/**
 * DvfsLoaderHelper — carrega e cacheia scripts DVFS por idClasse.
 *
 * Implementa fallback por herança (CEO Q1 — 2026-05-09):
 * 1. Busca script em (idClasse=CONCRETO, chaveScript=N)
 * 2. Se não encontrar, sobe para (idClasse=-300, chaveScript=N)
 *
 * O seed inicial coloca todos os scripts em idClasse=-300.
 * F13 pode sobrescrever por nível de risco (-301/-302/-303) sem refatorar o loader.
 *
 * CRÍTICO ADR-V2-016: filtro usa row.chaveScript (campo INTEGER no schema V2).
 * NUNCA usar row.id — esse campo NÃO existe no schema Prisma V2.
 *
 * @see ADR-V2-016 (script-key-binding — s.chaveScript vs s.id)
 * @see ADR-V2-007 (DVFS portabilidade)
 */
export class DvfsLoaderHelper {
  private static readonly logger = new Logger(DvfsLoaderHelper.name);

  /** idClasse pai fallback: EXECUTION agrupador onde o seed inicial coloca todos os scripts */
  private static readonly FALLBACK_IDCLASSE = BigInt(-300);

  /** Cache por idClasse com TTL de 5min */
  private readonly cache = new Map<
    string,
    { scripts: Map<number, string>; loadedAt: number }
  >();

  private readonly TTL_MS = 5 * 60 * 1000; // 5 minutos

  /**
   * Carrega script DVFS para um chaveScript específico aplicando fallback:
   * 1. Tenta (idClasse=concreto, chaveScript=N)
   * 2. Se não encontrar, tenta (idClasse=-300, chaveScript=N)
   *
   * CRÍTICO ADR-V2-016: a busca é feita via campo `chaveScript` (INTEGER).
   * NUNCA filtrar por `chave` (PK BIGSERIAL) para selecionar o número do script.
   *
   * @param prisma PrismaService
   * @param idClasse idClasse da operação (ex: -300, -301, -302, -303)
   * @param chaveScript número do script (3, 4, 5, 6 ou 7)
   * @returns conteúdo do script ou undefined se ausente em ambos os níveis
   */
  async loadScript(
    prisma: PrismaService,
    idClasse: bigint,
    chaveScript: number,
  ): Promise<string | undefined> {
    // 1. Tenta idClasse concreto (ex: -301 EXEC_LOW, -302 EXEC_MED, -303 EXEC_HIGH)
    const concreto = await prisma.dVFS.findFirst({
      where: { idClasse, chaveScript, ativo: true },
      select: { conteudo: true },
    });
    if (concreto) return concreto.conteudo;

    // 2. Fallback para -300 (EXECUTION pai) — CEO Q1 aprovado 2026-05-09
    if (idClasse !== DvfsLoaderHelper.FALLBACK_IDCLASSE) {
      const fallback = await prisma.dVFS.findFirst({
        where: {
          idClasse: DvfsLoaderHelper.FALLBACK_IDCLASSE,
          chaveScript,
          ativo: true,
        },
        select: { conteudo: true },
      });
      if (fallback) return fallback.conteudo;
    }

    return undefined;
  }

  /**
   * Carrega todos os scripts (chaves 3-7) para um idClasse,
   * aplicando fallback por chave individualmente.
   *
   * Usa cache com TTL de 5 minutos para evitar round-trips ao banco
   * a cada operação (scripts raramente mudam).
   *
   * @param prisma PrismaService
   * @param idClasse idClasse da operação
   * @returns Map<chaveScript, conteudo> — scripts carregados (pode ser parcial)
   */
  async loadScripts(
    prisma: PrismaService,
    idClasse: bigint,
  ): Promise<Map<number, string>> {
    const cacheKey = idClasse.toString();
    const cached = this.cache.get(cacheKey);

    if (cached && Date.now() - cached.loadedAt < this.TTL_MS) {
      return cached.scripts;
    }

    const scripts = new Map<number, string>();

    // CRÍTICO ADR-V2-016: a chave do Map é chaveScript (número do script),
    // não row.chave (PK BIGSERIAL da linha DVFS).
    for (const chaveScript of [3, 4, 5, 6, 7]) {
      const conteudo = await this.loadScript(prisma, idClasse, chaveScript);
      if (conteudo !== undefined) {
        scripts.set(chaveScript, conteudo);
      }
    }

    this.cache.set(cacheKey, { scripts, loadedAt: Date.now() });
    return scripts;
  }

  /**
   * Invalida o cache para um idClasse específico.
   * Chamar quando um script DVFS for atualizado em runtime.
   */
  invalidate(idClasse: bigint): void {
    this.cache.delete(idClasse.toString());
    // Invalida também o fallback cache
    this.cache.delete(DvfsLoaderHelper.FALLBACK_IDCLASSE.toString());
    DvfsLoaderHelper.logger.log(`Cache DVFS invalidado para idClasse=${idClasse}`);
  }
}

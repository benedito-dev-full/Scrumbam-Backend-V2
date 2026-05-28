import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { TimezoneService } from '../common/services/timezone.service';

/** TTL do cache em memoria (ms). */
const CACHE_TTL_MS = 60_000;

/** Maximo de projetos recentes a listar no bloco. */
const MAX_RECENT_PROJECTS = 3;

/** Range canonico de idClasse das sprints (DTabela). Seed F1 -400..-419. */
const SPRINT_CLASSE_MIN = BigInt(-419);
const SPRINT_CLASSE_MAX = BigInt(-400);

/** DEvento idClasse NOTIFICATION. Seed F1 -490. */
const NOTIFICATION_CLASSE = BigInt(-490);

/**
 * Mapa idClasse (string) -> nome legivel do tipo de DProject.
 *
 * Cobre os 3 niveis canonicos da hierarquia self-referencial
 * (ADR-V2-051): SPACE -> FOLDER -> LIST.
 */
const TIPO_PROJETO: Record<string, string> = {
  '-350': 'SPACE',
  '-351': 'FOLDER',
  '-352': 'LIST',
};

/**
 * idClasses validos de DProject para o filtro de "projetos recentes"
 * (B3 — debito M1 da Etapa A). Sem o filtro, qualquer DProject de outra
 * categoria poluiria a listagem.
 */
const PROJETO_CLASSES_VALIDAS = [BigInt(-350), BigInt(-351), BigInt(-352)];

/** Estrutura interna do cache. */
interface CacheEntry {
  block: string;
  expiresAt: number;
}

/** Sprint corrente resolvido — usado apenas internamente. */
interface SprintCorrente {
  chave: bigint;
  nome: string;
  endDate: Date;
}

/**
 * Service que monta o bloco de contexto runtime injetado no system prompt
 * do Nexus IA chat (Etapas A + B).
 *
 * Objetivo: permitir que a IA responda com mais precisao SEM gastar tool
 * calls descobrindo contexto basico (nome do user, org, data, projetos
 * recentes, sprint corrente, notificacoes nao lidas). O bloco e
 * concatenado ao `SYSTEM_PROMPT_NEXUS` em cada request, ANTES da chamada
 * ao Gemini, dentro de `AiChatService.sendMessage`.
 *
 * Performance:
 *  - Cache em memoria com TTL de 60s por `${userId}:${orgId ?? '-'}`.
 *  - Cache miss: ATE 4 queries em paralelo via `Promise.allSettled`
 *    (entidades user+org, top 3 projetos, sprint corrente, unread count).
 *  - Cache hit: zero queries.
 *  - Defensive: falha de sprint/unread NAO derruba o bloco — apenas
 *    omite a secao volatil correspondente.
 *
 * Granularidade da data: `terca-feira, 28 de maio de 2026, tarde` —
 * deliberadamente AMPLA (manha/tarde/noite) para preservar prompt cache
 * do Gemini (segundos invalidariam o cache em todo request).
 *
 * Estrutura do bloco (B6 — divisao estavel/volatil):
 *  - Secao "Contexto do usuario" (ESTAVEL): user, org, projetos. Muda
 *    raramente. Vem PRIMEIRO para maximizar cache do prompt no Gemini.
 *  - Secao "Estado atual" (VOLATIL): data, sprint, notificacoes. Pode
 *    mudar a qualquer momento — fica no fim, fora do beneficio de cache.
 *
 * Invalidacao:
 *  - TTL de 60s como fallback geral.
 *  - `invalidate(userId)` chamado em `AiChatService.sendMessage` APOS
 *    o loop de tools, se alguma tool foi executada (B5 — event-driven).
 *  - Entradas expiradas sao removidas no proximo `build()` (B4).
 *
 * @see AiChatService — consumidor do bloco e chamador de `invalidate`.
 * @see system-prompt.ts — prompt estavel concatenado antes do bloco.
 */
@Injectable()
export class ContextBuilderService {
  private readonly logger = new Logger(ContextBuilderService.name);
  private readonly cache = new Map<string, CacheEntry>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly timezoneService: TimezoneService,
  ) {}

  /**
   * Monta o bloco de contexto markdown para o user/org informados.
   *
   * Usa cache em memoria (TTL 60s). Em cache miss, dispara queries em
   * paralelo via `Promise.allSettled` para coletar:
   *  - Nome do user + nome da org (1 query — `IN`)
   *  - Top 3 projetos mais recentes da organizacao (`atualizadoEm DESC`)
   *  - Sprint corrente da organizacao (se houver)
   *  - Contagem de notificacoes nao lidas do user
   *
   * Entradas de cache STALE (expiradas por TTL) sao removidas
   * automaticamente antes de recomputar (B4 — cleanup oportunista).
   *
   * Defensive: se as queries B1 (sprint) ou B2 (unread) falharem, o
   * bloco NAO quebra — apenas a secao correspondente e omitida. Logs
   * registram o erro para diagnostico.
   *
   * @param userEntidadeId - `DEntidade.chave` do user logado.
   * @param organizationId - `DEntidade.chave` da org ativa (opcional).
   * @returns Bloco markdown pronto para concatenar ao system prompt.
   *
   * @example
   * ```typescript
   * const block = await contextBuilder.build(BigInt(123), '456');
   * const finalPrompt = `${SYSTEM_PROMPT_NEXUS}\n\n${block}`;
   * ```
   */
  async build(userEntidadeId: bigint, organizationId?: string): Promise<string> {
    const cacheKey = `${userEntidadeId.toString()}:${organizationId ?? '-'}`;
    const now = Date.now();

    const cached = this.cache.get(cacheKey);
    if (cached && cached.expiresAt > now) {
      return cached.block;
    }

    // B4 — limpeza oportunista de entrada stale (cache miss por TTL).
    if (cached) {
      this.cache.delete(cacheKey);
    }

    this.logger.debug(
      `context_build_miss user=${userEntidadeId.toString()} org=${organizationId ?? '-'}`,
    );

    const block = await this.assembleBlock(userEntidadeId, organizationId);

    this.cache.set(cacheKey, {
      block,
      expiresAt: now + CACHE_TTL_MS,
    });

    return block;
  }

  /**
   * Invalida (remove) todas as entradas de cache de um usuario.
   *
   * Chamado por `AiChatService.sendMessage` apos o loop de tool calls
   * quando alguma tool foi executada (B5) — garante que a proxima
   * mensagem do user reflita estado novo (ex: task criada via tool
   * altera contadores). TTL de 60s permanece como fallback geral.
   *
   * @param userEntidadeId - `DEntidade.chave` do user cujo cache sera limpo.
   *
   * @example
   * ```typescript
   * // Apos loop de tools no AiChatService
   * if (result.toolCallsExecuted.length > 0) {
   *   contextBuilder.invalidate(userEntidadeId);
   * }
   * ```
   */
  invalidate(userEntidadeId: bigint): void {
    const prefix = `${userEntidadeId.toString()}:`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix)) {
        this.cache.delete(key);
      }
    }
  }

  /**
   * Monta o bloco do zero (cache miss). Faz queries em paralelo via
   * `Promise.allSettled` para que falhas de partes volateis nao
   * derrubem partes estaveis.
   */
  private async assembleBlock(userEntidadeId: bigint, organizationId?: string): Promise<string> {
    // Coleta IDs de DEntidade a buscar em UMA query (user + org juntos).
    const ids: bigint[] = [userEntidadeId];
    let orgIdBig: bigint | null = null;
    if (organizationId) {
      try {
        orgIdBig = BigInt(organizationId);
        if (orgIdBig !== userEntidadeId) {
          ids.push(orgIdBig);
        }
      } catch {
        // organizationId malformado — segue sem org.
        orgIdBig = null;
      }
    }

    // 4 queries em paralelo (Promise.allSettled — defensive):
    //  1. entidades user+org (1 query, IN)
    //  2. top 3 projetos da org filtrando SPACE/FOLDER/LIST (B3)
    //  3. sprint corrente da org (B1)
    //  4. unread count do user (B2)
    const [entidadesRes, projetosRes, sprintRes, unreadRes] = await Promise.allSettled([
      this.prisma.dEntidade.findMany({
        where: { chave: { in: ids }, excluido: false },
        select: { chave: true, nome: true },
      }),
      orgIdBig
        ? this.prisma.dProject.findMany({
            where: {
              idEstab: orgIdBig,
              excluido: false,
              idClasse: { in: PROJETO_CLASSES_VALIDAS },
            },
            select: { chave: true, nome: true, idClasse: true },
            orderBy: { atualizadoEm: 'desc' },
            take: MAX_RECENT_PROJECTS,
          })
        : Promise.resolve([] as Array<{ chave: bigint; nome: string; idClasse: bigint }>),
      orgIdBig ? this.findSprintCorrente(orgIdBig) : Promise.resolve(null as SprintCorrente | null),
      this.getUnreadCount(userEntidadeId),
    ]);

    // Entidades — fallback minimo se a unica query estavel falhar.
    const entidades = entidadesRes.status === 'fulfilled' ? entidadesRes.value : [];
    if (entidadesRes.status === 'rejected') {
      this.logger.warn(`context_entidades_failed: ${this.errMsg(entidadesRes.reason)}`);
    }

    const userEntidade = entidades.find((e) => e.chave === userEntidadeId);
    const orgEntidade = orgIdBig !== null ? entidades.find((e) => e.chave === orgIdBig) : null;

    const userNome = userEntidade?.nome ?? '(desconhecido)';
    const orgNome = orgEntidade?.nome ?? '(nao identificada)';

    const projetos = projetosRes.status === 'fulfilled' ? projetosRes.value : [];
    if (projetosRes.status === 'rejected') {
      this.logger.warn(`context_projetos_failed: ${this.errMsg(projetosRes.reason)}`);
    }

    const sprintCorrente = sprintRes.status === 'fulfilled' ? sprintRes.value : null;
    if (sprintRes.status === 'rejected') {
      this.logger.warn(`context_sprint_failed: ${this.errMsg(sprintRes.reason)}`);
    }

    const unreadCount = unreadRes.status === 'fulfilled' ? unreadRes.value : 0;
    if (unreadRes.status === 'rejected') {
      this.logger.warn(`context_unread_failed: ${this.errMsg(unreadRes.reason)}`);
    }

    // B6 — divisao estavel/volatil. Estavel vem primeiro para maximizar
    // prompt cache do Gemini.
    const lines: string[] = ['# CONTEXTO ATUAL', '', '## Contexto do usuario'];

    lines.push(`- **Usuario:** ${userNome} (#${userEntidadeId.toString()})`);
    lines.push(`- **Organizacao:** ${orgNome}`);

    if (projetos.length > 0) {
      lines.push('- **Projetos recentes:**');
      for (const p of projetos) {
        const tipo = TIPO_PROJETO[p.idClasse.toString()] ?? 'PROJECT';
        lines.push(`  * ${p.nome} (${tipo} #${p.chave.toString()})`);
      }
    }

    lines.push('', '## Estado atual');
    lines.push(`- **Data:** ${this.formatDataBrasilia(new Date())}`);

    if (sprintCorrente) {
      const diasRestantes = this.diasAteHoje(sprintCorrente.endDate);
      lines.push(
        `- **Sprint corrente:** ${sprintCorrente.nome} (#${sprintCorrente.chave.toString()}) — termina em ${diasRestantes} dia${diasRestantes === 1 ? '' : 's'}`,
      );
    }

    if (unreadCount > 0) {
      lines.push(`- **Notificacoes nao lidas:** ${unreadCount}`);
    }

    return lines.join('\n');
  }

  /**
   * Resolve a sprint corrente da organizacao.
   *
   * Sprint corrente = DTabela idClasse range -400..-419 ATIVA (nao excluida),
   * vinculada a um DProject da org via `dEntidadeId`, com
   * `dados.startDate <= hoje <= dados.endDate`. Se multiplas, escolhe a
   * que termina MAIS CEDO (mais relevante para o usuario AGORA).
   *
   * Implementado via `$queryRaw` para usar JOIN + filtros JSON-path
   * em uma unica query (ZERO N+1).
   */
  private async findSprintCorrente(orgIdBig: bigint): Promise<SprintCorrente | null> {
    const hoje = new Date();
    const hojeIso = hoje.toISOString().substring(0, 10); // YYYY-MM-DD

    const rows = await this.prisma.$queryRaw<
      Array<{ chave: bigint; nome: string; end_date: string }>
    >`
      SELECT t."chave", t."nome", t."dados"->>'endDate' AS end_date
      FROM "DTabela" t
      INNER JOIN "DProject" p ON p."chave" = t."dEntidadeId"
      WHERE t."idClasse" BETWEEN ${SPRINT_CLASSE_MIN} AND ${SPRINT_CLASSE_MAX}
        AND t."excluido" = false
        AND p."idEstab" = ${orgIdBig}
        AND p."excluido" = false
        AND (t."dados"->>'startDate') IS NOT NULL
        AND (t."dados"->>'endDate') IS NOT NULL
        AND (t."dados"->>'startDate') <= ${hojeIso}
        AND (t."dados"->>'endDate') >= ${hojeIso}
      ORDER BY (t."dados"->>'endDate') ASC
      LIMIT 1
    `;

    const row = rows[0];
    if (!row) return null;

    const endDate = new Date(row.end_date);
    if (Number.isNaN(endDate.getTime())) return null;

    return { chave: row.chave, nome: row.nome, endDate };
  }

  /**
   * Conta notificacoes nao lidas do user (DEvento idClasse=-490).
   *
   * Reusa o criterio canonico do `NotificationsService.getUnreadCount`:
   * `COALESCE((metaDados->>'read')::boolean, false) = false` — notificacoes
   * antigas sem o campo `read` contam como nao lidas.
   */
  private async getUnreadCount(userEntidadeId: bigint): Promise<number> {
    const rows = await this.prisma.$queryRaw<Array<{ count: bigint }>>`
      SELECT count(*)::bigint AS count
      FROM "DEvento"
      WHERE "idClasse" = ${NOTIFICATION_CLASSE}
        AND "idEntidade" = ${userEntidadeId}
        AND "excluido" = false
        AND COALESCE(("metaDados"->>'read')::boolean, false) = false
    `;
    return Number(rows[0]?.count ?? BigInt(0));
  }

  /**
   * Calcula quantos dias INTEIROS faltam ate `end` a partir de agora,
   * no timezone de Brasilia. Sempre retorna >= 0 (sprints expiradas
   * nao sao consideradas correntes no SQL — defesa adicional).
   */
  private diasAteHoje(end: Date): number {
    const agoraBR = this.timezoneService.toBrazilTime(new Date());
    const endBR = this.timezoneService.toBrazilTime(end);
    const msPorDia = 24 * 60 * 60 * 1000;
    const diff = Math.ceil((endBR.getTime() - agoraBR.getTime()) / msPorDia);
    return Math.max(0, diff);
  }

  /**
   * Formata uma data em PT-BR no timezone America/Sao_Paulo com
   * granularidade ampla de periodo do dia (manha/tarde/noite).
   *
   * Exemplo: `terca-feira, 28 de maio de 2026, tarde`.
   *
   * Granularidade ampla e deliberada — preserva o prompt cache do
   * Gemini entre requests proximos (segundos invalidariam o cache).
   */
  private formatDataBrasilia(date: Date): string {
    const zoned = this.timezoneService.toBrazilTime(date);

    const fmt = new Intl.DateTimeFormat('pt-BR', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      timeZone: 'America/Sao_Paulo',
    });
    const human = fmt.format(date); // ex: "terca-feira, 28 de maio de 2026"

    const hora = zoned.getHours();
    let periodo: string;
    if (hora < 12) {
      periodo = 'manha';
    } else if (hora < 18) {
      periodo = 'tarde';
    } else {
      periodo = 'noite';
    }

    return `${human}, ${periodo}`;
  }

  /** Helper minimo para extrair mensagem de erro de `Promise.allSettled`. */
  private errMsg(reason: unknown): string {
    if (reason instanceof Error) return reason.message;
    if (typeof reason === 'string') return reason;
    try {
      return JSON.stringify(reason);
    } catch {
      return '(unknown)';
    }
  }
}

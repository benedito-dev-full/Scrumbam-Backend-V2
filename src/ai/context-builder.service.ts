import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../prisma.service';
import { TimezoneService } from '../common/services/timezone.service';
import { ProjectsService } from '../projects/projects.service';
import { TasksService } from '../tasks/tasks.service';

/** TTL do cache em memoria (ms). */
const CACHE_TTL_MS = 60_000;

/** Maximo de projetos recentes a listar no bloco. */
const MAX_RECENT_PROJECTS = 3;

/** Maximo de tasks ativas (EXECUTING/READY) a listar na secao volatil. */
const MAX_ACTIVE_TASKS = 5;

/**
 * Status V3 considerados "trabalho ativo" do usuario, buscados em UMA query
 * (`statuses[]` — tasks.service.ts). EXECUTING = em andamento agora, READY =
 * proximo na fila. Ordem deliberada (EXECUTING antes de READY).
 */
const ACTIVE_TASK_STATUSES = ['EXECUTING', 'READY'];

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

/**
 * Service que monta o bloco de contexto runtime injetado no system prompt
 * do Nexus IA chat (Etapas A + B).
 *
 * Objetivo: permitir que a IA responda com mais precisao SEM gastar tool
 * calls descobrindo contexto basico (nome do user, org, data, projetos
 * recentes, notificacoes nao lidas). O bloco e
 * concatenado ao prompt de `buildSystemPrompt(toolsBlock)` em cada request, ANTES da chamada
 * ao Gemini, dentro de `AiChatService.sendMessage`.
 *
 * Performance:
 *  - Cache em memoria com TTL de 60s por `${userId}:${orgId ?? '-'}`.
 *  - Cache miss: ATE 4 entradas em paralelo via `Promise.allSettled`
 *    (entidades user+org, top 3 projetos, unread count, tasks ativas
 *    EXECUTING/READY do user).
 *  - Cache hit: zero queries.
 *  - Defensive: falha de unread OU de tasks ativas NAO derruba o bloco —
 *    apenas omite a secao volatil correspondente.
 *
 * Granularidade da data: `terca-feira, 28 de maio de 2026, tarde` —
 * deliberadamente AMPLA (manha/tarde/noite) para preservar prompt cache
 * do Gemini (segundos invalidariam o cache em todo request).
 *
 * Estrutura do bloco (B6 — divisao estavel/volatil):
 *  - Secao "Contexto do usuario" (ESTAVEL): user, org, projetos. Muda
 *    raramente. Vem PRIMEIRO para maximizar cache do prompt no Gemini.
 *  - Secao "Estado atual" (VOLATIL): data, notificacoes, tasks ativas. Pode
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
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Monta o bloco de contexto markdown para o user/org informados.
   *
   * Usa cache em memoria (TTL 60s). Em cache miss, dispara queries em
   * paralelo via `Promise.allSettled` para coletar:
   *  - Nome do user + nome da org (1 query — `IN`)
   *  - Top 3 projetos mais recentes da organizacao (`atualizadoEm DESC`)
   *  - Contagem de notificacoes nao lidas do user
   *  - Tasks ativas do user (EXECUTING/READY, top 5, escopadas — ADR-V2-042)
   *
   * Entradas de cache STALE (expiradas por TTL) sao removidas
   * automaticamente antes de recomputar (B4 — cleanup oportunista).
   *
   * Defensive: se a query de unread OU a de tasks ativas falhar, o
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
   * const finalPrompt = `${buildSystemPrompt(toolsBlock)}\n\n${block}`;
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

    // 4 entradas em paralelo (Promise.allSettled — defensive):
    //  1. entidades user+org (1 query, IN)
    //  2. top 3 projetos da org filtrando SPACE/FOLDER/LIST (B3)
    //  3. unread count do user (B2)
    //  4. tasks ativas EXECUTING/READY do user (top 5, escopadas — ADR-V2-042)
    const [entidadesRes, projetosRes, unreadRes, activeTasksRes] = await Promise.allSettled([
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
      this.getUnreadCount(userEntidadeId),
      this.getActiveTasks(userEntidadeId),
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

    const unreadCount = unreadRes.status === 'fulfilled' ? unreadRes.value : 0;
    if (unreadRes.status === 'rejected') {
      this.logger.warn(`context_unread_failed: ${this.errMsg(unreadRes.reason)}`);
    }

    const activeTasks = activeTasksRes.status === 'fulfilled' ? activeTasksRes.value : [];
    if (activeTasksRes.status === 'rejected') {
      this.logger.warn(`context_active_tasks_failed: ${this.errMsg(activeTasksRes.reason)}`);
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

    if (unreadCount > 0) {
      lines.push(`- **Notificacoes nao lidas:** ${unreadCount}`);
    }

    if (activeTasks.length > 0) {
      lines.push('- **Suas tasks ativas (EXECUTING/READY):**');
      for (const t of activeTasks) {
        const label = t.identifier && t.identifier.trim() !== '' ? t.identifier : `#${t.id}`;
        lines.push(`  * ${label} ${t.nome} — ${t.status}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Busca as tasks ativas (EXECUTING + READY) atribuidas ao user, em UMA
   * query, escopadas aos projetos acessiveis.
   *
   * Reusa `ProjectsService.findAccessibleProjectIds` + `TasksService.findMany`
   * (Pilar 2 — mesma disciplina de `ListMyTasksCapability`). NADA de logica de
   * negocio nova. EXECUTING + READY saem juntos via `statuses[]` (1 query, sem
   * N+1). `assigneeId` e SEMPRE derivado do user do JWT (ADR-V2-042) — nunca de
   * input externo.
   *
   * Curto-circuito para `[]` quando o user nao tem projetos acessiveis
   * (evita hit desnecessario; `findMany` tambem trata escopo vazio).
   *
   * @param userEntidadeId - `DEntidade.chave` do user logado.
   * @returns Lista das ate 5 tasks ativas (id, nome, identifier, status).
   */
  private async getActiveTasks(
    userEntidadeId: bigint,
  ): Promise<Array<{ id: string; nome: string; identifier: string; status: string }>> {
    const scopedProjectIds = await this.projectsService.findAccessibleProjectIds(userEntidadeId);
    if (scopedProjectIds.length === 0) {
      return [];
    }

    const result = await this.tasksService.findMany(
      {
        assigneeId: userEntidadeId.toString(), // ADR-V2-042: sempre do JWT
        projectIds: scopedProjectIds,
        statuses: ACTIVE_TASK_STATUSES, // EXECUTING + READY em 1 query
        limit: MAX_ACTIVE_TASKS,
      },
      scopedProjectIds,
    );

    return result.items.map((t) => ({
      id: t.id,
      nome: t.nome,
      identifier: t.identifier,
      status: t.status,
    }));
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

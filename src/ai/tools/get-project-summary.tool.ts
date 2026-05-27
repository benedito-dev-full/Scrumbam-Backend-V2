import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { ProjectsService } from '../../projects/projects.service';
import { TasksService } from '../../tasks/tasks.service';
import { AiToolDefinition } from '../providers/ai-provider.interface';
import { AiToolContext } from './tool-context';

/** Quantidade de tasks "vivas" inclusas no summary. */
const TOP_PENDING_LIMIT = 5;

/** idClasse canonicos DProject (ADR-V2-051 §3.2). */
const ID_CLASSE_SPACE = '-350';
const ID_CLASSE_FOLDER = '-351';
const ID_CLASSE_LIST = '-352';

/** BigInt equivalents para queries hierarquicas. */
const ID_CLASSE_SPACE_BI = BigInt(ID_CLASSE_SPACE);
const ID_CLASSE_FOLDER_BI = BigInt(ID_CLASSE_FOLDER);
const ID_CLASSE_LIST_BI = BigInt(ID_CLASSE_LIST);

/**
 * Tool `getProjectSummary` — combina `ProjectsService.findOne` +
 * `ProjectsService.getStats` + `TasksService.findMany` numa unica resposta
 * concisa para a IA.
 *
 * **Hierarchy-aware (B.5 fix):** Tasks no V2 sempre vivem em LISTs
 * (DProject idClasse=-352). SPACEs (-350) e FOLDERs (-351) sao apenas
 * contêineres estruturais (sem tasks diretas). Quando o usuario pergunta
 * sobre um SPACE ou FOLDER, a tool agrega automaticamente os stats e top
 * pending tasks de TODAS as LISTs descendentes via traversal por `idPai`.
 * Para LIST, mantém o comportamento original (stats diretos).
 *
 * Plano canonico 2.2: NAO expoe novo endpoint HTTP — eh combinacao
 * server-side de service calls + traversal hierarquico opcional.
 *
 * Custo:
 *  - LIST: 3 queries (findOne, getStats, findMany top pending) — comportamento original.
 *  - FOLDER/SPACE: O(N) queries de descoberta de descendentes (BFS, depth tipico ≤3)
 *    + N getStats em paralelo + 1 findMany top pending. Aceitavel para uso pela IA.
 *
 * Todas as queries sao tenant-scoped via `organizationId` (findOne valida).
 */
@Injectable()
export class GetProjectSummaryTool {
  private readonly logger = new Logger(GetProjectSummaryTool.name);

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly tasksService: TasksService,
    private readonly prisma: PrismaService,
  ) {}

  build(ctx: AiToolContext): AiToolDefinition {
    return {
      name: 'getProjectSummary',
      description:
        'Retorna resumo de um projeto: dados basicos + contadores por status V3 + ate 5 tasks ativas (READY/EXECUTING). Para SPACE/FOLDER, agrega automaticamente tasks de TODAS as LISTs descendentes (hierarquia). Para LIST, conta tasks diretas. Use quando o usuario perguntar sobre o estado de um projeto.',
      parameters: {
        type: 'object',
        properties: {
          projectId: {
            type: 'string',
            description: 'ID do projeto (chave numerica). Pode ser SPACE, FOLDER ou LIST.',
          },
        },
        required: ['projectId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const projectId = this.parseString(args.projectId, 'projectId');

        // findOne ja faz tenant gate (404 anti-enum se cross-tenant).
        const project = await this.projectsService.findOne(
          projectId,
          ctx.userEntidadeId,
          ctx.organizationId,
        );

        // Detecta se eh contêiner (precisa agregar) ou LIST/outro (direto).
        const isHierarchical =
          project.idClasse === ID_CLASSE_SPACE || project.idClasse === ID_CLASSE_FOLDER;

        // Resolve IDs das LISTs alvo das queries de stats/top pending.
        const listIds: string[] = isHierarchical
          ? await this.collectDescendantListIds(BigInt(projectId))
          : [projectId];

        // accessibleProjectIds — single call reutilizada por todas as paths.
        const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
          ctx.userEntidadeId,
          ctx.organizationId,
        );

        // Agregar stats: LIST → 1 getStats; SPACE/FOLDER → N getStats em paralelo (zero N+1).
        const aggregatedStats: { total: number; byStatus: Record<string, number> } = {
          total: 0,
          byStatus: {},
        };

        if (listIds.length > 0) {
          if (isHierarchical) {
            // Parallel fetch — uma falha individual nao quebra agregacao.
            const statsArray = await Promise.all(
              listIds.map((listId) =>
                this.projectsService
                  .getStats(listId, ctx.userEntidadeId, ctx.organizationId)
                  .catch((err: unknown) => {
                    this.logger.warn(
                      `ai_tool_getProjectSummary listStats_fail listId=${listId} err=${(err as Error)?.message ?? err}`,
                    );
                    return null;
                  }),
              ),
            );
            for (const s of statsArray) {
              if (s === null) continue;
              aggregatedStats.total += s.totalTasks;
              for (const [status, count] of Object.entries(s.statusCounts ?? {})) {
                aggregatedStats.byStatus[status] =
                  (aggregatedStats.byStatus[status] ?? 0) + (count as number);
              }
            }
          } else {
            // LIST (ou idClasse nao-hierarquico): comportamento original.
            const stats = await this.projectsService.getStats(
              projectId,
              ctx.userEntidadeId,
              ctx.organizationId,
            );
            aggregatedStats.total = stats.totalTasks;
            aggregatedStats.byStatus = stats.statusCounts ?? {};
          }
        }

        // Top tasks ativas — usa `projectIds` quando hierarquico, `projectId` quando direto.
        // Quando hierarquico mas sem LISTs descendentes, pula a query (resultado vazio).
        let topPendingTasks: Array<{
          id: string;
          identifier: string | null;
          nome: string;
          status: string | null;
        }> = [];

        if (listIds.length > 0) {
          const topPendingQuery = isHierarchical
            ? { projectIds: listIds, statuses: ['READY', 'EXECUTING'], limit: TOP_PENDING_LIMIT }
            : { projectId, statuses: ['READY', 'EXECUTING'], limit: TOP_PENDING_LIMIT };

          const topPending = await this.tasksService.findMany(
            topPendingQuery,
            accessibleProjectIds,
          );

          topPendingTasks = topPending.items.map((t) => ({
            id: t.id,
            identifier: t.identifier,
            nome: t.nome,
            status: t.status,
          }));
        }

        this.logger.log(
          `ai_tool_getProjectSummary ok projectId=${projectId} idClasse=${project.idClasse} hierarchical=${isHierarchical} listsFound=${listIds.length} statsTotal=${aggregatedStats.total} topPending=${topPendingTasks.length}`,
        );

        return {
          id: project.id,
          nome: project.nome,
          prefix: project.prefix,
          icon: project.icon ?? null,
          color: project.color ?? null,
          idClasse: project.idClasse,
          idPai: project.idPai,
          memberCount: project.memberCount,
          stats: aggregatedStats,
          topPendingTasks,
          // Hint para a IA saber que a resposta veio de agregacao hierarquica.
          ...(isHierarchical && { aggregatedFromLists: listIds.length }),
        };
      },
    };
  }

  /**
   * Coleta recursivamente os IDs (string) de todas as LISTs descendentes
   * a partir de um `rootProjectId`.
   *
   * Comportamento por idClasse do no atual:
   *  - LIST (-352): retorna o proprio ID (folha da hierarquia, contém tasks).
   *  - FOLDER (-351): desce 1 nivel via `idPai` para coletar LISTs/sub-FOLDERs.
   *  - SPACE (-350): desce ate 2 niveis (SPACE → FOLDER → LIST).
   *  - Outro idClasse: ignorado (defensivo).
   *
   * Considera apenas `excluido=false`. Implementacao BFS com `visited` set
   * (defesa contra ciclos hipoteticos em dados inconsistentes).
   *
   * Custo tipico: 1 query do no raiz + 1 query de filhos por nivel intermediario.
   * SPACE com 5 FOLDERs e 20 LISTs ≈ 7 queries.
   *
   * @param rootProjectId - Chave bigint do DProject de entrada.
   * @returns Array de IDs string das LISTs descendentes (vazio se nenhuma).
   */
  private async collectDescendantListIds(rootProjectId: bigint): Promise<string[]> {
    const allListIds: string[] = [];
    const queue: bigint[] = [rootProjectId];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const currentId = queue.shift()!;
      const currentIdStr = currentId.toString();
      if (visited.has(currentIdStr)) continue;
      visited.add(currentIdStr);

      const node = await this.prisma.dProject.findFirst({
        where: { chave: currentId, excluido: false },
        select: { chave: true, idClasse: true },
      });
      if (!node) continue;

      if (node.idClasse === ID_CLASSE_LIST_BI) {
        allListIds.push(node.chave.toString());
        continue;
      }

      if (node.idClasse === ID_CLASSE_FOLDER_BI || node.idClasse === ID_CLASSE_SPACE_BI) {
        const children = await this.prisma.dProject.findMany({
          where: { idPai: currentId, excluido: false },
          select: { chave: true },
        });
        for (const child of children) {
          queue.push(child.chave);
        }
      }
      // Outros idClasse (ex: DOC -353): ignora (nao contem tasks).
    }

    return allListIds;
  }

  private parseString(raw: unknown, field: string): string {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new Error(`${field} deve ser string nao vazia`);
    }
    return raw;
  }
}

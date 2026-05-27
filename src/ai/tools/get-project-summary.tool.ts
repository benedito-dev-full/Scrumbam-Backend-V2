import { Injectable, Logger } from '@nestjs/common';
import { ProjectsService } from '../../projects/projects.service';
import { TasksService } from '../../tasks/tasks.service';
import { AiToolDefinition } from '../providers/ai-provider.interface';
import { AiToolContext } from './tool-context';

/** Quantidade de tasks "vivas" inclusas no summary. */
const TOP_PENDING_LIMIT = 5;

/**
 * Tool `getProjectSummary` — combina `ProjectsService.findOne` +
 * `ProjectsService.getStats` + `TasksService.findMany` numa unica resposta
 * concisa para a IA.
 *
 * Plano canonico 2.2: NAO expoe novo endpoint HTTP — eh combinacao
 * server-side de 3 calls de service.
 *
 * Custo: 3 queries (findOne, getStats, findMany top pending) — todas
 * tenant-scoped via `organizationId`. Top pending limitado a 5 tasks
 * em READY/EXECUTING (alto valor para resposta da IA).
 */
@Injectable()
export class GetProjectSummaryTool {
  private readonly logger = new Logger(GetProjectSummaryTool.name);

  constructor(
    private readonly projectsService: ProjectsService,
    private readonly tasksService: TasksService,
  ) {}

  build(ctx: AiToolContext): AiToolDefinition {
    return {
      name: 'getProjectSummary',
      description:
        'Retorna resumo de um projeto: dados basicos + contadores por status V3 + ate 5 tasks ativas (READY/EXECUTING). Use quando o usuario perguntar sobre o estado de um projeto.',
      parameters: {
        type: 'object',
        properties: {
          projectId: {
            type: 'string',
            description: 'ID do projeto (chave numerica)',
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

        // getStats reusa findOne internamente — somar custo eh aceitavel
        // (tenant check ja feito acima; getStats apenas re-confirma).
        const stats = await this.projectsService.getStats(
          projectId,
          ctx.userEntidadeId,
          ctx.organizationId,
        );

        // Top tasks ativas — resolve accessibleProjectIds para passar ao service.
        const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
          ctx.userEntidadeId,
          ctx.organizationId,
        );
        const topPending = await this.tasksService.findMany(
          { projectId, statuses: ['READY', 'EXECUTING'], limit: TOP_PENDING_LIMIT },
          accessibleProjectIds,
        );

        const topPendingTasks = topPending.items.map((t) => ({
          id: t.id,
          identifier: t.identifier,
          nome: t.nome,
          status: t.status,
        }));

        this.logger.log(
          `ai_tool_getProjectSummary ok projectId=${projectId} statsTotal=${stats.totalTasks} topPending=${topPendingTasks.length}`,
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
          stats: {
            total: stats.totalTasks,
            byStatus: stats.statusCounts,
          },
          topPendingTasks,
        };
      },
    };
  }

  private parseString(raw: unknown, field: string): string {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new Error(`${field} deve ser string nao vazia`);
    }
    return raw;
  }
}

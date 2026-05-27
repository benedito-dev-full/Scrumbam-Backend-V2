import { Injectable, Logger } from '@nestjs/common';
import { ProjectsService } from '../../projects/projects.service';
import { TasksService } from '../../tasks/tasks.service';
import { AiToolDefinition } from '../providers/ai-provider.interface';
import { AiToolContext } from './tool-context';

/**
 * Tool `createTask` — proxy do `TasksService.create`.
 *
 * Resolve `accessibleProjectIds` UMA vez no inicio do `execute` (mesma defesa
 * em profundidade ADR-V2-042 que o controller HTTP faz). Estado inicial:
 * INBOX (V3) — definido internamente pelo service.
 *
 * Campos opcionais: descricao + idPai (sub-task ou sub-fase). Outras
 * propriedades (priority, assignee, sprint) ficam fora da v1 — o usuario
 * pode usar `update_task` futuro (deferido).
 */
@Injectable()
export class CreateTaskTool {
  private readonly logger = new Logger(CreateTaskTool.name);

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  build(ctx: AiToolContext): AiToolDefinition {
    return {
      name: 'createTask',
      description:
        'Cria uma nova task em um projeto. Estado inicial: INBOX. Use quando o usuario pedir para criar/registrar uma task ou atividade.',
      parameters: {
        type: 'object',
        properties: {
          projectId: {
            type: 'string',
            description: 'ID do projeto onde a task sera criada (chave numerica)',
          },
          nome: {
            type: 'string',
            description: 'Titulo curto da task',
          },
          descricao: {
            type: 'string',
            description: 'Descricao detalhada (opcional, markdown aceito)',
          },
          idPai: {
            type: 'string',
            description: 'ID da task/fase pai (opcional)',
          },
        },
        required: ['projectId', 'nome'],
      },
      execute: async (args: Record<string, unknown>) => {
        const projectId = this.parseString(args.projectId, 'projectId');
        const nome = this.parseString(args.nome, 'nome');
        const descricao = this.parseOptionalString(args.descricao);
        const idPai = this.parseOptionalString(args.idPai);

        // ADR-V2-042: resolve scope antes de chamar o service (defesa em
        // profundidade). Se projectId fora do scope, `TasksService.create`
        // ja relança NotFoundException com mensagem identica (anti-enum).
        const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
          ctx.userEntidadeId,
          ctx.organizationId,
        );

        const task = await this.tasksService.create(
          {
            nome,
            projectId,
            ...(descricao ? { descricao } : {}),
            ...(idPai ? { idPai } : {}),
          },
          ctx.userEntidadeId,
          accessibleProjectIds,
        );

        this.logger.log(
          `ai_tool_createTask ok projectId=${projectId} taskId=${task.id} identifier=${task.identifier}`,
        );

        return {
          success: true,
          taskId: task.id,
          identifier: task.identifier,
          status: task.status,
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

  private parseOptionalString(raw: unknown): string | undefined {
    if (raw === undefined || raw === null || raw === '') return undefined;
    if (typeof raw !== 'string') throw new Error('campo deve ser string');
    return raw;
  }
}

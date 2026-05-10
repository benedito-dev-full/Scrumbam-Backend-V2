import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { TasksService } from '../../tasks/tasks.service';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import {
  assertRecord,
  maxStringLength,
  optionalString,
  parseBigIntParam,
  requiredString,
  textResult,
} from './tool-params';

@Injectable()
export class CreateTaskTool implements McpTool {
  readonly name = 'create_task';
  readonly description = 'Cria uma task no projeto informado.';
  readonly inputSchema = {
    type: 'object',
    required: ['projectId', 'titulo'],
    properties: {
      projectId: { type: 'string' },
      titulo: { type: 'string', maxLength: 500 },
      descricao: { type: 'string', maxLength: 5000 },
      assigneeId: { type: 'string' },
      sprintId: { type: 'string' },
    },
  };

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    const input = assertRecord(params);
    const projectId = requiredString(input, 'projectId');
    const assigneeId = optionalString(input, 'assigneeId');
    const sprintId = optionalString(input, 'sprintId');
    const titulo = requiredString(input, 'titulo');
    const descricao = optionalString(input, 'descricao');

    maxStringLength(titulo, 'titulo', 500);
    if (descricao) {
      maxStringLength(descricao, 'descricao', 5000);
    }

    parseBigIntParam(projectId, 'projectId');
    if (assigneeId) {
      parseBigIntParam(assigneeId, 'assigneeId');
    }
    if (sprintId) {
      parseBigIntParam(sprintId, 'sprintId');
    }

    await this.projectsService.findOne(projectId, ctx.dEntidadeId);

    const result = await this.tasksService.create(
      {
        projectId,
        nome: titulo,
        ...(descricao ? { descricao } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(sprintId ? { sprintId } : {}),
        source: 'mcp',
      },
      ctx.dEntidadeId,
    );

    return textResult(result);
  }
}

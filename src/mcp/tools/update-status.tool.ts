import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { TasksService } from '../../tasks/tasks.service';
import { MCP_ERROR_CODES, MCP_SCOPES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { assertTaskNotLockedByOther } from './task-concurrency.guard';
import { McpTool, McpToolError, McpToolResult } from './tool.interface';
import {
  V3_STATUS_CODES,
  assertRecord,
  parseBigIntParam,
  requireScope,
  requiredString,
  textResult,
} from './tool-params';

@Injectable()
export class UpdateStatusTool implements McpTool {
  readonly name = 'update_status';
  readonly description = 'Atualiza o status V3 de uma task.';
  readonly inputSchema = {
    type: 'object',
    required: ['taskId', 'statusCode'],
    properties: {
      taskId: { type: 'string' },
      statusCode: {
        type: 'string',
        description:
          'Codigo V3: INBOX|READY|EXECUTING|DONE|FAILED|CANCELLED|DISCARDED|VALIDATING|VALIDATED',
      },
    },
  };

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    // Gate de autorização (ADR-V2-068). Antes de qualquer query.
    requireScope(ctx, MCP_SCOPES.TASKS_WRITE);

    const input = assertRecord(params);
    const taskId = requiredString(input, 'taskId');
    const statusCode = requiredString(input, 'statusCode');

    parseBigIntParam(taskId, 'taskId');
    if (!V3_STATUS_CODES.includes(statusCode as (typeof V3_STATUS_CODES)[number])) {
      throw new McpToolError(MCP_ERROR_CODES.INVALID_PARAMS, 'Invalid params', {
        field: 'statusCode',
        issue: 'invalid V3 status code',
      });
    }

    const task = await this.tasksService.findOne(taskId);
    await this.projectsService.findOne(task.projectId, ctx.dEntidadeId);

    // Trava de concorrência MCP (task #794): recusa se a task está EXECUTING
    // com workSession aberta de OUTRO ator. update_timer é isento (decisão #3).
    assertTaskNotLockedByOther(task, ctx.dEntidadeId);

    const result = await this.tasksService.updateStatus(taskId, {
      status: statusCode,
      movedBy: ctx.dEntidadeId.toString(),
    });

    return textResult(result);
  }
}

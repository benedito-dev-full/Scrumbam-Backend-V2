import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { TasksService } from '../../tasks/tasks.service';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import {
  V3_STATUS_CODES,
  invalidParams,
  optionalLimit,
  optionalRecord,
  optionalString,
  parseBigIntParam,
  textResult,
} from './tool-params';

@Injectable()
export class ListTasksTool implements McpTool {
  readonly name = 'list_tasks';
  readonly description =
    'Lista tasks do usuario com filtros opcionais de projeto, status e assignee.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      projectId: { type: 'string', description: 'ID do projeto (opcional)' },
      status: { type: 'string', description: 'Codigo do status V3 (ex: INBOX, EXECUTING)' },
      assigneeId: { type: 'string', description: 'ID do assignee (opcional)' },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      cursor: { type: 'string', description: 'Cursor de paginacao' },
    },
  };

  constructor(
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
  ) {}

  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    const input = optionalRecord(params);
    const projectId = optionalString(input, 'projectId');
    const assigneeId = optionalString(input, 'assigneeId');
    const cursor = optionalString(input, 'cursor');
    const status = optionalString(input, 'status');

    if (projectId) {
      parseBigIntParam(projectId, 'projectId');
    }
    if (assigneeId) {
      parseBigIntParam(assigneeId, 'assigneeId');
    }
    if (cursor) {
      parseBigIntParam(cursor, 'cursor');
    }
    if (status && !V3_STATUS_CODES.includes(status as (typeof V3_STATUS_CODES)[number])) {
      throw invalidParams('status', 'invalid V3 status code');
    }

    const scopedProjectIds = await this.resolveScopedProjectIds(projectId, ctx);
    if (scopedProjectIds.length === 0) {
      return textResult({ items: [], pagination: { hasMore: false, nextCursor: null } });
    }

    // ADR-V2-042: passar `scopedProjectIds` como o conjunto autorizado
    // p/ TasksService.findMany — defesa-em-profundidade.
    const result = await this.tasksService.findMany(
      {
        ...(projectId ? { projectId } : {}),
        ...(!projectId ? { projectIds: scopedProjectIds } : {}),
        ...(status ? { status } : {}),
        ...(assigneeId ? { assigneeId } : {}),
        ...(cursor ? { cursor } : {}),
        limit: optionalLimit(input),
      },
      scopedProjectIds,
    );

    return textResult(result);
  }

  private async resolveScopedProjectIds(
    projectId: string | undefined,
    ctx: McpUserContext,
  ): Promise<string[]> {
    if (projectId) {
      await this.projectsService.findOne(projectId, ctx.dEntidadeId);
      return [projectId];
    }

    return this.projectsService.findAccessibleProjectIds(ctx.dEntidadeId);
  }
}

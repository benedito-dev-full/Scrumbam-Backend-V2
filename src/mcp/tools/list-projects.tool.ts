import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import {
  optionalLimit,
  optionalRecord,
  optionalString,
  parseBigIntParam,
  textResult,
} from './tool-params';

@Injectable()
export class ListProjectsTool implements McpTool {
  readonly name = 'list_projects';
  readonly description = 'Lista projetos acessiveis ao usuario.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      cursor: { type: 'string' },
    },
  };

  constructor(private readonly projectsService: ProjectsService) {}

  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    const input = optionalRecord(params);
    const cursor = optionalString(input, 'cursor');
    if (cursor) {
      parseBigIntParam(cursor, 'cursor');
    }

    const result = await this.projectsService.findMany(ctx.dEntidadeId, {
      cursor,
      limit: optionalLimit(input),
    });

    return textResult(result);
  }
}

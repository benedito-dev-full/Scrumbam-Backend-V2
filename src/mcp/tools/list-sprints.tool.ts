import { Injectable } from '@nestjs/common';

import { ProjectsService } from '../../projects/projects.service';
import { TabelaService } from '../../tabelas/tabelas.service';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import {
  assertRecord,
  optionalLimit,
  optionalString,
  parseBigIntParam,
  requiredString,
  textResult,
} from './tool-params';

const SPRINT_CLASS_ID = '-400';

@Injectable()
export class ListSprintsTool implements McpTool {
  readonly name = 'list_sprints';
  readonly description = 'Lista sprints de um projeto.';
  readonly inputSchema = {
    type: 'object',
    required: ['projectId'],
    properties: {
      projectId: { type: 'string' },
      limit: { type: 'integer', minimum: 1, maximum: 50, default: 20 },
      cursor: { type: 'string' },
    },
  };

  constructor(
    private readonly tabelaService: TabelaService,
    private readonly projectsService: ProjectsService,
  ) {}

  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    const input = assertRecord(params);
    const projectId = requiredString(input, 'projectId');
    const cursor = optionalString(input, 'cursor');

    parseBigIntParam(projectId, 'projectId');
    if (cursor) {
      parseBigIntParam(cursor, 'cursor');
    }

    await this.projectsService.findOne(projectId, ctx.dEntidadeId);

    const result = await this.tabelaService.listarPorClasse({
      idClasse: SPRINT_CLASS_ID,
      dEntidadeId: projectId,
      ...(cursor ? { cursor } : {}),
      pageSize: optionalLimit(input),
    });

    return textResult(result);
  }
}

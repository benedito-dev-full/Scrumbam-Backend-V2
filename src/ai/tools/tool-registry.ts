import { Injectable } from '@nestjs/common';
import { AiToolDefinition } from '../providers/ai-provider.interface';
import { CreateCommentTool } from './create-comment.tool';
import { CreateTaskTool } from './create-task.tool';
import { GetProjectSummaryTool } from './get-project-summary.tool';
import { ListCommentsTool } from './list-comments.tool';
import { AiToolContext } from './tool-context';

/**
 * Registry central das tools do Nexus.
 *
 * Constroi a lista de `AiToolDefinition` para um contexto especifico
 * (request). Cada `execute` fica preso na closure do `ctx` — IA NUNCA
 * recebe ou escolhe `userEntidadeId`.
 *
 * v1: 4 tools — createComment, listComments, createTask, getProjectSummary.
 *
 * Adicionar nova tool: (1) criar classe `*.tool.ts`, (2) injetar aqui no
 * constructor, (3) adicionar ao array `buildAll`, (4) registrar como
 * provider no `AiModule`.
 */
@Injectable()
export class ToolRegistry {
  constructor(
    private readonly createCommentTool: CreateCommentTool,
    private readonly listCommentsTool: ListCommentsTool,
    private readonly createTaskTool: CreateTaskTool,
    private readonly getProjectSummaryTool: GetProjectSummaryTool,
  ) {}

  /** Constroi a lista completa de tools para o contexto da request. */
  buildAll(ctx: AiToolContext): AiToolDefinition[] {
    return [
      this.createCommentTool.build(ctx),
      this.listCommentsTool.build(ctx),
      this.createTaskTool.build(ctx),
      this.getProjectSummaryTool.build(ctx),
    ];
  }
}

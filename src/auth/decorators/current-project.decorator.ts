import { createParamDecorator, ExecutionContext } from '@nestjs/common';

/**
 * Informações do projeto autenticado via API Key ou path param.
 */
export interface ProjectContext {
  /** Chave BigInt do DProject (string). */
  id: string;
  /** Chave BigInt da DEntidade org dona do projeto (string). */
  orgId: string;
}

/**
 * Decorator para extrair o contexto de projeto autenticado.
 *
 * Populado pelo ApiKeyGuard quando a request usa X-API-Key
 * que está vinculada a um projeto específico.
 *
 * @example
 * ```typescript
 * @Get(':id/tasks')
 * async listTasks(@CurrentProject() project: ProjectContext) {
 *   return this.taskService.listByProject(BigInt(project.id));
 * }
 * ```
 */
export const CurrentProject = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): ProjectContext | undefined => {
    const request = ctx.switchToHttp().getRequest();
    return request['project'] as ProjectContext | undefined;
  },
);

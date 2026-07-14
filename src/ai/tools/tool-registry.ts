import { Injectable } from '@nestjs/common';
import { RoleResolverService } from '../../auth/services/role-resolver.service';
import { AiToolDefinition } from '../providers/ai-provider.interface';
import { GetProjectSummaryTool } from './get-project-summary.tool';
import { NexusCapabilityAdapter, NexusScopeResolver } from './nexus-capability.adapter';
import { AiToolContext } from './tool-context';

/**
 * Registry central das tools do Nexus.
 *
 * Constroi a lista de `AiToolDefinition` para um contexto especifico
 * (request). Cada `execute` fica preso na closure do `ctx` — IA NUNCA
 * recebe ou escolhe `userEntidadeId`.
 *
 * v1: 4 tools — create_comment, list_comments, create_task (via Capabilities,
 * Ondas 1 e 2), getProjectSummary (legado, ainda nao migrada).
 *
 * **`create_task` (Onda 1 — ADR-V2-079):** migrada para a camada neutra de
 * Capabilities. Servida via `NexusCapabilityAdapter.buildAll(ctx, scopeResolver)`
 * a partir do `CapabilityRegistry` (fonte unica compartilhada com o MCP). O
 * wrapper legado `CreateTaskTool` (`create-task.tool.ts`) permanece no
 * codebase mas DEIXA de ser registrado neste fluxo (aposentadoria adiada para
 * a Onda 5 de limpeza, conforme o plano).
 *
 * **`create_comment` / `list_comments` (Onda 2 — ADR-V2-079):** tambem
 * migradas para a camada neutra. Os wrappers legados
 * `create-comment.tool.ts` / `list-comments.tool.ts` permanecem no codebase
 * mas DEIXAM de ser registrados neste fluxo (mesma aposentadoria adiada para
 * a Onda 5). `getProjectSummary` continua legado — ainda nao migrada.
 *
 * `scopeResolver` deriva o RBAC efetivo do user (`RoleResolverService.
 * getAllowedMcpScopes` — MESMO mapa role->scopes ja usado para as MCP keys,
 * ADR-V2-068 Fase 2), aplicando o `requiredScopes` da capability com DEFAULT
 * RESTRITIVO (`fromNexus`, `tool-principal.ts`).
 *
 * Adicionar nova tool LEGADA (nao migrada): (1) criar classe `*.tool.ts`,
 * (2) injetar aqui no constructor, (3) adicionar ao array `buildAll`,
 * (4) registrar como provider no `AiModule`. Para tools MIGRADAS, ver
 * `ToolCapabilitiesModule` (registro da capability) — nenhuma mudanca aqui
 * alem de incluir o resultado de `capabilityAdapter.buildAll(...)`.
 */
@Injectable()
export class ToolRegistry {
  constructor(
    private readonly getProjectSummaryTool: GetProjectSummaryTool,
    private readonly capabilityAdapter: NexusCapabilityAdapter,
    private readonly roleResolver: RoleResolverService,
  ) {}

  /** Constroi a lista completa de tools para o contexto da request. */
  buildAll(ctx: AiToolContext): AiToolDefinition[] {
    const scopeResolver: NexusScopeResolver = async (resolverCtx) => {
      const allowed = await this.roleResolver.getAllowedMcpScopes(resolverCtx.userEntidadeId);
      return Array.from(allowed);
    };

    return [
      this.getProjectSummaryTool.build(ctx),
      ...this.capabilityAdapter.buildAll(ctx, scopeResolver),
    ];
  }
}

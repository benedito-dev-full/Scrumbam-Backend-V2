import { Injectable, NotFoundException } from '@nestjs/common';

import { ProjectMembersService } from '../../projects/project-members.service';
import { ProjectsService } from '../../projects/projects.service';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpTool, McpToolResult } from './tool.interface';
import { assertRecord, parseBigIntParam, requiredString, textResult } from './tool-params';

/**
 * Tool MCP `list_members` — lista membros de um projeto com seus roles
 * (MANAGER/MEMBER/VIEWER), escopada aos projetos acessiveis ao usuario
 * autenticado via MCP key.
 *
 * Tenant isolation (ADR-V2-042 — defense in depth):
 * 1. Resolve `accessibleProjectIds` via `ProjectsService.findAccessibleProjectIds`.
 * 2. Se `projectId` NAO esta no scope autorizado, lanca `NotFoundException`
 *    com mensagem identica a "projeto nao encontrado" (anti enumeration attack).
 * 3. Apenas apos passar o gate, delega para `ProjectMembersService.getMembers`,
 *    que faz uma unica query com `include` (ZERO N+1).
 *
 * Diferenca para `get_task`: o `ProjectMembersService.getMembers` NAO recebe
 * `accessibleProjectIds` como parametro (assinatura legada do controller HTTP
 * que ja e protegido por JwtAuthGuard). Por isso o gate fica na propria tool,
 * antes da chamada.
 *
 * NAO usa Engine: leitura simples em tabela estrutural (DVincula). Pilar 1
 * (Engine) so aplica em DPedido idClasse=-300 (transacional).
 *
 * @example
 * ```json
 * // Request JSON-RPC
 * {
 *   "jsonrpc": "2.0",
 *   "id": 1,
 *   "method": "tools/call",
 *   "params": {
 *     "name": "list_members",
 *     "arguments": { "projectId": "123" }
 *   }
 * }
 * ```
 */
@Injectable()
export class ListMembersTool implements McpTool {
  readonly name = 'list_members';
  readonly description =
    'Lista os membros de um projeto (com seus roles), escopada aos projetos acessiveis ao usuario MCP.';
  readonly inputSchema = {
    type: 'object',
    required: ['projectId'],
    properties: {
      projectId: { type: 'string' },
    },
  };

  constructor(
    private readonly projectMembersService: ProjectMembersService,
    private readonly projectsService: ProjectsService,
  ) {}

  /**
   * Handler do tools/call para `list_members`.
   *
   * Fluxo:
   * 1. Valida params (object + `projectId` string nao vazia + BigInt parseable).
   * 2. Resolve projetos acessiveis ao caller (ADR-V2-042 — defense in depth).
   * 3. Se `projectId` nao pertence ao scope, lanca `NotFoundException` com
   *    mensagem identica a projeto inexistente (anti enumeration).
   * 4. Invoca `ProjectMembersService.getMembers(projectId)` (assinatura HTTP-legada,
   *    sem `accessibleProjectIds` — o gate fica na tool).
   * 5. Embrulha resposta em `textResult` (envelope MCP padrao).
   *
   * Excecoes nao tratadas (`NotFoundException`, etc.) propagam para o
   * `McpRouterService.dispatchTool`, que NAO traduz para JSON-RPC error
   * (propaga como exception runtime).
   *
   * @param params - Argumentos da chamada (`{ projectId: string }`)
   * @param ctx - Contexto MCP autenticado (contem `dEntidadeId`)
   * @returns Envelope MCP com JSON serializado da lista de membros
   * @throws {McpToolError} INVALID_PARAMS quando projectId ausente/invalido
   * @throws {NotFoundException} Quando projeto fora do scope do usuario MCP
   */
  async handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult> {
    const input = assertRecord(params);
    const projectId = requiredString(input, 'projectId');
    parseBigIntParam(projectId, 'projectId');

    const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(
      ctx.dEntidadeId,
    );

    if (!accessibleProjectIds.includes(projectId)) {
      // Mensagem identica a projeto inexistente — anti enumeration (ADR-V2-042).
      throw new NotFoundException(`Projeto ${projectId} não encontrado`);
    }

    const result = await this.projectMembersService.getMembers(projectId);

    return textResult(result);
  }
}

import { Injectable } from '@nestjs/common';

import { CommentsService } from '../../../../comments/comments.service';
import { CommentTargetType } from '../../../../comments/dto/comment-target-type.enum';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/** Valores aceitos de `targetType` — espelha `CommentTargetType` (V1). */
const TARGET_TYPE_VALUES = ['task', 'project', 'folder', 'list'] as const;

/**
 * `CreateCommentCapability` — capability neutra `create_comment` (Onda 2).
 *
 * Casca FINA sobre `CommentsService.create` — a MESMA chamada de service que
 * o wrapper legado Nexus (`src/ai/tools/create-comment.tool.ts`) ja faz. Esta
 * e a primeira capability que nasce no MCP (onde `create_comment` NUNCA
 * existiu) e continua a existir no Nexus — prova a direcao Nexus -> MCP do
 * adapter (Onda 1 provou a direcao comum, MCP+Nexus ja existentes).
 *
 * `inputSchema` espelha 1:1 o `parameters` do wrapper legado Nexus
 * (`targetType` enum + `targetId` + `texto`) — nenhuma perda nem ganho de
 * capacidade na migracao, so a superficie MCP passa a servi-lo tambem.
 *
 * Tenant isolation (ADR-V2-042): `CommentTargetResolver.resolveAndAuthorize`
 * (chamado dentro de `CommentsService.create`) e quem valida acesso ao alvo —
 * a capability NAO reimplementa essa logica, so repassa
 * `principal.actorEntidadeId` (SEMPRE do auth) e `principal.organizationId`.
 *
 * Scope: reusa `tasks:write` (comentario e sub-recurso de task/project/list —
 * recomendacao do plano de execucao, ADR-V2-079, para evitar proliferar
 * scopes no catalogo MCP_SCOPES).
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 2
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-042 (tenant isolation)
 */
@Injectable()
export class CreateCommentCapability implements Capability {
  readonly name = 'create_comment';
  readonly description =
    'Cria um comentario em uma task, project, folder ou list. Use quando o usuario pedir para comentar/registrar algo.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      targetType: {
        type: 'string',
        enum: [...TARGET_TYPE_VALUES],
        description: 'Tipo do alvo do comentario',
      },
      targetId: {
        type: 'string',
        description: 'ID do alvo (chave numerica como string)',
      },
      texto: {
        type: 'string',
        description: 'Conteudo do comentario (1-10000 chars, markdown aceito)',
      },
    },
    required: ['targetType', 'targetId', 'texto'],
  };
  readonly requiredScopes = ['tasks:write'] as const;

  constructor(private readonly commentsService: CommentsService) {}

  /**
   * Executa a criacao do comentario. Valida o shape do input (lancando
   * `CapabilityError('INVALID_INPUT', ...)` cedo, ANTES de tocar o service)
   * e delega a `CommentsService.create`.
   *
   * @param input - Argumentos ja no formato neutro (ver `inputSchema`).
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com `{ success, commentId, targetType, targetId }`
   *   — mesmo shape que o wrapper legado Nexus ja devolvia.
   * @throws {CapabilityError} `INVALID_INPUT` quando um campo viola o schema.
   * @throws {import('@nestjs/common').NotFoundException} Alvo inexistente ou
   *   fora do tenant do ator (propagada tal como o service ja faz).
   * @throws {import('@nestjs/common').ForbiddenException} Sem acesso ao alvo.
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const targetType = this.parseTargetType(input.targetType);
    const targetId = this.requiredString(input, 'targetId');
    const texto = this.requiredString(input, 'texto');

    const organizationId =
      principal.organizationId !== undefined ? principal.organizationId.toString() : undefined;

    const comment = await this.commentsService.create(
      targetType,
      targetId,
      { texto },
      principal.actorEntidadeId,
      organizationId,
    );

    return {
      data: {
        success: true,
        commentId: comment.id,
        targetType,
        targetId,
      },
    };
  }

  private parseTargetType(raw: unknown): CommentTargetType {
    if (typeof raw !== 'string') {
      throw new CapabilityError('INVALID_INPUT', 'targetType: required string', {
        field: 'targetType',
      });
    }
    const lower = raw.toLowerCase();
    if (!(TARGET_TYPE_VALUES as readonly string[]).includes(lower)) {
      throw new CapabilityError(
        'INVALID_INPUT',
        `targetType: one of [${TARGET_TYPE_VALUES.join('|')}] expected`,
        { field: 'targetType' },
      );
    }
    return lower as CommentTargetType;
  }

  private requiredString(input: Record<string, unknown>, field: string): string {
    const value = input[field];
    if (typeof value !== 'string' || value.trim() === '') {
      throw new CapabilityError('INVALID_INPUT', `${field}: required string`, { field });
    }
    return value;
  }
}

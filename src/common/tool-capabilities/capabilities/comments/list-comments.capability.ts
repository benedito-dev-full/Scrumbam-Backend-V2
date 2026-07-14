import { Injectable } from '@nestjs/common';

import { CommentsService } from '../../../../comments/comments.service';
import { CommentTargetType } from '../../../../comments/dto/comment-target-type.enum';
import { CapabilityError } from '../../capability-error';
import { Capability, CapabilityResult } from '../../capability.interface';
import { ToolPrincipal } from '../../tool-principal';

/** Valores aceitos de `targetType` — espelha `CommentTargetType` (V1). */
const TARGET_TYPE_VALUES = ['task', 'project', 'folder', 'list'] as const;

/** Limites de `limit` — mesma faixa que o wrapper legado Nexus ja aplicava. */
const MIN_LIMIT = 1;
const MAX_LIMIT = 50;
const DEFAULT_LIMIT = 20;

/**
 * `ListCommentsCapability` — capability neutra `list_comments` (Onda 2).
 *
 * Casca FINA e READ-ONLY sobre `CommentsService.findMany` — a MESMA chamada
 * de service que o wrapper legado Nexus (`src/ai/tools/list-comments.tool.ts`)
 * ja faz. Segunda capability desta onda a nascer no MCP.
 *
 * `inputSchema` espelha 1:1 o `parameters` do wrapper legado Nexus
 * (`targetType` enum + `targetId` + `limit` opcional 1-50, default 20).
 *
 * Tenant isolation (ADR-V2-042): `CommentTargetResolver.resolveAndAuthorize`
 * (chamado dentro de `CommentsService.findMany`) valida acesso ao alvo — a
 * capability NAO reimplementa essa logica.
 *
 * Scope: reusa `tasks:read` (leitura de sub-recurso de task/project/list —
 * mesma recomendacao do plano usada em `CreateCommentCapability`).
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 2
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 * @see ADR-V2-042 (tenant isolation)
 */
@Injectable()
export class ListCommentsCapability implements Capability {
  readonly name = 'list_comments';
  readonly description =
    'Lista os comentarios mais recentes de uma task, project, folder ou list. Use quando o usuario quiser saber o que foi comentado.';
  readonly inputSchema = {
    type: 'object',
    properties: {
      targetType: {
        type: 'string',
        enum: [...TARGET_TYPE_VALUES],
        description: 'Tipo do alvo',
      },
      targetId: { type: 'string', description: 'ID do alvo' },
      limit: {
        type: 'number',
        description: 'Quantidade maxima de comentarios (1-50, default 20)',
      },
    },
    required: ['targetType', 'targetId'],
  };
  readonly requiredScopes = ['tasks:read'] as const;

  constructor(private readonly commentsService: CommentsService) {}

  /**
   * Executa a listagem de comentarios. Valida o shape do input e delega a
   * `CommentsService.findMany`.
   *
   * @param input - Argumentos ja no formato neutro (ver `inputSchema`).
   * @param principal - Ator neutro (MCP: scopes da chave; Nexus: RBAC).
   * @returns `CapabilityResult` com `{ items, total, hasMore }` — mesmo shape
   *   que o wrapper legado Nexus ja devolvia.
   * @throws {CapabilityError} `INVALID_INPUT` quando um campo viola o schema.
   * @throws {import('@nestjs/common').NotFoundException} Alvo inexistente ou
   *   fora do tenant do ator.
   * @throws {import('@nestjs/common').ForbiddenException} Sem acesso ao alvo.
   */
  async run(input: Record<string, unknown>, principal: ToolPrincipal): Promise<CapabilityResult> {
    const targetType = this.parseTargetType(input.targetType);
    const targetId = this.requiredString(input, 'targetId');
    const limit = this.parseLimit(input.limit);

    const organizationId =
      principal.organizationId !== undefined ? principal.organizationId.toString() : undefined;

    const page = await this.commentsService.findMany(
      targetType,
      targetId,
      { limit },
      principal.actorEntidadeId,
      organizationId,
    );

    return {
      data: {
        items: page.items.map((c) => ({
          id: c.id,
          texto: c.texto,
          autorNome: c.autorNome,
          createdAt: c.createdAt,
        })),
        total: page.items.length,
        hasMore: !!page.nextCursor,
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

  private parseLimit(raw: unknown): number {
    if (raw === undefined || raw === null) {
      return DEFAULT_LIMIT;
    }
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new CapabilityError('INVALID_INPUT', 'limit: number expected', { field: 'limit' });
    }
    if (raw < MIN_LIMIT || raw > MAX_LIMIT) {
      throw new CapabilityError(
        'INVALID_INPUT',
        `limit: must be between ${MIN_LIMIT} and ${MAX_LIMIT}`,
        { field: 'limit' },
      );
    }
    return Math.floor(raw);
  }
}

import { Injectable, Logger } from '@nestjs/common';
import { CommentsService } from '../../comments/comments.service';
import { CommentTargetType } from '../../comments/dto/comment-target-type.enum';
import { AiToolDefinition } from '../providers/ai-provider.interface';
import { AiToolContext } from './tool-context';

/**
 * Tool `listComments` — proxy do `CommentsService.findMany`.
 *
 * Read-only. Tenant isolation natural via `CommentTargetResolver` no service.
 * Limite superior de 50 itens evita devolver payload gigante para o modelo
 * (consome contexto sem agregar valor).
 */
@Injectable()
export class ListCommentsTool {
  private readonly logger = new Logger(ListCommentsTool.name);

  constructor(private readonly commentsService: CommentsService) {}

  build(ctx: AiToolContext): AiToolDefinition {
    return {
      name: 'listComments',
      description:
        'Lista os comentarios mais recentes de uma task, project, folder ou list. Use quando o usuario quiser saber o que foi comentado.',
      parameters: {
        type: 'object',
        properties: {
          targetType: {
            type: 'string',
            enum: ['task', 'project', 'folder', 'list'],
            description: 'Tipo do alvo',
          },
          targetId: { type: 'string', description: 'ID do alvo' },
          limit: {
            type: 'number',
            description: 'Quantidade maxima de comentarios (1-50, default 20)',
          },
        },
        required: ['targetType', 'targetId'],
      },
      execute: async (args: Record<string, unknown>) => {
        const targetType = this.parseTargetType(args.targetType);
        const targetId = this.parseString(args.targetId, 'targetId');
        const limit = this.parseLimit(args.limit);

        const page = await this.commentsService.findMany(
          targetType,
          targetId,
          { limit },
          ctx.userEntidadeId,
          ctx.organizationId,
        );

        this.logger.log(
          `ai_tool_listComments ok target=${targetType}/${targetId} count=${page.items.length}`,
        );

        return {
          items: page.items.map((c) => ({
            id: c.id,
            texto: c.texto,
            autorNome: c.autorNome,
            createdAt: c.createdAt,
          })),
          total: page.items.length,
          hasMore: !!page.nextCursor,
        };
      },
    };
  }

  private parseTargetType(raw: unknown): CommentTargetType {
    if (typeof raw !== 'string') {
      throw new Error('targetType deve ser string');
    }
    const lower = raw.toLowerCase();
    const valid = ['task', 'project', 'folder', 'list'] as const;
    if (!valid.includes(lower as (typeof valid)[number])) {
      throw new Error(`targetType invalido: ${raw}`);
    }
    return lower as CommentTargetType;
  }

  private parseString(raw: unknown, field: string): string {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new Error(`${field} deve ser string nao vazia`);
    }
    return raw;
  }

  private parseLimit(raw: unknown): number {
    if (raw === undefined || raw === null) return 20;
    if (typeof raw !== 'number' || !Number.isFinite(raw)) {
      throw new Error('limit deve ser numero');
    }
    if (raw < 1 || raw > 50) {
      throw new Error('limit deve estar entre 1 e 50');
    }
    return Math.floor(raw);
  }
}

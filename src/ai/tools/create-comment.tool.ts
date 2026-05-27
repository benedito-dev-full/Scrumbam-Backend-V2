import { Injectable, Logger } from '@nestjs/common';
import { CommentsService } from '../../comments/comments.service';
import { CommentTargetType } from '../../comments/dto/comment-target-type.enum';
import { AiToolDefinition } from '../providers/ai-provider.interface';
import { AiToolContext } from './tool-context';

/**
 * Tool `createComment` — proxy do `CommentsService.create`.
 *
 * Tenant isolation: o `CommentsService` ja faz a checagem via
 * `CommentTargetResolver` (delega para `ProjectsService.findAccessibleProjectIds`
 * com `organizationId`). A IA NUNCA escolhe o user — sempre vem de `ctx`.
 *
 * Erros (403/404) sao re-lancados como Error simples — o `GeminiProvider`
 * captura no loop de tool calling e devolve `{ error: <msg> }` para o modelo,
 * que entao traduz em linguagem natural para o user.
 */
@Injectable()
export class CreateCommentTool {
  private readonly logger = new Logger(CreateCommentTool.name);

  constructor(private readonly commentsService: CommentsService) {}

  /**
   * Constroi a definicao da tool para um contexto especifico (request).
   *
   * Eh chamada UMA vez por request — `ctx` fica preso na closure de `execute`.
   */
  build(ctx: AiToolContext): AiToolDefinition {
    return {
      name: 'createComment',
      description:
        'Cria um comentario em uma task, project, folder ou list. Use quando o usuario pedir para comentar/registrar algo.',
      parameters: {
        type: 'object',
        properties: {
          targetType: {
            type: 'string',
            enum: ['task', 'project', 'folder', 'list'],
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
      },
      execute: async (args: Record<string, unknown>) => {
        const targetType = this.parseTargetType(args.targetType);
        const targetId = this.parseString(args.targetId, 'targetId');
        const texto = this.parseString(args.texto, 'texto');

        const comment = await this.commentsService.create(
          targetType,
          targetId,
          { texto },
          ctx.userEntidadeId,
          ctx.organizationId,
        );

        this.logger.log(
          `ai_tool_createComment ok target=${targetType}/${targetId} commentId=${comment.id}`,
        );

        return {
          success: true,
          commentId: comment.id,
          targetType,
          targetId,
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
      throw new Error(`targetType invalido: ${raw}. Aceitos: task, project, folder, list`);
    }
    return lower as CommentTargetType;
  }

  private parseString(raw: unknown, field: string): string {
    if (typeof raw !== 'string' || raw.trim().length === 0) {
      throw new Error(`${field} deve ser string nao vazia`);
    }
    return raw;
  }
}

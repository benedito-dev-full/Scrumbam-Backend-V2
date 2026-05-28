import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommentsModule } from '../comments/comments.module';
import { ProjectsModule } from '../projects/projects.module';
import { TasksModule } from '../tasks/tasks.module';
import { AiChatController } from './ai-chat.controller';
import { AiChatService } from './ai-chat.service';
import { ChatMessagesService } from './chat-messages.service';
import { ContextBuilderService } from './context-builder.service';
import { GeminiApiKeyService } from './gemini-api-key.service';
import { GeminiProvider } from './providers/gemini.provider';
import { CreateCommentTool } from './tools/create-comment.tool';
import { CreateTaskTool } from './tools/create-task.tool';
import { GetProjectSummaryTool } from './tools/get-project-summary.tool';
import { ListCommentsTool } from './tools/list-comments.tool';
import { ToolRegistry } from './tools/tool-registry';

/**
 * AiModule — Nexus IA chat (Frente B — v1).
 *
 * Provider unico v1: Gemini (`gemini-2.5-flash`). Arquitetura preparada
 * para Claude/OpenAI futuro (interface `AiProvider`).
 *
 * Storage: `DEvento idClasse=-508 AI_CHAT_MESSAGE` (Pilar 1 N/A — audit).
 * API key: `DTabela idClasse=-481 GEMINI_API_KEY` (ADR-V2-004) + fallback
 *   `process.env.GOOGLE_API_KEY` para dev local.
 *
 * Tools v1 (4):
 *  - createComment / listComments — proxies do `CommentsService`.
 *  - createTask — proxy do `TasksService`.
 *  - getProjectSummary — combina `ProjectsService.findOne` + `getStats` + top tasks.
 *
 * **Dependencias (todas via forwardRef — evita ciclos):**
 *  - `AuthModule` — `AuthCompositeGuard`.
 *  - `CommentsModule` — `CommentsService`.
 *  - `TasksModule` — `TasksService`.
 *  - `ProjectsModule` — `ProjectsService`.
 *
 * `CommonModule` (PrismaService, CorrelationIdService) e `EventosModule`
 * (EventProducerService) sao `@Global()` — nao precisam de import.
 *
 * @see src/ai/README.md — gestao da chave Gemini em prod (seed manual).
 * @see docs/plans/2026-05-27-nexus-ia-chat.md — plano canonico.
 */
@Module({
  imports: [
    forwardRef(() => AuthModule),
    forwardRef(() => CommentsModule),
    forwardRef(() => TasksModule),
    forwardRef(() => ProjectsModule),
  ],
  controllers: [AiChatController],
  providers: [
    AiChatService,
    ChatMessagesService,
    ContextBuilderService,
    GeminiApiKeyService,
    GeminiProvider,
    ToolRegistry,
    CreateCommentTool,
    ListCommentsTool,
    CreateTaskTool,
    GetProjectSummaryTool,
  ],
  exports: [AiChatService, ChatMessagesService],
})
export class AiModule {}

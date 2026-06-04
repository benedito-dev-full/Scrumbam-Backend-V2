import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { CommentsModule } from '../comments/comments.module';
import { ProjectsModule } from '../projects/projects.module';
import { TasksModule } from '../tasks/tasks.module';
import { AiChatController } from './ai-chat.controller';
import { AiChatService } from './ai-chat.service';
import { ChatMessagesService } from './chat-messages.service';
import { ContextBuilderService } from './context-builder.service';
import { AiKeyResolverService } from './ai-key-resolver.service';
import { AiProviderPrefService } from './ai-provider-pref.service';
import { AiProviderRegistry } from './providers/ai-provider.registry';
import { ClaudeProvider } from './providers/claude.provider';
import { GeminiProvider } from './providers/gemini.provider';
import { OpenAiProvider } from './providers/openai.provider';
import { CreateCommentTool } from './tools/create-comment.tool';
import { CreateTaskTool } from './tools/create-task.tool';
import { GetProjectSummaryTool } from './tools/get-project-summary.tool';
import { ListCommentsTool } from './tools/list-comments.tool';
import { ToolRegistry } from './tools/tool-registry';

/**
 * AiModule — Nexus IA chat (Frente B — v1).
 *
 * Multi-provider: Gemini (`gemini-2.5-flash`, default/compat retroativa),
 * Claude (`claude-sonnet-4-5`) e OpenAI (`gpt-4o`). O `AiProviderRegistry`
 * indexa os 3 por `.name`; o `AiChatService` resolve o provider efetivo na
 * cascata `dto.provider → preferencia da org (DTabela -484) → default (gemini)`.
 *
 * Storage: `DEvento idClasse=-508 AI_CHAT_MESSAGE` (Pilar 1 N/A — audit).
 * API key: resolvida pelo `AiKeyResolverService` em cascata user→org→global→env
 *   (`DTabela -481/-482/-483` por provider + fallback env). O `AiProviderPrefService`
 *   le a preferencia default da org em `DTabela -484`. ADR-V2-004 / ADR-V2-064.
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
    AiKeyResolverService,
    AiProviderPrefService,
    GeminiProvider,
    ClaudeProvider,
    OpenAiProvider,
    AiProviderRegistry,
    ToolRegistry,
    CreateCommentTool,
    ListCommentsTool,
    CreateTaskTool,
    GetProjectSummaryTool,
  ],
  exports: [AiChatService, ChatMessagesService],
})
export class AiModule {}

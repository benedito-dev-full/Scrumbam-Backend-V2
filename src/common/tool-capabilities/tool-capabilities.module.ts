import { forwardRef, Module, OnModuleInit } from '@nestjs/common';

import { CommentsModule } from '../../comments/comments.module';
import { EntidadesModule } from '../../entidades/entidades.module';
import { ExecutionsModule } from '../../executions/executions.module';
import { FlowMetricsModule } from '../../flow-metrics/flow-metrics.module';
import { ForecastModule } from '../../forecast/forecast.module';
import { NotificationsModule } from '../../notifications/notifications.module';
import { ProjectsModule } from '../../projects/projects.module';
import { SearchModule } from '../../search/search.module';
import { TasksModule } from '../../tasks/tasks.module';
import { CreateBlockCapability } from './capabilities/blocks/create-block.capability';
import { CreateFromTemplateCapability } from './capabilities/blocks/create-from-template.capability';
import { ListBlockTasksCapability } from './capabilities/blocks/list-block-tasks.capability';
import { ListBlocksCapability } from './capabilities/blocks/list-blocks.capability';
import { CreateCommentCapability } from './capabilities/comments/create-comment.capability';
import { ExecuteTaskCapability } from './capabilities/executions/execute-task.capability';
import { ListCommentsCapability } from './capabilities/comments/list-comments.capability';
import { GetUnreadCountCapability } from './capabilities/misc/get-unread-count.capability';
import { ListMembersCapability } from './capabilities/misc/list-members.capability';
import { ListNotificationsCapability } from './capabilities/misc/list-notifications.capability';
import { UpdateNotificationCapability } from './capabilities/notifications/update-notification.capability';
import { CreateProjectCapability } from './capabilities/projects/create-project.capability';
import { GetProjectMetricsCapability } from './capabilities/projects/get-project-metrics.capability';
import { GetProjectCapability } from './capabilities/projects/get-project.capability';
import { ListProjectsCapability } from './capabilities/projects/list-projects.capability';
import { UpdateProjectCapability } from './capabilities/projects/update-project.capability';
import { CreateTaskCapability } from './capabilities/tasks/create-task.capability';
import { NEXUS_EXECUTE_TASK_ENABLED } from './execute-task.flag';
import { DeleteTaskCapability } from './capabilities/tasks/delete-task.capability';
import { GetTaskTreeCapability } from './capabilities/tasks/get-task-tree.capability';
import { GetTaskCapability } from './capabilities/tasks/get-task.capability';
import { ListMyTasksCapability } from './capabilities/tasks/list-my-tasks.capability';
import { ListTasksCapability } from './capabilities/tasks/list-tasks.capability';
import { SearchTasksCapability } from './capabilities/tasks/search-tasks.capability';
import { UpdateStatusCapability } from './capabilities/tasks/update-status.capability';
import { UpdateTaskCapability } from './capabilities/tasks/update-task.capability';
import { UpdateTimerCapability } from './capabilities/tasks/update-timer.capability';
import { Capability } from './capability.interface';
import { CapabilityRegistry } from './capability-registry';

/**
 * `ToolCapabilitiesModule` — hospeda a camada neutra de Capabilities
 * (`CapabilityRegistry` + capabilities de dominio) e faz o REGISTRO das
 * capabilities migradas no boot da aplicacao.
 *
 * Consumido por `McpModule` e `AiModule` (os dois adapters finos leem deste
 * MESMO `CapabilityRegistry` singleton — fonte unica, ADR-V2-079).
 *
 * Onda 1: registra `create_task` (piloto). Onda 2: registra `create_comment`
 * e `list_comments` (bidirecionalidade — nascem tambem no MCP). Onda 3:
 * registra as 13 reads so-MCP (tasks-read/projects-read/blocks-read/
 * misc-read) — nascem tambem no Nexus. Onda 4: registra as 9 writes so-MCP
 * (update_task/update_status/update_timer/delete_task/create_project/
 * update_project/create_block/create_from_template/update_notification) —
 * nascem tambem no Nexus. Ondas 5-6 removem os wrappers legados.
 *
 * Onda 6: registra `execute_task` (a tool mais sensivel — dispara `claude -p`
 * na VPS, DPedido -300..-303 via Pilar 1) SOMENTE quando a feature-flag
 * {@link NEXUS_EXECUTE_TASK_ENABLED} esta ON (default OFF). Registrar
 * condicionalmente e a trava mais forte: flag OFF => a capability nao entra no
 * `CapabilityRegistry`, entao NAO aparece no Nexus (nem no `McpCapabilityAdapter`).
 * O MCP continua servindo `execute_task` pelo wrapper legado independentemente
 * da flag (o `McpRouterService` roteia `executeTaskTool` diretamente, sem passar
 * pelo adapter) — wire byte-a-byte identico, golden verde nos dois estados.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Ondas 1, 2, 3, 4 e 6
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 */
@Module({
  imports: [
    forwardRef(() => TasksModule),
    forwardRef(() => ProjectsModule),
    forwardRef(() => CommentsModule),
    forwardRef(() => NotificationsModule),
    forwardRef(() => SearchModule),
    forwardRef(() => FlowMetricsModule),
    forwardRef(() => ForecastModule),
    forwardRef(() => ExecutionsModule),
    forwardRef(() => EntidadesModule),
  ],
  providers: [
    CapabilityRegistry,
    CreateTaskCapability,
    CreateCommentCapability,
    ListCommentsCapability,
    // Onda 6 — execute_task (sensivel; registrada so com flag ON)
    ExecuteTaskCapability,
    // Onda 3 — reads so-MCP (tasks-read)
    GetTaskCapability,
    GetTaskTreeCapability,
    ListTasksCapability,
    ListMyTasksCapability,
    SearchTasksCapability,
    // Onda 3 — reads so-MCP (projects-read)
    GetProjectCapability,
    ListProjectsCapability,
    GetProjectMetricsCapability,
    // Onda 3 — reads so-MCP (blocks-read)
    ListBlocksCapability,
    ListBlockTasksCapability,
    // Onda 3 — reads so-MCP (misc-read)
    ListMembersCapability,
    ListNotificationsCapability,
    GetUnreadCountCapability,
    // Onda 4 — writes so-MCP (tasks-write)
    UpdateTaskCapability,
    UpdateStatusCapability,
    UpdateTimerCapability,
    DeleteTaskCapability,
    // Onda 4 — writes so-MCP (projects-write)
    CreateProjectCapability,
    UpdateProjectCapability,
    // Onda 4 — writes so-MCP (blocks-write)
    CreateBlockCapability,
    CreateFromTemplateCapability,
    // Onda 4 — writes so-MCP (notifications-write)
    UpdateNotificationCapability,
  ],
  exports: [CapabilityRegistry],
})
export class ToolCapabilitiesModule implements OnModuleInit {
  constructor(
    private readonly registry: CapabilityRegistry,
    private readonly createTaskCapability: CreateTaskCapability,
    private readonly createCommentCapability: CreateCommentCapability,
    private readonly listCommentsCapability: ListCommentsCapability,
    private readonly getTaskCapability: GetTaskCapability,
    private readonly getTaskTreeCapability: GetTaskTreeCapability,
    private readonly listTasksCapability: ListTasksCapability,
    private readonly listMyTasksCapability: ListMyTasksCapability,
    private readonly searchTasksCapability: SearchTasksCapability,
    private readonly getProjectCapability: GetProjectCapability,
    private readonly listProjectsCapability: ListProjectsCapability,
    private readonly getProjectMetricsCapability: GetProjectMetricsCapability,
    private readonly listBlocksCapability: ListBlocksCapability,
    private readonly listBlockTasksCapability: ListBlockTasksCapability,
    private readonly listMembersCapability: ListMembersCapability,
    private readonly listNotificationsCapability: ListNotificationsCapability,
    private readonly getUnreadCountCapability: GetUnreadCountCapability,
    // Onda 4 — writes so-MCP
    private readonly updateTaskCapability: UpdateTaskCapability,
    private readonly updateStatusCapability: UpdateStatusCapability,
    private readonly updateTimerCapability: UpdateTimerCapability,
    private readonly deleteTaskCapability: DeleteTaskCapability,
    private readonly createProjectCapability: CreateProjectCapability,
    private readonly updateProjectCapability: UpdateProjectCapability,
    private readonly createBlockCapability: CreateBlockCapability,
    private readonly createFromTemplateCapability: CreateFromTemplateCapability,
    private readonly updateNotificationCapability: UpdateNotificationCapability,
    // Onda 6 — execute_task (registrada condicionalmente pela feature-flag)
    private readonly executeTaskCapability: ExecuteTaskCapability,
  ) {}

  /**
   * Registra as capabilities migradas no `CapabilityRegistry` singleton.
   * Idempotente por natureza do boot (roda uma vez por processo).
   */
  onModuleInit(): void {
    this.registerIfAbsent(this.createTaskCapability);
    this.registerIfAbsent(this.createCommentCapability);
    this.registerIfAbsent(this.listCommentsCapability);
    this.registerIfAbsent(this.getTaskCapability);
    this.registerIfAbsent(this.getTaskTreeCapability);
    this.registerIfAbsent(this.listTasksCapability);
    this.registerIfAbsent(this.listMyTasksCapability);
    this.registerIfAbsent(this.searchTasksCapability);
    this.registerIfAbsent(this.getProjectCapability);
    this.registerIfAbsent(this.listProjectsCapability);
    this.registerIfAbsent(this.getProjectMetricsCapability);
    this.registerIfAbsent(this.listBlocksCapability);
    this.registerIfAbsent(this.listBlockTasksCapability);
    this.registerIfAbsent(this.listMembersCapability);
    this.registerIfAbsent(this.listNotificationsCapability);
    this.registerIfAbsent(this.getUnreadCountCapability);
    // Onda 4 — writes so-MCP
    this.registerIfAbsent(this.updateTaskCapability);
    this.registerIfAbsent(this.updateStatusCapability);
    this.registerIfAbsent(this.updateTimerCapability);
    this.registerIfAbsent(this.deleteTaskCapability);
    this.registerIfAbsent(this.createProjectCapability);
    this.registerIfAbsent(this.updateProjectCapability);
    this.registerIfAbsent(this.createBlockCapability);
    this.registerIfAbsent(this.createFromTemplateCapability);
    this.registerIfAbsent(this.updateNotificationCapability);
    // Onda 6 — execute_task SO e registrada com a feature-flag ON (default OFF).
    // Flag OFF => nao entra no registry => ausente do Nexus (e do McpCapability-
    // Adapter). MCP serve execute_task pelo wrapper legado independentemente.
    if (NEXUS_EXECUTE_TASK_ENABLED) {
      this.registerIfAbsent(this.executeTaskCapability);
    }
  }

  private registerIfAbsent(capability: Capability): void {
    if (!this.registry.has(capability.name)) {
      this.registry.register(capability);
    }
  }
}

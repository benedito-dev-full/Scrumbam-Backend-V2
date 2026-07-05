import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuthModule } from '../auth/auth.module';
import { EntidadesModule } from '../entidades/entidades.module';
import { ExecutionsModule } from '../executions/executions.module';
import { FlowMetricsModule } from '../flow-metrics/flow-metrics.module';
import { ForecastModule } from '../forecast/forecast.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ProjectsModule } from '../projects/projects.module';
import { SearchModule } from '../search/search.module';
import { TabelasModule } from '../tabelas/tabelas.module';
import { TasksModule } from '../tasks/tasks.module';
import { McpAuthGuard } from './guards/mcp-auth.guard';
import { McpEnabledGuard } from './guards/mcp-enabled.guard';
import { McpKeyGuard } from './guards/mcp-key.guard';
import { McpOriginGuard } from './guards/mcp-origin.guard';
import { McpKeysController } from './mcp-keys.controller';
import { McpController } from './mcp.controller';
import { WellKnownController } from './well-known.controller';
import { McpBearerService } from './services/mcp-bearer.service';
import { McpJsonRpcService } from './services/mcp-json-rpc.service';
import { McpAuditService } from './services/mcp-audit.service';
import { McpKeyService } from './services/mcp-key.service';
import { McpRateLimitService } from './services/mcp-rate-limit.service';
import { McpRouterService } from './services/mcp-router.service';
import { CreateBlockTool } from './tools/create-block.tool';
import { CreateFromTemplateTool } from './tools/create-from-template.tool';
import { CreateProjectTool } from './tools/create-project.tool';
import { CreateTaskTool } from './tools/create-task.tool';
import { DeleteTaskTool } from './tools/delete-task.tool';
import { ExecuteTaskTool } from './tools/execute-task.tool';
import { GetProjectMetricsTool } from './tools/get-project-metrics.tool';
import { GetProjectTool } from './tools/get-project.tool';
import { GetTaskTreeTool } from './tools/get-task-tree.tool';
import { GetTaskTool } from './tools/get-task.tool';
import { GetUnreadCountTool } from './tools/get-unread-count.tool';
import { ListMyTasksTool } from './tools/list-my-tasks.tool';
import { ListBlockTasksTool } from './tools/list-block-tasks.tool';
import { ListBlocksTool } from './tools/list-blocks.tool';
import { ListMembersTool } from './tools/list-members.tool';
import { ListNotificationsTool } from './tools/list-notifications.tool';
import { ListProjectsTool } from './tools/list-projects.tool';
import { ListTasksTool } from './tools/list-tasks.tool';
import { SearchTasksTool } from './tools/search-tasks.tool';
import { UpdateNotificationTool } from './tools/update-notification.tool';
import { UpdateProjectTool } from './tools/update-project.tool';
import { UpdateStatusTool } from './tools/update-status.tool';
import { UpdateTaskTool } from './tools/update-task.tool';
import { UpdateTimerTool } from './tools/update-timer.tool';

@Module({
  imports: [
    AuthModule,
    EntidadesModule,
    TasksModule,
    ProjectsModule,
    TabelasModule,
    NotificationsModule,
    SearchModule,
    ExecutionsModule.forRoot(),
    FlowMetricsModule,
    ForecastModule,
  ],
  controllers: [McpController, McpKeysController, WellKnownController],
  providers: [
    McpJsonRpcService,
    McpKeyService,
    McpBearerService,
    McpRateLimitService,
    McpAuditService,
    McpEnabledGuard,
    McpOriginGuard,
    McpKeyGuard,
    McpAuthGuard,
    McpRouterService,
    ListTasksTool,
    CreateTaskTool,
    UpdateStatusTool,
    ListProjectsTool,
    GetTaskTool,
    UpdateTaskTool,
    ListMembersTool,
    GetProjectTool,
    UpdateProjectTool,
    ListNotificationsTool,
    UpdateNotificationTool,
    GetUnreadCountTool,
    SearchTasksTool,
    ListBlocksTool,
    ListBlockTasksTool,
    ExecuteTaskTool,
    UpdateTimerTool,
    DeleteTaskTool,
    GetTaskTreeTool,
    GetProjectMetricsTool,
    ListMyTasksTool,
    CreateBlockTool,
    CreateProjectTool,
    CreateFromTemplateTool,
  ],
  exports: [McpKeyService, McpRouterService, McpRateLimitService, McpAuditService],
})
export class McpModule implements OnModuleInit {
  private readonly logger = new Logger(McpModule.name);

  constructor(private readonly configService: ConfigService) {}

  onModuleInit(): void {
    if (this.configService.get<string>('MCP_ENABLED') !== 'true') {
      this.logger.warn('McpModule inicializado com MCP_ENABLED !== "true"');
      return;
    }

    this.logger.log('McpModule inicializado com MCP_ENABLED=true');
  }
}

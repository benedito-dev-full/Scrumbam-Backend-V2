import { Logger, Module, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { AuthModule } from '../auth/auth.module';
import { EntidadesModule } from '../entidades/entidades.module';
import { ProjectsModule } from '../projects/projects.module';
import { TabelasModule } from '../tabelas/tabelas.module';
import { TasksModule } from '../tasks/tasks.module';
import { McpEnabledGuard } from './guards/mcp-enabled.guard';
import { McpKeyGuard } from './guards/mcp-key.guard';
import { McpKeysController } from './mcp-keys.controller';
import { McpController } from './mcp.controller';
import { McpJsonRpcService } from './services/mcp-json-rpc.service';
import { McpAuditService } from './services/mcp-audit.service';
import { McpKeyService } from './services/mcp-key.service';
import { McpRateLimitService } from './services/mcp-rate-limit.service';
import { McpRouterService } from './services/mcp-router.service';
import { CreateTaskTool } from './tools/create-task.tool';
import { ListProjectsTool } from './tools/list-projects.tool';
import { ListSprintsTool } from './tools/list-sprints.tool';
import { ListTasksTool } from './tools/list-tasks.tool';
import { UpdateStatusTool } from './tools/update-status.tool';

@Module({
  imports: [AuthModule, EntidadesModule, TasksModule, ProjectsModule, TabelasModule],
  controllers: [McpController, McpKeysController],
  providers: [
    McpJsonRpcService,
    McpKeyService,
    McpRateLimitService,
    McpAuditService,
    McpEnabledGuard,
    McpKeyGuard,
    McpRouterService,
    ListTasksTool,
    CreateTaskTool,
    UpdateStatusTool,
    ListProjectsTool,
    ListSprintsTool,
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

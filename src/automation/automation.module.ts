import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { AgentsController } from './agents/agents.controller';
import { AgentEnvController } from './agents/agent-env.controller';
import { AgentEnvService } from './agents/agent-env.service';
import { AgentInstallTokenService } from './agents/agent-install-token.service';
import { AgentKeyService } from './agents/agent-key.service';
import { AgentPortAllocatorService } from './agents/agent-port-allocator.service';
import { AgentsService } from './agents/agents.service';
import { AgentStatusSweeperService } from './agents/agent-status-sweeper.service';
import { AgentTunnelService } from './agents/agent-tunnel.service';
import { AgentSecurityService } from './agents/agent-security.service';
import { AgentAuthGuard } from './agents/guards/agent-auth.guard';
import { ProjectAgentController } from './project-agent/project-agent.controller';
import { ProjectAgentLinkService } from './project-agent/project-agent-link.service';
import { DeployKeyController } from './project-agent/deploy-key.controller';
import { DeployKeyService } from './project-agent/deploy-key.service';
import { GithubPrService } from './github/github-pr.service';
import { ExecutionRuntimeLogService } from './runtime/execution-runtime-log.service';
import { ExecutionWorktreeService } from './runtime/execution-worktree.service';
import { RemoteExecutionClient } from './runtime/remote-execution-client';
import { RollbackService } from './runtime/rollback.service';
import { AutomationMetricsController } from './metrics/automation-metrics.controller';
import { AutomationMetricsService } from './metrics/automation-metrics.service';

@Module({
  imports: [AuthModule],
  controllers: [
    AgentsController,
    AgentEnvController,
    ProjectAgentController,
    DeployKeyController,
    AutomationMetricsController,
  ],
  providers: [
    AgentInstallTokenService,
    AgentKeyService,
    AgentPortAllocatorService,
    AgentsService,
    AgentEnvService,
    AgentStatusSweeperService,
    AgentTunnelService,
    AgentSecurityService,
    ProjectAgentLinkService,
    DeployKeyService,
    AgentAuthGuard,
    ExecutionRuntimeLogService,
    RemoteExecutionClient,
    ExecutionWorktreeService,
    RollbackService,
    GithubPrService,
    AutomationMetricsService,
  ],
  exports: [
    AgentKeyService,
    AgentsService,
    AgentTunnelService,
    AgentSecurityService,
    ProjectAgentLinkService,
    ExecutionRuntimeLogService,
    RemoteExecutionClient,
    ExecutionWorktreeService,
    RollbackService,
    GithubPrService,
    AutomationMetricsService,
  ],
})
export class AutomationModule {}

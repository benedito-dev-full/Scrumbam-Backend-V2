import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { Request } from 'express';
import { AgentsService, AuthenticatedAgent } from '../agents.service';
import { AgentKeyService } from '../agent-key.service';
import { AgentSecurityService } from '../agent-security.service';

export interface AgentAuthenticatedRequest extends Request {
  agent?: AuthenticatedAgent;
}

@Injectable()
export class AgentAuthGuard implements CanActivate {
  constructor(
    private readonly agentsService: AgentsService,
    private readonly agentKeyService: AgentKeyService,
    private readonly agentSecurityService: AgentSecurityService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AgentAuthenticatedRequest>();
    const agentIdHeader = this.getHeader(request, 'x-agent-id');
    const keyHeader = this.getHeader(request, 'x-agent-key');
    const nonceHeader = this.getHeader(request, 'x-agent-nonce');
    const timestampHeader = this.getHeader(request, 'x-agent-timestamp');

    if (
      !agentIdHeader ||
      !keyHeader ||
      !nonceHeader ||
      !timestampHeader ||
      !/^\d+$/.test(agentIdHeader)
    ) {
      throw new UnauthorizedException('Agent authentication required');
    }

    this.validateTimestamp(timestampHeader);
    await this.agentSecurityService.assertRequestAllowed(agentIdHeader, nonceHeader);

    const routeAgentId = request.params?.id;
    if (routeAgentId && routeAgentId !== agentIdHeader) {
      throw new UnauthorizedException('Agent id mismatch');
    }

    const agent = await this.agentsService.findAgentForAuth(BigInt(agentIdHeader));
    const apiKeyHash = agent.dados.apiKeyHash;
    if (typeof apiKeyHash !== 'string' || !this.agentKeyService.verifySecret(keyHeader, apiKeyHash)) {
      throw new UnauthorizedException('Agent authentication failed');
    }

    request.agent = agent;
    return true;
  }

  private getHeader(request: Request, name: string): string | undefined {
    const value = request.headers[name];
    if (Array.isArray(value)) return value[0];
    return typeof value === 'string' ? value : undefined;
  }

  private validateTimestamp(value: string): void {
    const parsed = new Date(value).getTime();
    if (!Number.isFinite(parsed)) {
      throw new UnauthorizedException('Invalid agent timestamp');
    }
    const skewMs = Math.abs(Date.now() - parsed);
    if (skewMs > 5 * 60_000) {
      throw new UnauthorizedException('Agent timestamp outside allowed window');
    }
  }
}

import { CanActivate, ExecutionContext, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Bloqueia rotas MCP quando a feature flag MCP_ENABLED nao esta ativa.
 *
 * O plano F11 exige que o MCP nao fique exposto em deployments sem opt-in.
 */
@Injectable()
export class McpEnabledGuard implements CanActivate {
  constructor(private readonly configService: ConfigService) {}

  canActivate(_context: ExecutionContext): boolean {
    if (this.configService.get<string>('MCP_ENABLED') !== 'true') {
      throw new NotFoundException('MCP module disabled');
    }

    return true;
  }
}

import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';

import { MCP_ERROR_CODES } from '../constants';
import { McpAuthenticatedRequest } from '../interfaces/mcp.types';
import { McpKeyService } from '../services/mcp-key.service';

@Injectable()
export class McpKeyGuard implements CanActivate {
  private readonly logger = new Logger(McpKeyGuard.name);

  constructor(private readonly mcpKeyService: McpKeyService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<McpAuthenticatedRequest>();
    const header = request.headers?.['x-mcp-key'];
    const plaintext = Array.isArray(header) ? header[0] : header;

    if (!plaintext || typeof plaintext !== 'string') {
      request.mcpAuthError = {
        code: MCP_ERROR_CODES.UNAUTHORIZED,
        message: 'Unauthorized',
      };
      return true;
    }

    const payload = await this.mcpKeyService.validatePlaintext(plaintext);
    if (!payload) {
      this.logger.debug('mcp_key_invalid');
      request.mcpAuthError = {
        code: MCP_ERROR_CODES.UNAUTHORIZED,
        message: 'Unauthorized',
      };
      return true;
    }

    request.userCtx = {
      dEntidadeId: BigInt(payload.dEntidadeId),
      scopes: payload.scopes,
      keyChave: BigInt(payload.chave),
      keyPrefix: payload.prefix,
      keyHash: payload.hash,
    };

    return true;
  }
}

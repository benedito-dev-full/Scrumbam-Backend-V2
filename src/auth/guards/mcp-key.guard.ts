import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { McpKeyService } from '../services/mcp-key.service';

/**
 * Guard de autenticação via MCP Key (header X-MCP-Key).
 *
 * Comportamento:
 * - Lê header X-MCP-Key
 * - Valida via McpKeyService.validate (hash SHA-256)
 * - Se válido: popula req.user.entidadeId e req['authMethod'] = 'mcpkey'
 * - Se inválido: retorna false (NÃO lança — AuthCompositeGuard decide)
 *
 * REGRA CRÍTICA: Guards internos NÃO lançam UnauthorizedException.
 * Ordem no Composite: MCP Key (1º) → API Key → JWT (Decisão D1).
 * MCP Key tem prioridade por ser o mecanismo mais específico.
 *
 * @see AuthCompositeGuard — executa este guard como primeiro na ordem
 * @see McpKeyService — valida via DUserGroup.dados.mcpKeyHash (latência mínima)
 */
@Injectable()
export class McpKeyGuard implements CanActivate {
  private readonly logger = new Logger(McpKeyGuard.name);

  constructor(private readonly mcpKeyService: McpKeyService) {}

  /**
   * Verifica se a request tem X-MCP-Key válida.
   *
   * Popula req.user com { sub, entidadeId } mínimos se válida.
   * Retorna false sem lançar se inválida ou ausente.
   *
   * @param context - Contexto de execução NestJS
   * @returns true se MCP Key válida, false caso contrário
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const mcpKey = (request.headers as Record<string, string>)['x-mcp-key'];

    if (!mcpKey) {
      return false;
    }

    const result = await this.mcpKeyService.validate(mcpKey);

    if (!result) {
      this.logger.debug('MCP Key inválida ou não encontrada');
      return false;
    }

    // Popula req.user com payload mínimo compatível com JwtPayload
    request['user'] = {
      sub: result.userId.toString(),
      entidadeId: result.userId.toString(),
      organizationId: '',
      email: '',
    };
    request['authMethod'] = 'mcpkey';
    this.logger.debug(`MCP Key válida — userId=${result.userId}`);

    return true;
  }
}

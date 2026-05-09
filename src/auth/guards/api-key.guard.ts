import { CanActivate, ExecutionContext, Injectable, Logger } from '@nestjs/common';
import { ApiKeyService } from '../services/api-key.service';

/**
 * Guard de autenticação via API Key (header X-API-Key).
 *
 * Comportamento:
 * - Lê header X-API-Key
 * - Valida via ApiKeyService.validate (hash SHA-256)
 * - Se válido: popula req['project'] e req['authMethod'] = 'apikey'
 * - Se inválido: retorna false (NÃO lança — AuthCompositeGuard decide)
 *
 * REGRA CRÍTICA: Guards internos NÃO lançam UnauthorizedException.
 * Ordem no Composite: MCP Key → API Key → JWT (Decisão D1).
 *
 * @see AuthCompositeGuard — executa este guard como segundo na ordem
 * @see ApiKeyService — valida e atualiza lastUsedAt
 */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  private readonly logger = new Logger(ApiKeyGuard.name);

  constructor(private readonly apiKeyService: ApiKeyService) {}

  /**
   * Verifica se a request tem X-API-Key válida.
   *
   * Popula req['project'] com { id, orgId } se válida.
   * Retorna false sem lançar se inválida ou ausente.
   *
   * @param context - Contexto de execução NestJS
   * @returns true se API Key válida, false caso contrário
   */
  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<Record<string, unknown>>();
    const apiKey = (request.headers as Record<string, string>)['x-api-key'];

    if (!apiKey) {
      return false;
    }

    const result = await this.apiKeyService.validate(apiKey);

    if (!result) {
      this.logger.debug('API Key inválida ou não encontrada');
      return false;
    }

    // Popula contexto da request com informações do projeto
    request['project'] = {
      id: result.tabelaChave.toString(),
      orgId: result.projectId?.toString() ?? null,
    };
    request['authMethod'] = 'apikey';
    this.logger.debug(`API Key válida — project=${result.tabelaChave}`);

    return true;
  }
}

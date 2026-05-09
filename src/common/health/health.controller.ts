import { Controller, Get, HttpCode, HttpStatus, Res } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Response } from 'express';

// Services do projeto
import { HealthService, HealthStatus } from './health.service';
import { Public } from '../../auth/decorators/public.decorator';

/**
 * Controller de Health Check do Scrumban-Backend-V2.
 *
 * Endpoint público (sem autenticação) que verifica a saúde do sistema.
 * Usado por load balancers, monitoramento e CD pipelines para verificar
 * se o serviço está operacional antes de rotear tráfego.
 *
 * Comportamento:
 * - Status 'ok' → HTTP 200
 * - Status 'degraded' → HTTP 200 (sistema funcional, com avisos)
 * - Status 'error' → HTTP 503 (sistema com falha crítica)
 *
 * @example
 * ```bash
 * curl http://localhost:3000/api/v1/health
 * # 200 OK
 * # {
 * #   "status": "ok",
 * #   "checks": {
 * #     "db": { "status": "ok", "latencyMs": 5 },
 * #     "redis": { "status": "degraded", "message": "REDIS_URL não configurado" },
 * #     "email": { "status": "ok", "message": "EMAIL_MOCK=true" }
 * #   }
 * # }
 * ```
 */
@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  /**
   * Retorna o status de saúde do sistema e de suas dependências.
   *
   * Endpoint público — não requer autenticação JWT ou API Key.
   * Usado por load balancers e pipelines de CD para readiness check.
   *
   * @param res - Response Express (para controlar status code HTTP)
   * @returns Promise com status geral e checks de DB, Redis e Email
   *
   * @throws Nunca lança exceção — erros são encapsulados no payload
   *
   * @example
   * ```bash
   * # Verificar health
   * curl http://localhost:3000/api/v1/health
   *
   * # Com X-Correlation-Id
   * curl -H "X-Correlation-Id: my-probe-123" http://localhost:3000/api/v1/health -i
   * ```
   *
   * @example
   * ```json
   * // Response 200 OK (sistema saudável)
   * {
   *   "status": "ok",
   *   "checks": {
   *     "db": { "status": "ok", "latencyMs": 3 },
   *     "redis": { "status": "ok", "latencyMs": 1 },
   *     "email": { "status": "ok" }
   *   }
   * }
   *
   * // Response 503 (DB indisponível — crítico)
   * {
   *   "status": "error",
   *   "checks": {
   *     "db": { "status": "error", "message": "Connection refused" },
   *     "redis": { "status": "ok", "latencyMs": 1 },
   *     "email": { "status": "ok" }
   *   }
   * }
   * ```
   */
  @Get()
  @Public()
  @ApiOperation({
    summary: 'Health check do sistema',
    description:
      'Verifica a saúde das dependências críticas (DB, Redis, Email). Endpoint público sem autenticação.',
  })
  @ApiResponse({
    status: 200,
    description: 'Sistema saudável ou com avisos não críticos (status: ok | degraded)',
    schema: {
      example: {
        status: 'ok',
        checks: {
          db: { status: 'ok', latencyMs: 5 },
          redis: { status: 'degraded', message: 'REDIS_URL não configurado' },
          email: { status: 'ok', message: 'EMAIL_MOCK=true' },
        },
      },
    },
  })
  @ApiResponse({
    status: 503,
    description: 'Sistema com falha crítica (status: error)',
  })
  @HttpCode(HttpStatus.OK)
  async getHealth(@Res({ passthrough: true }) res: Response): Promise<HealthStatus> {
    const status = await this.healthService.getStatus();

    if (status.status === 'error') {
      res.status(HttpStatus.SERVICE_UNAVAILABLE);
    }

    return status;
  }
}

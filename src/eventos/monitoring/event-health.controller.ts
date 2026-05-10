import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiTags, ApiBearerAuth } from '@nestjs/swagger';
import { JwtAuthGuard } from '../../auth/guards/jwt-auth.guard';
import { CircuitBreakerService } from '../core/circuit-breaker.service';
import { IntelligentRetryService } from '../core/intelligent-retry.service';
import { TelemetryService } from './telemetry.service';
import { EventHealthResponseDto } from '../dto/event-health-response.dto';

/**
 * Endpoint de saúde do `EventProducer`.
 *
 * Em Task#1 F7: read-only. Retorna estado interno para monitoramento.
 * Auth: JWT obrigatório (qualquer usuário autenticado pode consultar).
 *
 * Nota: o filtro por roles (admin only) será adicionado quando o V2
 * tiver um conceito de SUPER_ADMIN sistêmico — `RolesGuard` atual é
 * por organização (ADMIN/MEMBER/VIEWER de uma org específica), e este
 * endpoint não pertence a uma org. Documentado em README.
 */
@ApiTags('events')
@Controller('events')
@UseGuards(JwtAuthGuard)
@ApiBearerAuth()
export class EventHealthController {
  constructor(
    private readonly circuitBreaker: CircuitBreakerService,
    private readonly retry: IntelligentRetryService,
    private readonly telemetry: TelemetryService,
  ) {}

  /**
   * Retorna snapshot do estado do EventProducer.
   *
   * Status global:
   *  - `healthy`: nenhum CB aberto + retries pendentes < 100.
   *  - `degraded`: pelo menos 1 CB half-open OU retries pendentes ≥ 100.
   *  - `unhealthy`: pelo menos 1 CB open.
   */
  @Get('health')
  @ApiOperation({
    summary: 'Snapshot de saúde do EventProducer',
    description:
      'Retorna estado interno: CircuitBreakers por consumer, retries ' +
      'pendentes em memória e contadores de telemetria (1min/1h).',
  })
  @ApiResponse({
    status: 200,
    description: 'Snapshot atual',
    type: EventHealthResponseDto,
  })
  @ApiResponse({ status: 401, description: 'JWT inválido ou ausente' })
  health(): EventHealthResponseDto {
    const cbAll = this.circuitBreaker.getAllMetrics();
    const pendingRetries = this.retry.getPendingCount();
    const eventsPerMinute = this.telemetry.getEventsPerMinute();
    const totalLastHour = this.telemetry.getTotalLastHour();
    const maxAttemptsExceeded = this.retry.getMaxAttemptsExceeded();

    let hasOpen = false;
    let hasHalfOpen = false;
    const byConsumer: Record<string, { state: 'closed' | 'open' | 'half-open'; failuresInWindow: number }> = {};
    for (const [name, m] of Object.entries(cbAll)) {
      byConsumer[name] = { state: m.state, failuresInWindow: m.failuresInWindow };
      if (m.state === 'open') hasOpen = true;
      if (m.state === 'half-open') hasHalfOpen = true;
    }

    let status: 'healthy' | 'degraded' | 'unhealthy' = 'healthy';
    if (hasOpen) status = 'unhealthy';
    else if (hasHalfOpen || pendingRetries >= 100) status = 'degraded';

    return {
      status,
      circuitBreaker: { byConsumer },
      retry: { pendingRetries, maxAttemptsExceeded },
      telemetry: { eventsPerMinute, totalEventsLastHour: totalLastHour },
      consumers: {
        byName: {
          'audit-log': 'up',
          notification: 'pending (Task#2)',
          webhook: 'pending (Task#4)',
        },
      },
      timestamp: new Date().toISOString(),
    };
  }
}

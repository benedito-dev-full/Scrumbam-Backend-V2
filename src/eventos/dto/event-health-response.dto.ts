import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO de resposta para `GET /events/health`.
 *
 * Estrutura interna do EventProducer (CircuitBreaker, retry pendentes,
 * telemetria por janela). Útil para monitoramento e admin UI futura.
 */
export class CircuitBreakerStateDto {
  @ApiProperty({ enum: ['closed', 'open', 'half-open'], example: 'closed' })
  state!: 'closed' | 'open' | 'half-open';

  @ApiProperty({ example: 0, description: 'Falhas na janela 60s' })
  failuresInWindow!: number;
}

export class CircuitBreakerSnapshotDto {
  @ApiProperty({
    description: 'Estado por consumer (chave = nome curto kebab-case)',
    example: { 'audit-log': { state: 'closed', failuresInWindow: 0 } },
    additionalProperties: { type: 'object' },
  })
  byConsumer!: Record<string, CircuitBreakerStateDto>;
}

export class RetrySnapshotDto {
  @ApiProperty({ example: 0, description: 'Retries pendentes em memória' })
  pendingRetries!: number;

  @ApiProperty({
    example: 0,
    description: 'Eventos que excederam o máximo de 5 tentativas (sessão atual)',
  })
  maxAttemptsExceeded!: number;
}

export class TelemetrySnapshotDto {
  @ApiProperty({
    description: 'Eventos por minuto agrupados por type (janela 60s)',
    example: { 'task.created': 5, 'execution.high.created': 1 },
    additionalProperties: { type: 'number' },
  })
  eventsPerMinute!: Record<string, number>;

  @ApiProperty({ example: 1234, description: 'Total emitidos na última 1h' })
  totalEventsLastHour!: number;
}

export class ConsumersSnapshotDto {
  @ApiProperty({
    description: 'Status por consumer (`up` em Task#1; outros vêm em Task#2/#4)',
    example: {
      'audit-log': 'up',
      notification: 'pending (Task#2)',
      webhook: 'pending (Task#4)',
    },
    additionalProperties: { type: 'string' },
  })
  byName!: Record<string, string>;
}

export class EventHealthResponseDto {
  @ApiProperty({ enum: ['healthy', 'degraded', 'unhealthy'], example: 'healthy' })
  status!: 'healthy' | 'degraded' | 'unhealthy';

  @ApiProperty({ type: CircuitBreakerSnapshotDto })
  circuitBreaker!: CircuitBreakerSnapshotDto;

  @ApiProperty({ type: RetrySnapshotDto })
  retry!: RetrySnapshotDto;

  @ApiProperty({ type: TelemetrySnapshotDto })
  telemetry!: TelemetrySnapshotDto;

  @ApiProperty({ type: ConsumersSnapshotDto })
  consumers!: ConsumersSnapshotDto;

  @ApiPropertyOptional({
    example: '2026-05-09T12:34:56.789Z',
    description: 'Timestamp ISO 8601 do snapshot',
  })
  timestamp?: string;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { SupportedEvent } from '../constants/supported-events';

export class WebhookResponseDto {
  @ApiProperty({ example: '123' })
  id!: string;

  @ApiProperty({ example: '100' })
  projectId!: string;

  @ApiProperty({ example: 'https://hooks.example.com/scrumban' })
  url!: string;

  @ApiProperty({ example: ['task.created'] })
  events!: SupportedEvent[];

  @ApiProperty({ example: false })
  disabled!: boolean;

  @ApiProperty({ example: 0 })
  failureCount!: number;

  @ApiProperty({ example: '2026-05-10T12:00:00.000Z' })
  createdAt!: string;

  @ApiPropertyOptional({ example: null, nullable: true })
  lastSuccessAt!: string | null;

  @ApiPropertyOptional({ example: null, nullable: true })
  lastFailureAt!: string | null;
}

export class WebhookCreatedResponseDto extends WebhookResponseDto {
  @ApiProperty({
    description: 'Secret plaintext retornado somente na criacao',
    example: 'a'.repeat(64),
  })
  secret!: string;
}

export class ListWebhooksResponseDto {
  @ApiProperty({ type: [WebhookResponseDto] })
  items!: WebhookResponseDto[];

  @ApiProperty({ example: { hasMore: false, nextCursor: null } })
  pagination!: {
    hasMore: boolean;
    nextCursor: string | null;
  };
}

export class TestWebhookResponseDto {
  @ApiProperty({ example: 'test-123' })
  deliveryId!: string;

  @ApiProperty({ example: 'task.created' })
  eventType!: string;

  @ApiProperty({ example: true })
  success!: boolean;

  @ApiPropertyOptional({ example: 204, nullable: true })
  httpCode!: number | null;

  @ApiProperty({ example: 42 })
  durationMs!: number;

  @ApiPropertyOptional({ example: null, nullable: true })
  errorMessage!: string | null;
}

export class RedriveWebhookResponseDto {
  @ApiProperty({ example: '123' })
  id!: string;

  @ApiProperty({ example: false })
  disabled!: boolean;

  @ApiProperty({ example: 0 })
  failureCount!: number;
}

export class WebhookAttemptResponseDto {
  @ApiProperty({ example: '9001' })
  id!: string;

  @ApiProperty({ example: '-491' })
  idClasse!: string;

  @ApiPropertyOptional({ example: '100', nullable: true })
  projectId!: string | null;

  @ApiPropertyOptional({ example: 'webhook.delivery.fail', nullable: true })
  descricao!: string | null;

  @ApiPropertyOptional({ example: 'delivery-1:3', nullable: true })
  identificadorExterno!: string | null;

  @ApiProperty({ example: '2026-05-10T12:00:00.000Z' })
  criadoEm!: string;

  @ApiProperty({ example: { webhookId: '123', status: 'fail', attempt: 3 } })
  metaDados!: Record<string, unknown> | null;
}

export class ListWebhookAttemptsResponseDto {
  @ApiProperty({ type: [WebhookAttemptResponseDto] })
  items!: WebhookAttemptResponseDto[];

  @ApiProperty({ example: { hasMore: false, nextCursor: null } })
  pagination!: {
    hasMore: boolean;
    nextCursor: string | null;
  };
}

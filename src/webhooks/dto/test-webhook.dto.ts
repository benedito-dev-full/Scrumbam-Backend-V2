import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsObject, IsOptional } from 'class-validator';
import { SUPPORTED_EVENTS, SupportedEvent } from '../constants/supported-events';

export class TestWebhookDto {
  @ApiPropertyOptional({
    description: 'Tipo de evento usado no teste; default task.created',
    enum: SUPPORTED_EVENTS,
    example: 'task.created',
  })
  @IsOptional()
  @IsIn(SUPPORTED_EVENTS)
  eventType?: SupportedEvent;

  @ApiPropertyOptional({
    description: 'Payload adicional para o teste sincrono',
    example: { smoke: true },
  })
  @IsOptional()
  @IsObject()
  payload?: Record<string, unknown>;
}

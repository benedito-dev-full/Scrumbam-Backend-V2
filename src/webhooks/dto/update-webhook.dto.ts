import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayMinSize, IsArray, IsIn, IsOptional, IsString, IsUrl } from 'class-validator';
import { SUPPORTED_EVENTS, SupportedEvent } from '../constants/supported-events';

export class UpdateWebhookDto {
  @ApiPropertyOptional({ description: 'URL de entrega HTTP/HTTPS', example: 'https://hooks.example.com/scrumban' })
  @IsOptional()
  @IsString()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  url?: string;

  @ApiPropertyOptional({
    description: 'Eventos assinados por este webhook',
    enum: SUPPORTED_EVENTS,
    isArray: true,
    example: ['task.created', 'task.status_changed'],
  })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(SUPPORTED_EVENTS, { each: true })
  events?: SupportedEvent[];
}


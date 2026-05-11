import { ApiProperty } from '@nestjs/swagger';
import {
  ArrayMinSize,
  IsArray,
  IsIn,
  IsNotEmpty,
  IsNumberString,
  IsString,
  IsUrl,
} from 'class-validator';
import { SUPPORTED_EVENTS, SupportedEvent } from '../constants/supported-events';

export class CreateWebhookDto {
  @ApiProperty({ description: 'Projeto dono do webhook', example: '100' })
  @IsNotEmpty()
  @IsNumberString({}, { message: 'projectId deve ser um numero inteiro' })
  projectId!: string;

  @ApiProperty({ description: 'URL de entrega HTTP/HTTPS', example: 'https://hooks.example.com/scrumban' })
  @IsString()
  @IsUrl({ require_protocol: true, protocols: ['http', 'https'] })
  url!: string;

  @ApiProperty({
    description: 'Eventos assinados por este webhook',
    enum: SUPPORTED_EVENTS,
    isArray: true,
    example: ['task.created'],
  })
  @IsArray()
  @ArrayMinSize(1)
  @IsIn(SUPPORTED_EVENTS, { each: true })
  events!: SupportedEvent[];
}


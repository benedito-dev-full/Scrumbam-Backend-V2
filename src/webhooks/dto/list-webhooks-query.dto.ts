import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNotEmpty, IsNumberString, IsOptional, Max, Min } from 'class-validator';

export class ListWebhooksQueryDto {
  @ApiProperty({ description: 'Projeto dono dos webhooks', example: '100' })
  @IsNotEmpty()
  @IsNumberString({}, { message: 'projectId deve ser um numero inteiro' })
  projectId!: string;

  @ApiPropertyOptional({ description: 'Cursor de paginacao', example: '200' })
  @IsOptional()
  @IsNumberString({}, { message: 'cursor deve ser um numero inteiro' })
  cursor?: string;

  @ApiPropertyOptional({ description: 'Itens por pagina', example: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number = 20;
}


import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsNumberString, IsOptional, Max, Min } from 'class-validator';

export class ListAttemptsQueryDto {
  @ApiPropertyOptional({ description: 'Cursor BigInt de DEvento.chave', example: '9001' })
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

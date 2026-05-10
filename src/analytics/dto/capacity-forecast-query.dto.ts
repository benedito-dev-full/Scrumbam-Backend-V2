import { Type } from 'class-transformer';
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

/**
 * DTO para forecast agregado de capacidade por organizacao.
 */
export class CapacityForecastQueryDto {
  /** Numero de sprints historicos por projeto. */
  @ApiPropertyOptional({ example: 4, default: 4, minimum: 1, maximum: 12 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(12)
  @Type(() => Number)
  historicalSprints?: number = 4;

  /** Iteracoes Monte Carlo por projeto. */
  @ApiPropertyOptional({ example: 10000, default: 10000, minimum: 100, maximum: 50000 })
  @IsOptional()
  @IsInt()
  @Min(100)
  @Max(50000)
  @Type(() => Number)
  iterations?: number = 10000;

  /** Limite de projetos processados em lote. */
  @ApiPropertyOptional({ example: 25, default: 25, minimum: 1, maximum: 100 })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  @Type(() => Number)
  limitProjects?: number = 25;
}

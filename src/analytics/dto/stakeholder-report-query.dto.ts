import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsOptional, IsString, Matches } from 'class-validator';

/**
 * DTO para relatorio narrativo deterministico de stakeholders.
 */
export class StakeholderReportQueryDto {
  /** Periodo pre-definido no timezone America/Sao_Paulo. */
  @ApiPropertyOptional({ enum: ['week', 'month'], example: 'month' })
  @IsOptional()
  @IsIn(['week', 'month'])
  period?: 'week' | 'month' = 'week';

  /** Data inicial customizada no formato YYYY-MM-DD. */
  @ApiPropertyOptional({ example: '2026-05-01' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'periodFrom deve estar no formato YYYY-MM-DD' })
  periodFrom?: string;

  /** Data final customizada no formato YYYY-MM-DD. */
  @ApiPropertyOptional({ example: '2026-05-10' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, { message: 'periodTo deve estar no formato YYYY-MM-DD' })
  periodTo?: string;
}

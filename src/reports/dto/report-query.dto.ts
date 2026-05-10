import { ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { Transform, Type } from 'class-transformer';

/**
 * DTO de query para geração de relatório PDF de projeto.
 *
 * Permite configurar o período de análise e as seções incluídas no relatório.
 * Todos os parâmetros são opcionais — o endpoint usa defaults sensatos.
 *
 * Validações:
 * - periodDays: inteiro entre 1 e 180 (default 30)
 * - periodFrom/periodTo: string ISO date (YYYY-MM-DD)
 * - includeTasks: boolean (default false)
 * - includeStakeholderSummary: boolean (default true)
 *
 * @example
 * ```typescript
 * const query: ReportQueryDto = {
 *   periodDays: 30,
 *   includeTasks: false,
 *   includeStakeholderSummary: true,
 * };
 * ```
 */
export class ReportQueryDto {
  /**
   * Número de dias retroativos para o período de análise.
   *
   * Ignorado quando periodFrom e periodTo são fornecidos.
   * Mínimo: 1 dia, Máximo: 180 dias, Default: 30 dias.
   */
  @ApiPropertyOptional({
    description: 'Número de dias retroativos para análise (1–180)',
    example: 30,
    minimum: 1,
    maximum: 180,
    default: 30,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(180)
  @Type(() => Number)
  periodDays?: number;

  /**
   * Data inicial do período (ISO date YYYY-MM-DD).
   *
   * Quando fornecido junto com periodTo, sobrescreve periodDays.
   */
  @ApiPropertyOptional({
    description: 'Data inicial do período (YYYY-MM-DD)',
    example: '2026-04-01',
  })
  @IsOptional()
  @IsString()
  periodFrom?: string;

  /**
   * Data final do período (ISO date YYYY-MM-DD).
   *
   * Quando fornecido junto com periodFrom, sobrescreve periodDays.
   */
  @ApiPropertyOptional({
    description: 'Data final do período (YYYY-MM-DD)',
    example: '2026-04-30',
  })
  @IsOptional()
  @IsString()
  periodTo?: string;

  /**
   * Inclui seção de tasks individuais no PDF.
   *
   * Pode aumentar significativamente o tamanho do PDF em projetos grandes.
   * Limitado a 200 tasks. Default: false.
   */
  @ApiPropertyOptional({
    description: 'Inclui lista de tasks no relatório (limitado a 200)',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  includeTasks?: boolean;

  /**
   * Inclui seção de resumo executivo/stakeholder no PDF.
   *
   * Usa AnalyticsService.stakeholderReport para gerar o resumo executivo.
   * Default: true.
   */
  @ApiPropertyOptional({
    description: 'Inclui resumo executivo stakeholder no relatório',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  @Transform(({ value }) => {
    if (value === 'true') return true;
    if (value === 'false') return false;
    return value;
  })
  includeStakeholderSummary?: boolean;
}

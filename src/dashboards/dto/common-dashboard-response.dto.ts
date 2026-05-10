import { ApiProperty } from '@nestjs/swagger';

/** Metadados do cache TTL aplicado ao endpoint. */
export class DashboardCacheMetaDto {
  /** Indica se a resposta veio de cache. */
  @ApiProperty({ example: false })
  hit!: boolean;

  /** TTL configurado para a rota, em segundos. */
  @ApiProperty({ example: 60 })
  ttlSeconds!: number;
}

/** Periodo resolvido para a consulta. */
export class DashboardPeriodDto {
  /** Inicio do periodo em ISO 8601. */
  @ApiProperty({ example: '2026-05-01T03:00:00.000Z' })
  from!: string;

  /** Fim do periodo em ISO 8601. */
  @ApiProperty({ example: '2026-06-01T02:59:59.999Z' })
  to!: string;
}

import { Type } from 'class-transformer';
import { IsBooleanString, IsInt, IsNumberString, IsOptional, Max, Min } from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Query params para listagem de notificacoes in-app.
 *
 * Usado por `GET /notifications` para cursor pagination sobre `DEvento -490`.
 * `unreadOnly` chega como boolean string porque e query param HTTP.
 *
 * @example
 * ```typescript
 * const query: ListNotificationsQueryDto = {
 *   unreadOnly: 'true',
 *   cursor: '1001',
 *   limit: 20,
 * };
 * ```
 */
export class ListNotificationsQueryDto {
  /**
   * Quando `true`, retorna apenas notificacoes sem leitura confirmada.
   */
  @ApiPropertyOptional({ example: 'false', description: 'Filtra apenas notificacoes nao lidas' })
  @IsOptional()
  @IsBooleanString()
  unreadOnly?: string;

  /**
   * Cursor BigInt serializado como string.
   *
   * A listagem retorna registros com `DEvento.chave` menor que este valor.
   */
  @ApiPropertyOptional({ example: '1001', description: 'Cursor BigInt; retorna chave menor que o cursor' })
  @IsOptional()
  @IsNumberString()
  cursor?: string;

  /**
   * Quantidade maxima de itens retornados.
   *
   * Minimo 1, maximo 100, default aplicado no service quando ausente.
   */
  @ApiPropertyOptional({ example: 20, minimum: 1, maximum: 100, default: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

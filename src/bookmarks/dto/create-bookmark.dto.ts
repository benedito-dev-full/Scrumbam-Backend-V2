import { IsIn, IsNumberString, IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * Tipos de entidade que podem ser favoritados.
 *
 * Espelha os tipos navegaveis do Scrumban hierarquico (ADR-V2-051).
 */
export const TARGET_TYPES = ['space', 'folder', 'list', 'doc', 'team'] as const;

/** Union type dos tipos de alvo validos. */
export type TargetType = (typeof TARGET_TYPES)[number];

/**
 * DTO de criacao de bookmark/favorito.
 *
 * O `targetId` e a chave BigInt serializada como string da entidade a favoritar.
 * O par `(targetId, targetType)` e verificado no service para deduplicacao logica.
 *
 * @example
 * ```json
 * { "targetId": "350", "targetType": "space" }
 * ```
 */
export class CreateBookmarkDto {
  /**
   * ID da entidade a favoritar (BigInt serializado como string).
   *
   * Deve ser um numero inteiro valido convertivel para BigInt.
   * Valores nao numericos (ex: "abc") sao rejeitados com 400.
   */
  @ApiProperty({
    description: 'ID da entidade a favoritar (BigInt serializado como string)',
    example: '350',
  })
  @IsNumberString({}, { message: 'targetId deve ser um número inteiro válido' })
  targetId!: string;

  /**
   * Tipo da entidade a favoritar.
   *
   * Usado como discriminador no metaDados da DVincula.
   */
  @ApiProperty({
    description: 'Tipo da entidade a favoritar',
    enum: TARGET_TYPES,
    example: 'space',
  })
  @IsString()
  @IsIn(TARGET_TYPES)
  targetType!: TargetType;
}

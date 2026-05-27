import { ApiProperty } from '@nestjs/swagger';
import { IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DTO para criação de comentário polimórfico.
 *
 * `targetType` e `targetId` vêm da rota (`@Param`), não do body —
 * só o texto trafega aqui.
 *
 * Validações:
 * - texto: string entre 1 e 10000 caracteres (markdown aceito).
 *
 * @example
 * ```typescript
 * const dto: CreateCommentDto = {
 *   texto: 'Reviewei e está OK, pode mergear.'
 * };
 * ```
 */
export class CreateCommentDto {
  /**
   * Conteúdo textual do comentário.
   *
   * Suporta markdown — o backend persiste o texto cru em `DEvento.descricao`.
   * Limite de 10000 caracteres protege contra payloads abusivos.
   */
  @ApiProperty({
    description: 'Conteúdo do comentário (markdown aceito, 1–10000 chars)',
    example: 'Reviewei e está OK, pode mergear.',
    minLength: 1,
    maxLength: 10000,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(10000)
  texto!: string;
}

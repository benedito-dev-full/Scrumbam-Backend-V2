import { IsString } from 'class-validator';
import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO para mover task para sprint (PUT /tasks/:id/sprint).
 *
 * @example
 * ```typescript
 * const dto: UpdateTaskSprintDto = { sprintId: '1' };
 * ```
 */
export class UpdateTaskSprintDto {
  @ApiProperty({
    description: 'ID do sprint de destino (chave DTabela -400)',
    example: '1',
  })
  @IsString()
  sprintId!: string;
}

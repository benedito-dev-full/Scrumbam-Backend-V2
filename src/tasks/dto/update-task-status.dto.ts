import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para mover task entre estados V3 (PUT /tasks/:id/status).
 *
 * A state machine valida a transição. Veja tasks-state-machine.ts.
 *
 * @example
 * ```typescript
 * const dto: UpdateTaskStatusDto = {
 *   status: 'READY',
 *   movedBy: 'user-100',
 * };
 * ```
 */
export class UpdateTaskStatusDto {
  @ApiProperty({
    description: 'Novo estado V3 da task',
    enum: ['INBOX', 'READY', 'EXECUTING', 'DONE', 'FAILED', 'CANCELLED', 'DISCARDED', 'VALIDATING', 'VALIDATED'],
    example: 'READY',
  })
  @IsEnum(['INBOX', 'READY', 'EXECUTING', 'DONE', 'FAILED', 'CANCELLED', 'DISCARDED', 'VALIDATING', 'VALIDATED'])
  status!: string;

  @ApiPropertyOptional({
    description: 'ID do usuário que moveu o status (para telemetria)',
    example: '100',
  })
  @IsOptional()
  @IsString()
  movedBy?: string;
}

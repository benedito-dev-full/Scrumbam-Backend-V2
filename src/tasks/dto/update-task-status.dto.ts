import { IsEnum, IsOptional, IsString } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { V3_STATUS_CODES } from '../constants/task-status.const';

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
    description: 'Novo estado V3 da task (5 canônicos — fonte única: V3_STATUS_CODES)',
    enum: V3_STATUS_CODES,
    example: 'READY',
  })
  @IsEnum(V3_STATUS_CODES)
  status!: string;

  @ApiPropertyOptional({
    description: 'ID do usuário que moveu o status (para telemetria)',
    example: '100',
  })
  @IsOptional()
  @IsString()
  movedBy?: string;
}

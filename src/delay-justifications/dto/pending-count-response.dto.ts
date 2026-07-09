import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response DTO do badge de pendências de justificativa do PRÓPRIO usuário.
 *
 * Retorno de `GET /me/delay-justifications/pending-count`. `pendingCount` é o
 * número de tarefas do usuário (assignee) que estão atrasadas — em aberto OU
 * concluídas com atraso — e que AINDA não têm justificativa vigente (DEvento
 * -503 `excluido=false`). Escopo global por padrão; `projectId` recorta.
 *
 * @example
 * ```json
 * { "pendingCount": 3, "projectId": null }
 * ```
 */
export class PendingCountResponseDto {
  /** Nº de tarefas atrasadas do usuário sem justificativa vigente. */
  @ApiProperty({ description: 'Atrasos sem justificativa do próprio usuário', example: 3 })
  pendingCount!: number;

  /** Projeto ao qual a contagem foi restrita, ou null se global. */
  @ApiPropertyOptional({
    description: 'Projeto do recorte (null = global)',
    example: '10',
    nullable: true,
  })
  projectId?: string | null;
}

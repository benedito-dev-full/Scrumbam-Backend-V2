import { ApiProperty } from '@nestjs/swagger';

/**
 * DTO de resposta do soft-delete de projeto.
 *
 * Retornado por `DELETE /projects/:id` com `200 OK` (não `204`) para que o
 * frontend possa exibir contadores do cascade ao usuário.
 *
 * @example
 * ```json
 * {
 *   "deleted": true,
 *   "id": "9",
 *   "projectName": "Scrumban V2",
 *   "counts": { "tasks": 12, "members": 3, "webhooks": 0, "notifications": 0 }
 * }
 * ```
 */
export class DeleteProjectCountsDto {
  @ApiProperty({ description: 'Tasks soft-deletadas no cascade', example: 12 })
  tasks!: number;

  @ApiProperty({ description: 'Vínculos de membros soft-deletados', example: 3 })
  members!: number;

  @ApiProperty({ description: 'Webhooks soft-deletados (reservado)', example: 0 })
  webhooks!: number;

  @ApiProperty({ description: 'Notificações soft-deletadas (reservado)', example: 0 })
  notifications!: number;
}

export class DeleteProjectResponseDto {
  @ApiProperty({ description: 'Indica que o projeto foi soft-deletado', example: true })
  deleted!: boolean;

  @ApiProperty({ description: 'ID do projeto deletado', example: '9' })
  id!: string;

  @ApiProperty({ description: 'Nome do projeto no momento da exclusão', example: 'Scrumban V2' })
  projectName!: string;

  @ApiProperty({ description: 'Contadores dos registros impactados pelo cascade' })
  counts!: DeleteProjectCountsDto;
}

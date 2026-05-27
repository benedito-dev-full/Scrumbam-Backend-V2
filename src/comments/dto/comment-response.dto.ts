import { ApiProperty } from '@nestjs/swagger';
import { CommentTargetType } from './comment-target-type.enum';

/**
 * Response DTO de um comentário individual.
 *
 * Mapeia de `DEvento` (idClasse=-507) + join com `DEntidade` (autor):
 * - `id` ← `DEvento.chave.toString()`
 * - `texto` ← `DEvento.descricao`
 * - `targetType` ← `DEvento.metaDados.targetType`
 * - `targetId` ← `DEvento.identificadorExterno`
 * - `autorId` ← `DEvento.idEntidade.toString()`
 * - `autorNome` ← `DEntidade.nome` (join, zero N+1)
 * - `createdAt` ← `DEvento.criadoEm.toISOString()`
 *
 * @example
 * ```json
 * {
 *   "id": "12345",
 *   "texto": "Aprovei e mergei",
 *   "targetType": "task",
 *   "targetId": "777",
 *   "autorId": "42",
 *   "autorNome": "Joao Silva",
 *   "createdAt": "2026-05-27T18:30:00.000Z"
 * }
 * ```
 */
export class CommentResponseDto {
  @ApiProperty({ description: 'ID do comentário (DEvento.chave)', example: '12345' })
  id!: string;

  @ApiProperty({
    description: 'Conteúdo textual do comentário',
    example: 'Aprovei e mergei',
  })
  texto!: string;

  @ApiProperty({
    description: 'Tipo do alvo do comentário',
    enum: CommentTargetType,
    example: CommentTargetType.TASK,
  })
  targetType!: CommentTargetType;

  @ApiProperty({ description: 'ID do alvo (task/project/folder/list)', example: '777' })
  targetId!: string;

  @ApiProperty({ description: 'ID da entidade autora (DEntidade.chave)', example: '42' })
  autorId!: string;

  @ApiProperty({ description: 'Nome do autor (DEntidade.nome)', example: 'Joao Silva' })
  autorNome!: string;

  @ApiProperty({
    description: 'Timestamp ISO 8601 de criação',
    example: '2026-05-27T18:30:00.000Z',
  })
  createdAt!: string;
}

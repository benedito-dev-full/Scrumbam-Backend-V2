import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTO para Folder (DEntidade idClasse=-155).
 *
 * @example
 * ```json
 * {
 *   "id": "500",
 *   "nome": "Cliente Acme",
 *   "organizationId": "100",
 *   "projectCount": 3,
 *   "criadoEm": "2026-05-18T00:00:00.000Z",
 *   "atualizadoEm": "2026-05-18T00:00:00.000Z"
 * }
 * ```
 *
 * @see ADR-V2-FOLDERS-001
 */
export class FolderResponseDto {
  @ApiProperty({ description: 'ID da pasta (DEntidade.chave)', example: '500' })
  id!: string;

  @ApiProperty({ description: 'Nome da pasta', example: 'Cliente Acme' })
  nome!: string;

  @ApiProperty({ description: 'ID da organização dona', example: '100' })
  organizationId!: string;

  @ApiProperty({
    description: 'Quantidade de projects ativos vinculados via DVincula -183',
    example: 3,
  })
  projectCount!: number;

  @ApiProperty({ description: 'Data de criação ISO 8601', example: '2026-05-18T00:00:00.000Z' })
  criadoEm!: string;

  @ApiProperty({ description: 'Data de atualização ISO 8601', example: '2026-05-18T00:00:00.000Z' })
  atualizadoEm!: string;
}

/**
 * Response DTO para lista de pastas de uma organização.
 *
 * Ordenadas alfabeticamente por `nome` (CEO Q3 — sem ordem manual no MVP).
 */
export class ListFolderResponseDto {
  @ApiProperty({ type: [FolderResponseDto] })
  items!: FolderResponseDto[];
}

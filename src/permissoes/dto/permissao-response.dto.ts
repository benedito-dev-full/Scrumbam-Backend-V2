import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO de resposta para DPermissao.
 *
 * IDs serializados como string (BigInt).
 */
export class PermissaoResponseDto {
  @ApiProperty({ description: 'ID da permissão', example: '1' })
  chave!: string;

  @ApiProperty({ description: 'ID do DUserGroup', example: '1' })
  dUserGroupId!: string;

  @ApiProperty({ description: 'Recurso protegido', example: '/api/v1/projects' })
  recurso!: string;

  @ApiProperty({ description: 'Ação', example: 'DELETE' })
  acao!: string;

  @ApiProperty({ description: 'Permitido?', example: true })
  permitido!: boolean;

  @ApiPropertyOptional({ description: 'Metadados', nullable: true })
  metaDados?: Record<string, unknown> | null;

  @ApiProperty({ description: 'Data de criação' })
  criadoEm!: Date;
}

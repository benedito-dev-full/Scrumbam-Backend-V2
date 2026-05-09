import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO de membro da organização (para respostas de membership).
 */
export class OrgMemberDto {
  /**
   * ID da DEntidade do usuário.
   */
  @ApiProperty({ description: 'ID da DEntidade do usuário', example: '12345' })
  userId!: string;

  /**
   * Nome do usuário.
   */
  @ApiProperty({ description: 'Nome do usuário', example: 'João Silva' })
  nome!: string;

  /**
   * Email do usuário.
   */
  @ApiPropertyOptional({ description: 'Email do usuário', example: 'joao@acme.com' })
  email?: string | null;

  /**
   * Role na organização.
   */
  @ApiProperty({ description: 'Role na organização', example: 'ADMIN', enum: ['ADMIN', 'MEMBER', 'VIEWER'] })
  role!: string;

  /**
   * idClasse do DVincula correspondente.
   */
  @ApiProperty({ description: 'idClasse do DVincula de role', example: '-161' })
  idClasse!: string;
}

/**
 * Response DTO para organização (GET /organizations/:id, POST /organizations).
 *
 * Serializa DEntidade -152 (ORGANIZATION) com memberCount.
 *
 * @example
 * ```json
 * {
 *   "id": "100",
 *   "nome": "Acme Corp",
 *   "description": null,
 *   "memberCount": 3,
 *   "criadoEm": "2026-05-09T00:00:00.000Z"
 * }
 * ```
 */
export class OrganizationResponseDto {
  /**
   * ID da organização (chave BigInt serializada como string).
   */
  @ApiProperty({ description: 'ID da organização', example: '100' })
  id!: string;

  /**
   * Nome da organização.
   */
  @ApiProperty({ description: 'Nome da organização', example: 'Acme Corp' })
  nome!: string;

  /**
   * Descrição da organização (campo `dados.description`).
   */
  @ApiPropertyOptional({ description: 'Descrição da organização', nullable: true })
  description?: string | null;

  /**
   * Número de membros ativos na organização.
   */
  @ApiProperty({ description: 'Número de membros', example: 3 })
  memberCount!: number;

  /**
   * Data de criação (ISO 8601).
   */
  @ApiProperty({ description: 'Data de criação', example: '2026-05-09T00:00:00.000Z' })
  criadoEm!: string;

  /**
   * Data de atualização (ISO 8601).
   */
  @ApiProperty({ description: 'Data de atualização', example: '2026-05-09T00:00:00.000Z' })
  atualizadoEm!: string;
}

/**
 * Response DTO para listagem de organizações.
 */
export class ListOrganizationResponseDto {
  @ApiProperty({ type: [OrganizationResponseDto] })
  items!: OrganizationResponseDto[];

  @ApiProperty({ description: 'Paginação por cursor' })
  pagination!: {
    hasMore: boolean;
    nextCursor: string | null;
  };
}

/**
 * Response DTO para listagem de membros de organização.
 */
export class ListOrgMembersResponseDto {
  @ApiProperty({ type: [OrgMemberDto] })
  members!: OrgMemberDto[];
}

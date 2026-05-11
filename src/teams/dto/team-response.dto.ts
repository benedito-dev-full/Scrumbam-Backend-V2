import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Membro de time para respostas.
 */
export class TeamMemberDto {
  @ApiProperty({ description: 'ID da DEntidade do usuário', example: '12345' })
  userId!: string;

  @ApiProperty({ description: 'Nome do usuário', example: 'João Silva' })
  nome!: string;

  @ApiPropertyOptional({ description: 'Email do usuário', nullable: true })
  email?: string | null;

  @ApiProperty({ description: 'Cargo no time', example: 'LEAD', enum: ['LEAD', 'MEMBER'] })
  cargo!: string;
}

/**
 * Response DTO para time (DEntidade idClasse=-180).
 *
 * @example
 * ```json
 * {
 *   "id": "200",
 *   "nome": "Backend Team",
 *   "orgId": "100",
 *   "prefix": "BACK",
 *   "memberCount": 2,
 *   "criadoEm": "2026-05-09T00:00:00.000Z"
 * }
 * ```
 */
export class TeamResponseDto {
  @ApiProperty({ description: 'ID do time', example: '200' })
  id!: string;

  @ApiProperty({ description: 'Nome do time', example: 'Backend Team' })
  nome!: string;

  @ApiProperty({ description: 'ID da organização pai', example: '100' })
  orgId!: string;

  @ApiProperty({ description: 'Prefixo do issue counter', example: 'BACK' })
  prefix!: string;

  @ApiPropertyOptional({ description: 'Descrição do time', nullable: true })
  description?: string | null;

  /**
   * Cor hex do time (`#RRGGBB`) ou `null` se não configurada.
   * Persistida em `DEntidade.dados.color`.
   */
  @ApiPropertyOptional({
    description: 'Cor hex do time (#RRGGBB)',
    example: '#3B82F6',
    nullable: true,
  })
  color?: string | null;

  /**
   * Nome de ícone Lucide ou `null`.
   * Persistido em `DEntidade.dados.icon`.
   */
  @ApiPropertyOptional({
    description: 'Nome de ícone Lucide',
    example: 'rocket',
    nullable: true,
  })
  icon?: string | null;

  @ApiProperty({ description: 'Número de membros', example: 2 })
  memberCount!: number;

  @ApiProperty({ description: 'Data de criação', example: '2026-05-09T00:00:00.000Z' })
  criadoEm!: string;

  @ApiProperty({ description: 'Data de atualização', example: '2026-05-09T00:00:00.000Z' })
  atualizadoEm!: string;

  /**
   * Indica se o usuário autenticado pode editar este time.
   *
   * Verdadeiro quando o usuário é LEAD do time ou ADMIN da organização pai.
   * Calculado pelo backend; o frontend usa para mostrar/esconder ações de edição.
   */
  @ApiProperty({
    description: 'Se o usuário autenticado pode editar este time',
    example: true,
  })
  canEdit!: boolean;

  /**
   * Indica se o usuário autenticado pode deletar este time.
   *
   * Mesma regra de canEdit (LEAD do time ou ADMIN da organização).
   * Mantido como campo separado para flexibilidade futura de RBAC.
   */
  @ApiProperty({
    description: 'Se o usuário autenticado pode deletar este time',
    example: true,
  })
  canDelete!: boolean;
}

/**
 * Response DTO para listagem de times.
 */
export class ListTeamResponseDto {
  @ApiProperty({ type: [TeamResponseDto] })
  items!: TeamResponseDto[];

  @ApiProperty({ description: 'Paginação por cursor' })
  pagination!: {
    hasMore: boolean;
    nextCursor: string | null;
  };
}

/**
 * Response DTO para listagem de membros de time.
 */
export class ListTeamMembersResponseDto {
  @ApiProperty({ type: [TeamMemberDto] })
  members!: TeamMemberDto[];
}

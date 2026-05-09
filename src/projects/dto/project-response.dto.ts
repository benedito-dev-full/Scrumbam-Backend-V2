import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO de resposta de projeto.
 *
 * Retornado em todas as operações de projeto (create, findOne, update).
 *
 * @example
 * ```json
 * {
 *   "id": "1",
 *   "nome": "Scrumban V2",
 *   "prefix": "DEV",
 *   "description": null,
 *   "orgId": "100",
 *   "memberCount": 1,
 *   "automationEnabled": false,
 *   "gitRepo": null,
 *   "criadoEm": "2026-05-09T00:00:00.000Z",
 *   "atualizadoEm": "2026-05-09T00:00:00.000Z"
 * }
 * ```
 */
export class ProjectResponseDto {
  @ApiProperty({ description: 'ID do projeto', example: '1' })
  id!: string;

  @ApiProperty({ description: 'Nome do projeto', example: 'Scrumban V2' })
  nome!: string;

  @ApiPropertyOptional({ description: 'Prefixo dos identifiers', example: 'DEV', nullable: true })
  prefix!: string | null;

  @ApiPropertyOptional({ description: 'Descrição do projeto', nullable: true })
  description!: string | null;

  @ApiPropertyOptional({ description: 'ID da organização pai', example: '100', nullable: true })
  orgId!: string | null;

  @ApiProperty({ description: 'Número de membros', example: 1 })
  memberCount!: number;

  @ApiProperty({ description: 'Automação Claude Code habilitada', example: false })
  automationEnabled!: boolean;

  @ApiPropertyOptional({ description: 'URL do repositório git', nullable: true })
  gitRepo!: string | null;

  @ApiProperty({ description: 'Data de criação ISO 8601', example: '2026-05-09T00:00:00.000Z' })
  criadoEm!: string;

  @ApiProperty({ description: 'Data de atualização ISO 8601', example: '2026-05-09T00:00:00.000Z' })
  atualizadoEm!: string;
}

/**
 * DTO de lista paginada de projetos.
 */
export class ListProjectResponseDto {
  @ApiProperty({ type: [ProjectResponseDto] })
  items!: ProjectResponseDto[];

  @ApiProperty({ description: 'Metadados de paginação' })
  pagination!: {
    hasMore: boolean;
    nextCursor: string | null;
  };
}

/**
 * DTO de atividade do projeto (DEvento).
 */
export class ProjectActivityDto {
  @ApiProperty({ description: 'ID do evento', example: '1' })
  id!: string;

  @ApiProperty({ description: 'Tipo/descrição do evento', example: 'task.created' })
  tipo!: string;

  @ApiPropertyOptional({ description: 'Metadados do evento', nullable: true })
  metaDados!: Record<string, unknown> | null;

  @ApiProperty({ description: 'Data do evento ISO 8601' })
  criadoEm!: string;
}

/**
 * DTO de lista paginada de atividades.
 */
export class ListProjectActivityResponseDto {
  @ApiProperty({ type: [ProjectActivityDto] })
  items!: ProjectActivityDto[];

  @ApiProperty()
  pagination!: {
    hasMore: boolean;
    nextCursor: string | null;
  };
}

/**
 * DTO de stats do projeto (contadores por status V3).
 */
export class ProjectStatsDto {
  @ApiProperty({ description: 'Contadores por status V3' })
  statusCounts!: Record<string, number>;

  @ApiProperty({ description: 'Total de tasks', example: 42 })
  totalTasks!: number;
}

/**
 * DTO de membro do projeto.
 */
export class ProjectMemberDto {
  @ApiProperty({ description: 'ID da DEntidade do membro', example: '200' })
  userId!: string;

  @ApiProperty({ description: 'Nome do membro', example: 'Benedito' })
  nome!: string;

  @ApiPropertyOptional({ description: 'Email do membro', nullable: true })
  email!: string | null;

  @ApiProperty({ description: 'Role no projeto', enum: ['MANAGER', 'MEMBER', 'VIEWER'] })
  role!: string;

  @ApiPropertyOptional({ description: 'Cargo customizado', nullable: true })
  cargo!: string | null;
}

/**
 * DTO de lista de membros do projeto.
 */
export class ListProjectMembersResponseDto {
  @ApiProperty({ type: [ProjectMemberDto] })
  members!: ProjectMemberDto[];
}

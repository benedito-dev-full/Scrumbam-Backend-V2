import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TableFieldsDto } from '../../tasks/table-fields/column-def.dto';

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
 *   "repoUrl": null,
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

  /**
   * Tipo do projeto (ADR-V2-051 hierarquia Space/Folder/List).
   *
   * Valores canônicos: -350=SPACE, -351=FOLDER, -352=LIST, -353=DOC.
   * Serializado como string (BigInt).
   */
  @ApiProperty({
    description:
      'idClasse do DProject (tipo hierárquico). -350=SPACE, -351=FOLDER, -352=LIST, -353=DOC.',
    example: '-350',
  })
  idClasse!: string;

  /**
   * ID do DProject pai na hierarquia (ADR-V2-051).
   *
   * `null` para SPACEs (raiz). Presente para FOLDERs (pai=SPACE) e
   * LISTs/DOCs (pai=FOLDER).
   */
  @ApiPropertyOptional({
    description: 'ID do DProject pai na hierarquia ou null para raízes (SPACEs).',
    example: '100',
    nullable: true,
  })
  idPai!: string | null;

  @ApiPropertyOptional({ description: 'Prefixo dos identifiers', example: 'DEV', nullable: true })
  prefix!: string | null;

  @ApiPropertyOptional({ description: 'Descrição do projeto', nullable: true })
  description!: string | null;

  @ApiPropertyOptional({ description: 'ID da organização pai', example: '100', nullable: true })
  orgId!: string | null;

  @ApiProperty({ description: 'Número de membros', example: 1 })
  memberCount!: number;

  /**
   * Progresso da Lista — tarefas concluídas (DONE + VALIDATED) sobre o total.
   *
   * Preenchido apenas na listagem (`GET /projects`). Para SPACE/FOLDER fica 0
   * (tarefas vinculam-se a Lists). Ausente em respostas de item único.
   */
  @ApiPropertyOptional({
    description: 'Tarefas concluídas (DONE+VALIDATED) da Lista. Presente apenas na listagem.',
    example: 5,
  })
  doneCount?: number;

  @ApiPropertyOptional({
    description: 'Total de tarefas da Lista. Presente apenas na listagem.',
    example: 12,
  })
  totalCount?: number;

  @ApiPropertyOptional({
    description: 'URL canônica do repositório git (DProject.repoUrl — ADR-V2-043)',
    nullable: true,
  })
  repoUrl!: string | null;

  /**
   * ID do time ao qual o projeto está vinculado (DVincula -182).
   *
   * `null` quando o projeto é órfão (sem vínculo ativo de time).
   * Backend SEMPRE retorna `string | null` — nunca `undefined`.
   *
   * @see ADR-V2-029
   */
  @ApiPropertyOptional({
    description: 'ID do time vinculado (DVincula -182) ou null se órfão',
    example: '200',
    nullable: true,
  })
  teamId!: string | null;

  /**
   * ID da pasta (folder) à qual o projeto está vinculado (DVincula -183).
   *
   * `null` quando o projeto está no "limbo" (sem pasta — visualização
   * `/workspace` mostra como "Sem pasta"). Backend SEMPRE retorna
   * `string | null` — nunca `undefined`.
   *
   * @see ADR-V2-FOLDERS-001
   */
  @ApiPropertyOptional({
    description: 'ID da pasta vinculada (DVincula -183) ou null se em limbo',
    example: '500',
    nullable: true,
  })
  folderId!: string | null;

  /**
   * Visibilidade do projeto (ADR-V2-051 §8).
   *
   * `true` = privado (visível apenas a membros DVincula -188).
   * `false` = público na org (padrão).
   */
  @ApiProperty({
    description: 'Projeto privado (true) ou público na org (false)',
    example: false,
  })
  privado!: boolean;

  @ApiPropertyOptional({
    description: 'Cor hex do espaço (#RRGGBB). Lida de dados.color.',
    example: '#3b82f6',
    nullable: true,
  })
  color?: string | null;

  @ApiPropertyOptional({
    description: 'Ícone do espaço (emoji ou slug). Lido de dados.icon.',
    example: '🚀',
    nullable: true,
  })
  icon?: string | null;

  /**
   * Schema versionado das colunas customizaveis da Lista.
   *
   * Lido da coluna dedicada `DProject.tableFields`, nao de `dados`. Para
   * projetos sem schema ou para tipos que nao sejam Lista, retorna `null`.
   */
  @ApiPropertyOptional({
    description:
      'Schema versionado das colunas customizaveis da Lista, lido de DProject.tableFields.',
    type: () => TableFieldsDto,
    nullable: true,
  })
  tableFields!: TableFieldsDto | null;

  /**
   * Papel do usuário autenticado NESTE projeto (Space/Folder/List).
   *
   * Resolvido via RoleResolverService.getProjectRole — já considera a herança
   * ORG_ADMIN→MANAGER (decisão CEO 2026-06-02) e o acesso herdado de espaço
   * público (membro da org → MEMBER). `null` apenas em casos-limite (caller
   * sem usuário). Existe para o front decidir o que habilitar SEM ter que
   * tentar a ação e tomar 403 (espelha `myCargo` do TeamResponseDto).
   */
  @ApiProperty({
    description: 'Papel do usuário autenticado neste projeto',
    enum: ['MANAGER', 'MEMBER', 'VIEWER'],
    nullable: true,
    example: 'MANAGER',
  })
  myRole!: 'MANAGER' | 'MEMBER' | 'VIEWER' | null;

  /**
   * Atalho de UX: `true` quando o usuário pode executar operações estruturais
   * do projeto (renomear, mover, mudar privacidade, deletar, gerir membros).
   *
   * Equivale a `myRole === 'MANAGER'` — é o que os guards `requireManagerRole`
   * exigem no backend. O front liga/desliga botões por este campo.
   */
  @ApiProperty({
    description: 'Pode executar operações estruturais (renomear, deletar, gerir membros)',
    example: true,
  })
  canManage!: boolean;

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

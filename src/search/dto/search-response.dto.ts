import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Resultado de busca de uma task (DTask).
 *
 * chave serializado como string (BigInt → ADR-V2-025).
 * descricao truncada em 150 chars para evitar payloads grandes.
 */
export class TaskSearchResultDto {
  /**
   * Chave primária da DTask (BigInt serializado como string).
   */
  @ApiProperty({ description: 'ID da task', example: '523' })
  chave!: string;

  /**
   * Nome completo da task.
   */
  @ApiProperty({ description: 'Nome da task', example: 'Implementar login OAuth' })
  nome!: string;

  /**
   * Descrição truncada (máx 150 chars) ou null.
   */
  @ApiPropertyOptional({
    description: 'Descrição truncada da task (máx 150 chars)',
    example: 'Adicionar suporte a OAuth 2.0 com Google...',
    nullable: true,
  })
  descricao!: string | null;

  /**
   * ID do projeto pai (BigInt serializado como string).
   */
  @ApiPropertyOptional({
    description: 'ID do projeto ao qual a task pertence',
    example: '42',
    nullable: true,
  })
  idProject!: string | null;

  /**
   * Nome do projeto pai (para exibição).
   */
  @ApiPropertyOptional({
    description: 'Nome do projeto pai',
    example: 'Backend V2',
    nullable: true,
  })
  projectNome!: string | null;

  /**
   * ID do status atual da task (BigInt serializado como string).
   */
  @ApiPropertyOptional({
    description: 'ID do status atual',
    example: '441',
    nullable: true,
  })
  idStatus!: string | null;

  /**
   * Data de criação da task (ISO 8601).
   */
  @ApiProperty({ description: 'Data de criação', example: '2026-05-01T10:00:00Z' })
  criadoEm!: string;
}

/**
 * Resultado de busca de um projeto (DProject).
 *
 * chave serializado como string (BigInt → ADR-V2-025).
 * descricao truncada em 150 chars.
 */
export class ProjectSearchResultDto {
  /**
   * Chave primária do DProject (BigInt serializado como string).
   */
  @ApiProperty({ description: 'ID do projeto', example: '42' })
  chave!: string;

  /**
   * Nome completo do projeto.
   */
  @ApiProperty({ description: 'Nome do projeto', example: 'Scrumban Backend V2' })
  nome!: string;

  /**
   * Descrição truncada (máx 150 chars) ou null.
   */
  @ApiPropertyOptional({
    description: 'Descrição truncada do projeto (máx 150 chars)',
    example: 'Refundação canônica do Scrumban...',
    nullable: true,
  })
  descricao!: string | null;

  /**
   * Data de criação do projeto (ISO 8601).
   */
  @ApiProperty({ description: 'Data de criação', example: '2026-04-01T08:00:00Z' })
  criadoEm!: string;
}

/**
 * Resultado de busca de uma pessoa (DEntidade idClasse=-150 USER).
 *
 * chave serializado como string (BigInt → ADR-V2-025).
 */
export class PersonSearchResultDto {
  /**
   * Chave primária da DEntidade USER (BigInt serializado como string).
   */
  @ApiProperty({ description: 'ID da pessoa', example: '15' })
  chave!: string;

  /**
   * Nome completo do usuário.
   */
  @ApiProperty({ description: 'Nome do usuário', example: 'João Silva' })
  nome!: string;

  /**
   * Email do usuário (pode ser null se não preenchido).
   */
  @ApiPropertyOptional({
    description: 'Email do usuário',
    example: 'joao@example.com',
    nullable: true,
  })
  email!: string | null;

  /**
   * Data de criação da entidade (ISO 8601).
   */
  @ApiProperty({ description: 'Data de criação', example: '2026-03-15T12:00:00Z' })
  criadoEm!: string;
}

/**
 * Cursors de paginação por categoria de resultado (DA-2).
 *
 * Cada cursor é o chave.toString() do último item da categoria, ou null
 * se não há mais resultados. Passar o cursor na próxima request para
 * continuar de onde parou.
 */
export class SearchCursorsDto {
  /**
   * Cursor para próxima página de tasks (null = fim da lista).
   */
  @ApiPropertyOptional({
    description: 'Cursor para próxima página de tasks (null = sem mais resultados)',
    example: '523',
    nullable: true,
  })
  task!: string | null;

  /**
   * Cursor para próxima página de projetos (null = fim da lista).
   */
  @ApiPropertyOptional({
    description: 'Cursor para próxima página de projetos (null = sem mais resultados)',
    example: '41',
    nullable: true,
  })
  project!: string | null;

  /**
   * Cursor para próxima página de pessoas (null = fim da lista).
   */
  @ApiPropertyOptional({
    description: 'Cursor para próxima página de pessoas (null = sem mais resultados)',
    example: '15',
    nullable: true,
  })
  person!: string | null;
}

/**
 * Metadados da busca (echo de parâmetros usados).
 */
export class SearchMetaDto {
  /**
   * Termo de busca utilizado.
   */
  @ApiProperty({ description: 'Termo de busca utilizado', example: 'login' })
  q!: string;

  /**
   * Limite usado nesta request.
   */
  @ApiProperty({ description: 'Limite total utilizado', example: 20 })
  limit!: number;

  /**
   * ID da organização que forneceu o tenant isolation.
   */
  @ApiProperty({ description: 'ID da organização do usuário autenticado', example: '100' })
  organizationId!: string;
}

/**
 * Response completo do endpoint GET /search.
 *
 * Retorna resultados de 3 categorias em paralelo (DTask + DProject + DEntidade USER)
 * com cursors independentes por categoria (DA-2) e distribuição fixa de limite (DA-4).
 *
 * Estrutura:
 * - tasks: resultados de DTask (máx ceil(limit*0.5))
 * - projects: resultados de DProject (máx ceil(limit*0.3))
 * - people: resultados de DEntidade USER -150 (máx ceil(limit*0.2))
 * - cursors: { task, project, person } — null quando não há mais resultados
 * - meta: { q, limit, organizationId }
 *
 * @example
 * ```json
 * {
 *   "tasks": [
 *     {
 *       "chave": "523",
 *       "nome": "Implementar login OAuth",
 *       "descricao": "Adicionar suporte a OAuth 2.0...",
 *       "idProject": "42",
 *       "projectNome": "Backend V2",
 *       "idStatus": "441",
 *       "criadoEm": "2026-05-01T10:00:00Z"
 *     }
 *   ],
 *   "projects": [],
 *   "people": [],
 *   "cursors": { "task": "523", "project": null, "person": null },
 *   "meta": { "q": "login", "limit": 20, "organizationId": "100" }
 * }
 * ```
 */
export class SearchResponseDto {
  /**
   * Lista de tasks encontradas (máx ceil(limit * 0.5)).
   */
  @ApiProperty({
    description: 'Tasks encontradas (máx ceil(limit*0.5))',
    type: [TaskSearchResultDto],
  })
  tasks!: TaskSearchResultDto[];

  /**
   * Lista de projetos encontrados (máx ceil(limit * 0.3)).
   */
  @ApiProperty({
    description: 'Projetos encontrados (máx ceil(limit*0.3))',
    type: [ProjectSearchResultDto],
  })
  projects!: ProjectSearchResultDto[];

  /**
   * Lista de pessoas encontradas (DEntidade USER -150, máx ceil(limit * 0.2)).
   */
  @ApiProperty({
    description: 'Pessoas encontradas — membros da org (máx ceil(limit*0.2))',
    type: [PersonSearchResultDto],
  })
  people!: PersonSearchResultDto[];

  /**
   * Cursors independentes por categoria para próxima página (DA-2).
   */
  @ApiProperty({
    description: 'Cursors de paginação por categoria',
    type: SearchCursorsDto,
  })
  cursors!: SearchCursorsDto;

  /**
   * Metadados da busca (echo dos parâmetros usados).
   */
  @ApiProperty({
    description: 'Metadados da busca',
    type: SearchMetaDto,
  })
  meta!: SearchMetaDto;
}

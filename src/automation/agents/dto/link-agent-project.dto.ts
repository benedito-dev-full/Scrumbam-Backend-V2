import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/**
 * DTO para body do endpoint `POST /agents/:id/projects`.
 *
 * Permite vincular um agente existente (DEntidade -156) a um projeto
 * (DProject) via DVincula idClasse=-185 (PROJECT_AGENT).
 *
 * Validacoes aplicadas via class-validator:
 * - projectId: string obrigatorio contendo apenas digitos (regex `^\d+$`)
 *   — o BigInt do projeto. Aceita IDs positivos (runtime).
 *
 * Multi-project linking (operacao N:N idempotente): o mesmo agente pode
 * ser vinculado a varios projetos via N chamadas. O endpoint e idempotente
 * — chamada duplicada com mesmo (agentId, projectId) retorna
 * `alreadyLinked: true` sem criar novo registro.
 *
 * @example
 * ```typescript
 * const dto: LinkAgentProjectDto = { projectId: '123' };
 * ```
 */
export class LinkAgentProjectDto {
  /**
   * ID do projeto a vincular ao agente.
   *
   * String contendo apenas digitos (BigInt do `DProject.chave`).
   * Validacao via regex `^\d+$` previne IDs negativos e formato invalido.
   */
  @ApiProperty({
    description: 'ID do projeto (DProject.chave) a vincular ao agente — string com BigInt',
    example: '123',
  })
  @IsString()
  @Matches(/^\d+$/, { message: 'projectId deve conter apenas digitos (BigInt)' })
  projectId!: string;
}

/**
 * Response DTO de `POST /agents/:id/projects`.
 *
 * Estrutura:
 * - agentId: string com BigInt do agente vinculado
 * - projectId: string com BigInt do projeto vinculado
 * - linked: sempre `true` (operacao bem-sucedida)
 * - alreadyLinked: `true` quando o vinculo ja existia ativo (idempotencia);
 *   omitido quando o vinculo foi criado nesta chamada
 *
 * @example
 * ```json
 * // Vinculo criado nesta chamada
 * { "agentId": "100", "projectId": "123", "linked": true }
 *
 * // Vinculo ja existia (idempotente)
 * { "agentId": "100", "projectId": "123", "linked": true, "alreadyLinked": true }
 * ```
 */
export class LinkAgentProjectResponseDto {
  /**
   * ID do agente vinculado (DEntidade.chave).
   */
  @ApiProperty({ description: 'ID do agente (DEntidade -156)', example: '100' })
  agentId!: string;

  /**
   * ID do projeto vinculado (DProject.chave).
   */
  @ApiProperty({ description: 'ID do projeto (DProject)', example: '123' })
  projectId!: string;

  /**
   * Sempre `true` quando operacao bem-sucedida (cria ou ja existia).
   */
  @ApiProperty({ description: 'Sempre true em sucesso', example: true })
  linked!: boolean;

  /**
   * `true` quando o vinculo ja existia ativo antes desta chamada
   * (idempotencia). Omitido quando o vinculo foi criado agora.
   */
  @ApiPropertyOptional({
    description: 'Presente e true quando vinculo ja existia (idempotencia)',
    example: true,
  })
  alreadyLinked?: boolean;
}

/**
 * Response DTO de `DELETE /agents/:id/projects/:projectId`.
 *
 * Estrutura:
 * - agentId: string com BigInt do agente
 * - projectId: string com BigInt do projeto
 * - unlinked: sempre `true` em sucesso (soft-delete realizado)
 *
 * Comportamento: soft-delete (`excluido=true` no DVincula -185). Hard-delete
 * NAO suportado — preserva audit trail.
 *
 * @example
 * ```json
 * { "agentId": "100", "projectId": "123", "unlinked": true }
 * ```
 */
export class UnlinkAgentProjectResponseDto {
  /**
   * ID do agente cujo vinculo foi removido.
   */
  @ApiProperty({ description: 'ID do agente (DEntidade -156)', example: '100' })
  agentId!: string;

  /**
   * ID do projeto cujo vinculo foi removido.
   */
  @ApiProperty({ description: 'ID do projeto (DProject)', example: '123' })
  projectId!: string;

  /**
   * Sempre `true` em sucesso (soft-delete realizado).
   */
  @ApiProperty({ description: 'Sempre true em sucesso', example: true })
  unlinked!: boolean;
}

/**
 * Item individual da lista de projetos vinculados a um agente.
 *
 * Retorna apenas dados essenciais do projeto para listagem leve:
 * - projectId (BigInt do DProject)
 * - nome (DProject.nome — visivel ao operador)
 * - idEstab (BigInt da organizacao dona, ou null se projeto sem org)
 */
export class AgentProjectItemDto {
  /**
   * ID do projeto vinculado (DProject.chave).
   */
  @ApiProperty({ description: 'ID do projeto', example: '123' })
  projectId!: string;

  /**
   * Nome do projeto (DProject.nome).
   */
  @ApiProperty({ description: 'Nome do projeto', example: 'Backend Devari' })
  nome!: string;

  /**
   * ID da organizacao dona (DProject.idEstab), ou null se nao houver.
   */
  @ApiPropertyOptional({
    description: 'ID da organizacao dona (DProject.idEstab) ou null',
    example: '50',
    nullable: true,
  })
  idEstab!: string | null;
}

/**
 * Response DTO de `GET /agents/:id/projects`.
 *
 * Estrutura:
 * - agentId: string com BigInt do agente consultado
 * - projects: array de projetos vinculados (vazio quando agente standalone
 *   sem vinculos ativos)
 *
 * Lista vazia e resposta valida — agente standalone (sem vinculo) e estado
 * legitimo (post-install antes de qualquer link).
 *
 * @example
 * ```json
 * // Agente com 2 projetos vinculados
 * {
 *   "agentId": "100",
 *   "projects": [
 *     { "projectId": "123", "nome": "Backend", "idEstab": "50" },
 *     { "projectId": "124", "nome": "Frontend", "idEstab": "50" }
 *   ]
 * }
 *
 * // Agente standalone sem vinculos
 * { "agentId": "101", "projects": [] }
 * ```
 */
export class AgentProjectsResponseDto {
  /**
   * ID do agente consultado.
   */
  @ApiProperty({ description: 'ID do agente (DEntidade -156)', example: '100' })
  agentId!: string;

  /**
   * Lista de projetos vinculados ativos (excluido=false). Pode ser vazia.
   */
  @ApiProperty({
    description: 'Lista de projetos vinculados (vazia se standalone)',
    type: [AgentProjectItemDto],
  })
  projects!: AgentProjectItemDto[];
}

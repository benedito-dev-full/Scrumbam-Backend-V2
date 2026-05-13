import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Response DTO de `GET /agents/:id/env-status`.
 *
 * Audit trail leve: o frontend renderiza "Configurado em DD/MM/AAAA" sem
 * acesso aos valores. Persistido em `DEntidade -156 dados.envStatus`.
 *
 * @example
 * ```json
 * {
 *   "hasGithubToken": true,
 *   "hasAnthropicKey": true,
 *   "lastEnvUpdatedAt": "2026-05-13T18:42:00.000Z"
 * }
 * ```
 */
export class EnvStatusResponseDto {
  /**
   * Indica se o agente possui PAT GitHub configurado.
   *
   * `true` apos a primeira escrita bem-sucedida de `githubToken` via
   * PUT /agents/:id/env. Permanece `true` ate que o operador remova
   * manualmente do env file no host (sem endpoint de "limpar").
   */
  @ApiProperty({
    description: 'true se PAT GitHub foi configurado pelo menos uma vez',
    example: true,
  })
  hasGithubToken!: boolean;

  /**
   * Indica se o agente possui chave Anthropic configurada
   * (`ANTHROPIC_API_KEY` OU `ANTHROPIC_AUTH_TOKEN`).
   */
  @ApiProperty({
    description: 'true se ANTHROPIC_API_KEY ou ANTHROPIC_AUTH_TOKEN foi configurado',
    example: true,
  })
  hasAnthropicKey!: boolean;

  /**
   * Timestamp ISO8601 da ultima escrita bem-sucedida no env file.
   * `null` se nunca foi atualizado.
   */
  @ApiPropertyOptional({
    description: 'ISO8601 da ultima escrita (null se nunca configurado)',
    example: '2026-05-13T18:42:00.000Z',
    nullable: true,
  })
  lastEnvUpdatedAt!: string | null;

  /**
   * Nome configurado do bot Git (DEntidade -156 dados.gitBotName).
   * Plaintext porque NAO e sensivel (publico em `git log`).
   * `null` se nunca foi configurado via `PUT /agents/:id/git-bot`.
   */
  @ApiPropertyOptional({
    description: 'Nome atual do bot Git (null se nunca configurado)',
    example: 'Scrumban Bot',
    nullable: true,
  })
  gitBotName!: string | null;

  /**
   * Email configurado do bot Git (DEntidade -156 dados.gitBotEmail).
   * Plaintext porque NAO e sensivel (publico em `git log`).
   * `null` se nunca foi configurado.
   */
  @ApiPropertyOptional({
    description: 'Email atual do bot Git (null se nunca configurado)',
    example: 'bot@scrumban.app',
    nullable: true,
  })
  gitBotEmail!: string | null;
}

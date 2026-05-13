import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DTO para `PUT /agents/:id/git-bot` — atualiza identidade do bot Git
 * que sera usada em `git commit` automatico no fim de `RUN_CLAUDE_CODE`.
 *
 * Dispara `SET_ENV` no agente para reescrever `GIT_BOT_NAME` e
 * `GIT_BOT_EMAIL` no env file (que `git` consome via env). Persiste
 * `gitBotName` e `gitBotEmail` em `DEntidade -156 dados` (plaintext OK:
 * dados nao-sensiveis, identidade publica).
 *
 * @example
 * ```typescript
 * const dto: SetGitBotDto = {
 *   name: 'Scrumban Bot',
 *   email: 'bot@scrumban.app',
 * };
 * ```
 */
export class SetGitBotDto {
  /**
   * Nome do bot Git (aparece em `git log`).
   *
   * Sem newline / quebra de linha (validado no agent allowlist).
   */
  @ApiProperty({
    description: 'Nome do bot Git (aparece como autor dos commits)',
    example: 'Scrumban Bot',
    minLength: 1,
    maxLength: 100,
  })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  name!: string;

  /**
   * Email do bot Git (aparece em `git log`).
   */
  @ApiProperty({
    description: 'Email do bot Git',
    example: 'bot@scrumban.app',
    maxLength: 254,
  })
  @IsEmail()
  @MaxLength(254)
  email!: string;
}

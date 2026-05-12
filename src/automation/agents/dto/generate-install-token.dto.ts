import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, Matches } from 'class-validator';

/**
 * DTO para geração de token one-shot de instalação de agente.
 *
 * `projectId` é OPCIONAL — quando ausente, o token gera um agente
 * "standalone" (sem vínculo de projeto). Vínculos agente↔projeto
 * podem ser criados/removidos depois via `POST /agents/:id/projects`
 * e `DELETE /agents/:id/projects/:projectId` (sub-tarefa 4.3).
 *
 * Backward-compat: quando `projectId` é fornecido, comportamento é
 * IDÊNTICO ao histórico (cria DEntidade -156 + DVincula -185 atomicamente).
 *
 * Validações aplicadas via class-validator:
 * - projectId: string opcional; quando presente, somente dígitos.
 *
 * @example
 * ```typescript
 * // Standalone (recomendado para 1 agente / N projetos):
 * const dto: GenerateInstallTokenDto = {};
 *
 * // Tradicional (1 agente = 1 projeto):
 * const dto: GenerateInstallTokenDto = { projectId: '123' };
 * ```
 */
export class GenerateInstallTokenDto {
  /**
   * ID do projeto ao qual o agente será vinculado automaticamente no
   * `install`. Quando ausente, o agente é criado standalone — vincular
   * projetos depois via `POST /agents/:id/projects`.
   */
  @ApiPropertyOptional({
    description:
      'ID do projeto (opcional). Se ausente, agente é criado standalone — ' +
      'vincular projetos depois via POST /agents/:id/projects.',
    example: '123',
  })
  @IsOptional()
  @Matches(/^\d+$/, { message: 'projectId deve conter apenas dígitos' })
  projectId?: string;
}

export class GenerateInstallTokenResponseDto {
  @ApiProperty({ description: 'Token plaintext exibido uma unica vez' })
  token!: string;

  @ApiProperty({ description: 'ID do registro DTabela -473', example: '456' })
  installTokenId!: string;

  @ApiProperty({ description: 'Expiracao ISO-8601' })
  expiresAt!: string;
}

import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

/**
 * DTO para atualização parcial de projeto (PATCH /projects/:id).
 *
 * Todos os campos são opcionais. Apenas MANAGER pode atualizar.
 *
 * @example
 * ```typescript
 * const dto: UpdateProjectDto = {
 *   nome: 'Novo Nome',
 *   automationEnabled: true,
 * };
 * ```
 */
export class UpdateProjectDto {
  @ApiPropertyOptional({
    description: 'Novo nome do projeto',
    example: 'Scrumban V2 — Novo Nome',
    minLength: 3,
    maxLength: 255,
  })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  nome?: string;

  @ApiPropertyOptional({
    description: 'Nova descrição do projeto',
    example: 'Descrição atualizada',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @ApiPropertyOptional({
    description: 'Habilitar ou desabilitar automação Claude Code',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  automationEnabled?: boolean;

  @ApiPropertyOptional({
    description: 'URL do repositório git',
    example: 'https://github.com/org/novo-repo',
  })
  @IsOptional()
  @IsUrl()
  gitRepo?: string;

  @ApiPropertyOptional({
    description: 'Prefixo do identifier das tasks',
    example: 'FEAT',
    maxLength: 8,
  })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  prefix?: string;

  /**
   * Vínculo do projeto com um time (DVincula -182 PROJECT_TEAM_LINK).
   *
   * Convenção (ADR-V2-029):
   *  - `teamId` omitido → vínculo inalterado.
   *  - `teamId` string → soft-delete do vínculo atual (se houver) e cria
   *    novo vínculo (`idLocEscritu=teamId, idEntidade=projectId`). Requer
   *    LEAD do novo time ou ADMIN da org.
   *  - `teamId === null` → soft-delete do vínculo atual (projeto fica
   *    órfão). Não requer permissão no time (apenas MANAGER do projeto).
   *
   * Para diferenciar omissão de `null` no service, use `'teamId' in dto`
   * em vez de `dto.teamId !== undefined`.
   *
   * @see ADR-V2-029
   */
  @ApiPropertyOptional({
    description: 'ID do time (string) | null para desvincular | omitir para manter',
    example: '200',
    nullable: true,
  })
  @ValidateIf((o: UpdateProjectDto) => o.teamId !== null && o.teamId !== undefined)
  @IsString()
  teamId?: string | null;
}

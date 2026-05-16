import {
  IsBoolean,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateIf,
} from 'class-validator';
import { ApiPropertyOptional } from '@nestjs/swagger';

import { REPO_URL_REGEX } from '../utils/repo-url';

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

  /**
   * URL canônica do repositório git (coluna `DProject.repoUrl` —
   * exceção autorizada por ADR-V2-043). Fonte única de verdade para
   * URL de repositório (ADR-V2-043).
   *
   * Aceita apenas protocolos da whitelist (`REPO_URL_REGEX`):
   *  - `git@github.com:org/repo.git`
   *  - `git@gitlab.com:org/repo.git`
   *  - `git@bitbucket.org:org/repo.git`
   *  - `https://github.com/org/repo(.git)?`
   *  - `https://gitlab.com/org/repo(.git)?`
   *  - `https://bitbucket.org/org/repo(.git)?`
   *
   * Anti-injection: este valor é despachado ao agente VPS para `git clone`,
   * portanto a regex é o ÚNICO ponto de confiança. Service e
   * `RemoteExecutionClient` re-validam antes do dispatch.
   *
   * @see ADR-V2-043 — Provisioning via clone com whitelist restritiva
   * @see REPO_URL_REGEX em `src/projects/utils/repo-url.ts`
   */
  @ApiPropertyOptional({
    description: 'URL do repositório git (whitelist: github/gitlab/bitbucket SSH ou HTTPS). null para limpar.',
    example: 'git@github.com:org/repo.git',
    maxLength: 512,
    nullable: true,
  })
  @ValidateIf((o: UpdateProjectDto) => o.repoUrl !== null && o.repoUrl !== undefined)
  @IsString()
  @MaxLength(512)
  @Matches(REPO_URL_REGEX, {
    message: 'repoUrl deve ser git@... ou https://github.com|gitlab.com|bitbucket.org/...',
  })
  repoUrl?: string | null;

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

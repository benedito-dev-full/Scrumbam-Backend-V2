import {
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { REPO_URL_REGEX } from '../utils/repo-url';

/**
 * DTO para criação de projeto (DProject).
 *
 * Cria atomicamente:
 * 1. DProject (tabela canônica)
 * 2. DVincula -171 (PROJECT_ROLE_MANAGER) para o criador
 * 3. 9 DTabela statuses V3 padrão (INBOX a VALIDATED)
 * 4. 1 DTabela Sprint default ("Sprint 1")
 *
 * @example
 * ```typescript
 * const dto: CreateProjectDto = {
 *   nome: 'Scrumban Backend V2',
 *   prefix: 'DEV',
 *   description: 'Refundação canônica Devari-Core',
 *   orgId: '100',
 * };
 * ```
 */
export class CreateProjectDto {
  /**
   * Nome do projeto (obrigatório, 3-255 caracteres).
   */
  @ApiProperty({
    description: 'Nome do projeto',
    example: 'Scrumban Backend V2',
    minLength: 3,
    maxLength: 255,
  })
  @IsString()
  @MinLength(3)
  @MaxLength(255)
  nome!: string;

  /**
   * Prefixo do identifier de tasks (ex: "DEV" → gera DEV-1, DEV-2...).
   * Máximo 8 caracteres. Default: "DEV".
   */
  @ApiPropertyOptional({
    description: 'Prefixo do identifier das tasks (ex: DEV → DEV-1, DEV-2...)',
    example: 'DEV',
    maxLength: 8,
    default: 'DEV',
  })
  @IsOptional()
  @IsString()
  @MaxLength(8)
  prefix?: string;

  /**
   * Descrição do projeto (opcional).
   */
  @ApiPropertyOptional({
    description: 'Descrição do projeto',
    example: 'Refundação canônica do Scrumban sob template Devari-Core',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  /**
   * ID da organização pai (DEntidade -152).
   * Se fornecido, vincula o projeto à organização via DProject.idEstab.
   */
  @ApiPropertyOptional({
    description: 'ID da organização pai (DEntidade -152)',
    example: '100',
  })
  @IsOptional()
  @IsString()
  orgId?: string;

  /**
   * Se automação Claude Code está habilitada.
   */
  @ApiPropertyOptional({
    description: 'Habilitar automação Claude Code',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  automationEnabled?: boolean;

  /**
   * URL do repositório git (LEGADO — armazenada em `DProject.dados.gitRepo`).
   *
   * @deprecated Use `repoUrl` (coluna canônica `DProject.repoUrl`, ADR-V2-043).
   * Mantido por 1 release para compatibilidade com clients antigos. Será
   * removido após migração completa do frontend.
   */
  @ApiPropertyOptional({
    description: 'URL do repositório git (LEGADO — use repoUrl)',
    example: 'https://github.com/org/repo',
    deprecated: true,
  })
  @IsOptional()
  @IsUrl()
  gitRepo?: string;

  /**
   * URL canônica do repositório git (coluna `DProject.repoUrl` —
   * exceção autorizada por ADR-V2-043). Substitui `gitRepo` legado
   * em `dados.gitRepo` (mantido por 1 release para compat).
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
    description: 'URL do repositório git (whitelist: github/gitlab/bitbucket SSH ou HTTPS)',
    example: 'git@github.com:org/repo.git',
    maxLength: 512,
  })
  @IsOptional()
  @IsString()
  @MaxLength(512)
  @Matches(REPO_URL_REGEX, {
    message: 'repoUrl deve ser git@... ou https://github.com|gitlab.com|bitbucket.org/...',
  })
  repoUrl?: string;

  /**
   * ID do time ao qual o projeto será vinculado (DVincula -182).
   *
   * Quando fornecido, cria atomicamente um vínculo PROJECT_TEAM_LINK
   * (`idLocEscritu=teamId`, `idEntidade=projectId`) na mesma transação
   * que cria o DProject.
   *
   * Validações:
   *  - Team deve existir (DEntidade idClasse=-180).
   *  - Team deve pertencer à mesma org do projeto (cross-org guard).
   *  - Usuário deve ser LEAD do time ou ADMIN da org.
   *
   * Quando omitido, o projeto fica órfão (sem vínculo de time) e é
   * listado em `GET /projects` mas não em `GET /projects?teamId=X`.
   *
   * @see ADR-V2-029 — Project ↔ Team via DVincula -182
   */
  @ApiPropertyOptional({
    description: 'ID do time a vincular (DVincula -182). Omitir cria projeto órfão.',
    example: '200',
  })
  @IsOptional()
  @IsString()
  teamId?: string;
}

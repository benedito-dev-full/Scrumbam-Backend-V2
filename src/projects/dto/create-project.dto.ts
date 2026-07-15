import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

import { REPO_URL_REGEX } from '../utils/repo-url';

/**
 * DTO para criação de projeto (DProject).
 *
 * Cria atomicamente:
 * 1. DProject (tabela canônica)
 * 2. DVincula -171 (PROJECT_ROLE_MANAGER) para o criador
 * 3. 5 DTabela statuses V3 padrão (INBOX a FAILED)
 *
 * A URL do repositório git é armazenada exclusivamente em `DProject.repoUrl`
 * (ADR-V2-043). O campo `dados.gitRepo` foi removido — use `repoUrl`.
 *
 * @example
 * ```typescript
 * const dto: CreateProjectDto = {
 *   nome: 'Scrumban Backend V2',
 *   prefix: 'DEV',
 *   description: 'Refundação canônica Devari-Core',
 *   orgId: '100',
 *   repoUrl: 'git@github.com:org/repo.git',
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
   * URL canônica do repositório git (coluna `DProject.repoUrl` —
   * exceção autorizada por ADR-V2-043). Fonte única de verdade para
   * URL de repositório — o campo `dados.gitRepo` foi removido.
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
   * Tipo hierárquico do projeto (ADR-V2-051 — hierarquia Space/Folder/List).
   *
   * Valores canônicos:
   * - `-350` SPACE  — raiz da hierarquia, não possui pai
   * - `-351` FOLDER — filho de SPACE, agrupador intermediário
   * - `-352` LIST   — contém tasks; recebe seed de statuses V3
   * - `-353` DOC    — documento (reservado, sem seed)
   *
   * Quando ausente, o projeto é criado como LIST padrão (idClasse=-153,
   * backwards-compatibility com código anterior ao ADR-V2-051).
   *
   * @see ADR-V2-051 — Hierarquia Space/Folder/List
   */
  @ApiPropertyOptional({
    description: 'Tipo hierárquico do projeto (-350 SPACE, -351 FOLDER, -352 LIST, -353 DOC)',
    example: '-352',
  })
  @IsOptional()
  @IsString()
  idClasse?: string;

  /**
   * ID do projeto pai na hierarquia (ADR-V2-051).
   *
   * Regras de hierarquia:
   * - **SPACE** (`-350`): deve ser `null` (SPACE é sempre raiz)
   * - **FOLDER** (`-351`): deve apontar para um SPACE (`-350`)
   * - **LIST** (`-352`): deve apontar para FOLDER (`-351`) ou SPACE (`-350`)
   * - **Outros** (legado `-153`, DOC `-353`): sem restrição hierárquica
   *
   * Quando omitido ou `null`, o projeto não possui pai (raiz).
   *
   * @see ADR-V2-051 — Hierarquia Space/Folder/List
   */
  @ApiPropertyOptional({
    description: 'ID do projeto pai na hierarquia (null para raiz)',
    example: '100',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  idPai?: string | null;

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

  /**
   * Torna o projeto privado (ADR-V2-051 §8).
   *
   * Quando `true`, o projeto só é visível a membros explicitamente
   * vinculados via DVincula -188 (SPACE_PRIVATE_MEMBER).
   * Quando `false` (padrão), o projeto é visível a todos da org.
   */
  @ApiPropertyOptional({
    description: 'Tornar projeto privado (visível apenas a membros explícitos)',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  privado?: boolean;

  /**
   * Cor hex do espaço (`#RRGGBB`). Persistida em `DProject.dados.color`.
   * Usada no avatar do espaço na sidebar e no modal.
   */
  @ApiPropertyOptional({
    description: 'Cor hex do espaço (#RRGGBB). Persistida em dados.color.',
    example: '#3b82f6',
  })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'color deve ser hex no formato #RRGGBB' })
  color?: string | null;

  /**
   * Ícone do espaço (emoji ou slug). Persistido em `DProject.dados.icon`.
   */
  @ApiPropertyOptional({
    description: 'Ícone do espaço (emoji ou slug). Persistido em dados.icon.',
    example: '🚀',
  })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  icon?: string | null;
}

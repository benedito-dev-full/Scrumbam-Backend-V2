import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateBy,
  ValidateNested,
  ValidationOptions,
} from 'class-validator';

/**
 * Bloco `pipeline` do callback `POST /agents/:id/execution-result` (ADR-V2-083).
 *
 * Aditivo e OPCIONAL: agente 0.1.x não manda (backend aplica a regra legada
 * exit 0). Agente 0.2.0 manda `declared` (o que o modelo DISSE — saída
 * estruturada do `--json-schema`) + `verified` (o que o agente CONFERIU
 * sozinho no git, no GitHub e no `subagent_stats` do runtime).
 *
 * Limites de tamanho em todos os textos (R8): nada de stdout cru aqui.
 *
 * @see docs/decisions/ADR-V2-083-esteira-headless-contrato-verificavel.md
 * @see agent/src/claude-code/pipeline-contract.ts (lado agente — mesmos limites)
 */

/** Decisões possíveis da esteira (contrato v1). */
export const PIPELINE_DECISIONS = [
  'APPROVED',
  'NEEDS_CHANGES',
  'REJECTED',
  'NO_CHANGES',
  'ABORTED',
] as const;

/** Status de uma etapa declarada. */
export const PIPELINE_STAGE_STATUSES = ['done', 'skipped', 'failed'] as const;

/** Estados de PR do GitHub (`gh pr list --json state`). */
export const PIPELINE_PR_STATES = ['OPEN', 'CLOSED', 'MERGED'] as const;

/** Quem abriu o PR verificado. */
export const PIPELINE_PR_OPENERS = ['pipeline', 'agent-fallback'] as const;

/** URL de PR do GitHub (`https://github.com/<owner>/<repo>/pull/<n>`). */
const GITHUB_PR_URL_RE = /^https:\/\/github\.com\/[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}\/pull\/\d{1,9}$/;

/** SHA de commit (abreviado ou completo). */
const GIT_SHA_RE = /^[0-9a-f]{7,64}$/i;

/** Nome de branch seguro (sem espaços, sem `..`, não começa com `-`). */
const GIT_REF_RE = /^(?!-)(?!.*\.\.)[A-Za-z0-9._/-]{1,200}$/;

/** Nome de subagent (chave de `subagent_stats.by_type`). */
const SUBAGENT_NAME_RE = /^[A-Za-z0-9._:-]{1,80}$/;

/**
 * Valida `Record<string, number>` vindo de `subagent_stats.by_type`:
 * no máx. 30 chaves, nomes seguros, contagens inteiras 0..1000.
 * Necessário porque `forbidNonWhitelisted` não desce em mapas livres.
 *
 * @param options - Opções do class-validator
 * @returns Decorator de propriedade
 */
export function IsSubagentCountMap(options?: ValidationOptions): PropertyDecorator {
  return ValidateBy(
    {
      name: 'isSubagentCountMap',
      validator: {
        validate: (value: unknown): boolean => {
          if (value === null || value === undefined) return true;
          if (typeof value !== 'object' || Array.isArray(value)) return false;
          const entries = Object.entries(value as Record<string, unknown>);
          if (entries.length > 30) return false;
          return entries.every(
            ([k, v]) =>
              SUBAGENT_NAME_RE.test(k) &&
              typeof v === 'number' &&
              Number.isInteger(v) &&
              v >= 0 &&
              v <= 1000,
          );
        },
        defaultMessage: (): string =>
          'subagents deve ser um mapa { nome: contagem inteira } (máx. 30 chaves)',
      },
    },
    options,
  );
}

/** Etapa declarada pela esteira. */
export class PipelineStageDto {
  @ApiProperty({ example: 'reviewer', maxLength: 40 })
  @IsString()
  @MaxLength(40)
  name!: string;

  @ApiProperty({ enum: PIPELINE_STAGE_STATUSES, example: 'done' })
  @IsIn(PIPELINE_STAGE_STATUSES as unknown as string[])
  status!: (typeof PIPELINE_STAGE_STATUSES)[number];
}

/** Saída estruturada declarada pelo modelo (contrato v1). */
export class PipelineDeclaredDto {
  @ApiProperty({ example: 1, description: 'Versão do contrato de saída' })
  @IsInt()
  @IsIn([1])
  contractVersion!: number;

  @ApiProperty({ enum: PIPELINE_DECISIONS, example: 'APPROVED' })
  @IsIn(PIPELINE_DECISIONS as unknown as string[])
  decision!: (typeof PIPELINE_DECISIONS)[number];

  @ApiPropertyOptional({ example: 9.0, nullable: true, minimum: 0, maximum: 10 })
  @IsOptional()
  @IsNumber()
  @Min(0)
  @Max(10)
  reviewScore!: number | null;

  @ApiPropertyOptional({ example: 'workspace/reviews/review-x.md', nullable: true, maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  reviewFile?: string | null;

  @ApiProperty({ type: [PipelineStageDto] })
  @IsArray()
  @ArrayMaxSize(10)
  @ValidateNested({ each: true })
  @Type(() => PipelineStageDto)
  stages!: PipelineStageDto[];

  @ApiPropertyOptional({ example: 'scrumban/exec-4815', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  branch!: string | null;

  @ApiPropertyOptional({ example: 'a1b2c3d', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  commit!: string | null;

  @ApiPropertyOptional({ example: 'https://github.com/acme/api/pull/42', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  prUrl!: string | null;

  @ApiProperty({ example: 'Endpoint X implementado, review 9.0, PR aberto.', maxLength: 2000 })
  @IsString()
  @MaxLength(2000)
  summary!: string;
}

/** PR verificado pelo agente via `gh pr list --head <branch>`. */
export class PipelineVerifiedPrDto {
  @ApiProperty({ example: 'https://github.com/acme/api/pull/42' })
  @IsString()
  @MaxLength(500)
  @Matches(GITHUB_PR_URL_RE, { message: 'pr.url deve ser URL de PR do github.com' })
  url!: string;

  @ApiProperty({ example: 42 })
  @IsInt()
  @Min(1)
  number!: number;

  @ApiProperty({ enum: PIPELINE_PR_STATES, example: 'OPEN' })
  @IsIn(PIPELINE_PR_STATES as unknown as string[])
  state!: (typeof PIPELINE_PR_STATES)[number];

  @ApiProperty({ example: false })
  @IsBoolean()
  isDraft!: boolean;

  @ApiProperty({ example: 'develop' })
  @IsString()
  @Matches(GIT_REF_RE, { message: 'pr.baseRefName inválido' })
  baseRefName!: string;

  @ApiProperty({ example: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0' })
  @IsString()
  @Matches(GIT_SHA_RE, { message: 'pr.headRefOid deve ser SHA' })
  headRefOid!: string;
}

/** Verificação independente do agente (git + gh + subagent_stats). */
export class PipelineVerifiedDto {
  @ApiProperty({ example: true })
  @IsBoolean()
  branchExists!: boolean;

  @ApiProperty({ example: true, description: 'Branch no remoto com o mesmo SHA (git ls-remote)' })
  @IsBoolean()
  pushed!: boolean;

  @ApiPropertyOptional({ example: 4, nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  commitsAhead!: number | null;

  @ApiPropertyOptional({ example: 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0', nullable: true })
  @IsOptional()
  @IsString()
  @Matches(GIT_SHA_RE, { message: 'headSha deve ser SHA' })
  headSha!: string | null;

  @ApiPropertyOptional({ example: 'develop', nullable: true })
  @IsOptional()
  @IsString()
  @Matches(GIT_REF_RE, { message: 'baseBranch inválida' })
  baseBranch!: string | null;

  @ApiPropertyOptional({ type: PipelineVerifiedPrDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => PipelineVerifiedPrDto)
  pr!: PipelineVerifiedPrDto | null;

  @ApiPropertyOptional({ enum: PIPELINE_PR_OPENERS, nullable: true })
  @IsOptional()
  @IsIn(PIPELINE_PR_OPENERS as unknown as string[])
  prOpenedBy!: (typeof PIPELINE_PR_OPENERS)[number] | null;

  @ApiPropertyOptional({
    example: { strategist: 1, implementer: 2, reviewer: 2, documenter: 1 },
    nullable: true,
    description: '`subagent_stats.by_type` do runtime (fonte independente do modelo)',
  })
  @IsOptional()
  @IsSubagentCountMap()
  subagents!: Record<string, number> | null;

  @ApiProperty({ example: true, description: 'Saída estruturada presente e válida (schema v1)' })
  @IsBoolean()
  contractValid!: boolean;

  @ApiPropertyOptional({ nullable: true, maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  contractError?: string | null;

  @ApiPropertyOptional({ nullable: true, maxLength: 300 })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  verifyError?: string | null;
}

/** Bloco `pipeline` do callback (ADR-V2-083). */
export class ExecutionPipelineResultDto {
  @ApiProperty({ enum: ['pipeline', 'simple'], example: 'pipeline' })
  @IsIn(['pipeline', 'simple'])
  mode!: 'pipeline' | 'simple';

  @ApiPropertyOptional({ type: PipelineDeclaredDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => PipelineDeclaredDto)
  declared!: PipelineDeclaredDto | null;

  @ApiPropertyOptional({ type: PipelineVerifiedDto, nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => PipelineVerifiedDto)
  verified!: PipelineVerifiedDto | null;
}

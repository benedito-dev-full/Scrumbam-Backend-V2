import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

/**
 * Códigos de erro categorizados que o agente V2 pode reportar no callback
 * `execution-result` quando a execução Claude Code não foi bem-sucedida.
 *
 * - `SESSION_ID_EXTRACTION_FAILED` — Claude rodou, mas parser não extraiu sessionId
 * - `RESUME_SESSION_NOT_FOUND` — `--resume <id>` falhou porque sessão não existe
 * - `TIMEOUT` — execução excedeu `timeoutSec`
 * - `CLAUDE_CLI_MISSING` — binário `claude` não encontrado no PATH do agente
 * - `UNKNOWN` — categoria não classificada (fallback)
 *
 * @see ADR-V2-033 (callback contract)
 */
export type ExecutionResultErrorCode =
  | 'SESSION_ID_EXTRACTION_FAILED'
  | 'RESUME_SESSION_NOT_FOUND'
  | 'TIMEOUT'
  | 'CLAUDE_CLI_MISSING'
  | 'GIT_PULL_FAILED'
  | 'UNKNOWN';

const EXECUTION_RESULT_ERROR_CODES: ExecutionResultErrorCode[] = [
  'SESSION_ID_EXTRACTION_FAILED',
  'RESUME_SESSION_NOT_FOUND',
  'TIMEOUT',
  'CLAUDE_CLI_MISSING',
  'GIT_PULL_FAILED',
  'UNKNOWN',
];

/**
 * Regex permissivo para UUID genérico (v4/v7/etc) — Claude Code pode emitir
 * formatos não-canônicos. Validação rigorosa rejeitaria sessionIds reais.
 *
 * @see plan-automation-backend-side-task2.md §5 Risco #5
 */
const UUID_GENERIC_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * DTO para callback `POST /agents/:id/execution-result`
 *
 * Reporta outcome de uma execução Claude Code disparada via
 * `POST /v1/execute` outbound. O agente V2 envia este payload assinado por
 * HMAC (validado por `AgentAuthGuard`) APÓS a execução terminar.
 *
 * Validações aplicadas via class-validator:
 * - `executionId`: string não-vazia (convertida para BigInt no service)
 * - `exitCode`: int (0 = sucesso por convenção)
 * - `success`: boolean (derivado pelo agente: exitCode === 0 && sem erro operacional)
 * - `durationMs`: int ≥ 0 (duração total da execução em ms)
 * - `claudeSessionId`: string UUID genérica ou null (se extração falhou)
 * - `claudeSessionPath`: string ≤500 ou null (path absoluto do .jsonl — INTERNAL)
 * - `resumedFrom`: string UUID genérica ou null (sessão pai se `--resume` foi usado)
 * - `stdoutTruncated`: string ≤64KB (stdout do CLI, já truncado pelo agente)
 * - `stderrTruncated`: string ≤64KB (stderr do CLI, já truncado pelo agente)
 * - `errorCode`: enum opcional (categoria de falha quando `success === false`)
 *
 * @example
 * ```typescript
 * const dto: ExecutionResultDto = {
 *   executionId: '4815',
 *   exitCode: 0,
 *   success: true,
 *   durationMs: 12450,
 *   claudeSessionId: 'a1b2c3d4-5678-4abc-9def-0123456789ab',
 *   claudeSessionPath: '/home/agent/.claude/projects/meu-projeto/sess-xyz.jsonl',
 *   resumedFrom: null,
 *   stdoutTruncated: '...',
 *   stderrTruncated: '',
 * };
 * ```
 *
 * @see ADR-V2-033
 * @see ADR-V2-032 (claudeSessionId persiste em DPedido.dados via Engine)
 */
export class ExecutionResultDto {
  /**
   * ID da execução (DPedido.chave como string).
   * Convertido para BigInt no service. Validado contra range -301/-302/-303 e isolation por agente.
   */
  @ApiProperty({
    description: 'ID da execução (chave do DPedido, idClasse -301/-302/-303)',
    example: '4815',
  })
  @IsString()
  @IsNotEmpty()
  @Matches(/^-?\d+$/, { message: 'executionId deve ser numérico (BigInt válido)' })
  executionId!: string;

  /**
   * Exit code do CLI Claude Code.
   * 0 = sucesso por convenção. Outros valores indicam falha.
   */
  @ApiProperty({
    description: 'Exit code do CLI Claude Code (0 = sucesso)',
    example: 0,
  })
  @IsInt()
  exitCode!: number;

  /**
   * Flag de sucesso derivado pelo agente.
   * Tipicamente `exitCode === 0 && sem erro operacional` (timeout/CLI missing/etc).
   */
  @ApiProperty({
    description: 'Sucesso geral da execução (derivado pelo agente)',
    example: true,
  })
  @IsBoolean()
  success!: boolean;

  /**
   * Duração total da execução em milissegundos.
   */
  @ApiProperty({
    description: 'Duração total em milissegundos',
    example: 12450,
    minimum: 0,
  })
  @IsInt()
  @Min(0)
  durationMs!: number;

  /**
   * Session ID extraído do output do Claude Code.
   * null quando extração falhou (errorCode tipicamente SESSION_ID_EXTRACTION_FAILED).
   * Formato: UUID genérico (regex permissivo — v4/v7/etc).
   */
  @ApiPropertyOptional({
    description: 'Session ID Claude Code (UUID) ou null se não foi extraído',
    example: 'a1b2c3d4-5678-4abc-9def-0123456789ab',
    nullable: true,
  })
  @IsOptional()
  @Matches(UUID_GENERIC_REGEX, {
    message: 'claudeSessionId deve ser UUID válido (8-4-4-4-12 hex)',
  })
  claudeSessionId?: string | null;

  /**
   * Caminho absoluto do arquivo .jsonl da sessão no filesystem do agente.
   *
   * INTERNAL — backend persiste em `DPedido.dados.claude.sessionPath` para audit,
   * mas NÃO expõe em nenhum DTO de response do frontend (Risco #7 do plan:
   * vazamento de filesystem path).
   *
   * Max 500 chars (paths Unix razoáveis cabem; previne abuso).
   */
  @ApiPropertyOptional({
    description: 'Caminho absoluto do .jsonl da sessão (INTERNAL — não vaza pro frontend)',
    example: '/home/agent/.claude/projects/meu-projeto/sess-xyz.jsonl',
    nullable: true,
    maxLength: 500,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  claudeSessionPath?: string | null;

  /**
   * ID da sessão pai quando o agente usou `--resume <id>` para continuar conversa.
   * null quando sessão é nova. Determina qual DEvento é emitido:
   *   - `resumedFrom == null` + claudeSessionId presente → `agent.session.created` (-505)
   *   - `resumedFrom != null` + claudeSessionId presente → `agent.session.resumed` (-506)
   */
  @ApiPropertyOptional({
    description: 'UUID da sessão anterior (se --resume) ou null se sessão nova',
    example: 'b2c3d4e5-6789-4abc-9def-0123456789ab',
    nullable: true,
  })
  @IsOptional()
  @Matches(UUID_GENERIC_REGEX, {
    message: 'resumedFrom deve ser UUID válido (8-4-4-4-12 hex)',
  })
  resumedFrom?: string | null;

  /**
   * Stdout do CLI Claude Code, já truncado pelo agente para max 64KB.
   * Persiste em `DPedido.dados.claude.stdout`.
   */
  @ApiProperty({
    description: 'Stdout truncado a 64KB',
    example: 'Claude executou com sucesso...',
    maxLength: 65536,
  })
  @IsString()
  @MaxLength(65536)
  stdoutTruncated!: string;

  /**
   * Stderr do CLI Claude Code, já truncado pelo agente para max 64KB.
   * Persiste em `DPedido.dados.claude.stderr`.
   */
  @ApiProperty({
    description: 'Stderr truncado a 64KB',
    example: '',
    maxLength: 65536,
  })
  @IsString()
  @MaxLength(65536)
  stderrTruncated!: string;

  /**
   * Categoria de erro quando `success === false`. Opcional.
   * Permite ao backend correlacionar falhas operacionais sem parsing de stderr.
   */
  @ApiPropertyOptional({
    description: 'Categoria do erro (se success=false)',
    enum: EXECUTION_RESULT_ERROR_CODES,
  })
  @IsOptional()
  @IsEnum(EXECUTION_RESULT_ERROR_CODES, {
    message: `errorCode deve ser um de: ${EXECUTION_RESULT_ERROR_CODES.join(', ')}`,
  })
  errorCode?: ExecutionResultErrorCode;
}

/**
 * Response do callback `POST /agents/:id/execution-result`.
 *
 * - `accepted: true` quando payload foi aceito e persistido.
 * - `alreadyPersisted: true` em chamadas duplicadas (mesmo `executionId` 2x);
 *   payload é NO-OP e response retorna `persistedAt` da primeira persistência.
 * - `persistedAt`: ISO 8601 do momento da persistência.
 */
export class ExecutionResultResponseDto {
  @ApiProperty({ description: 'Sempre true quando 200/201', example: true })
  accepted!: boolean;

  @ApiProperty({
    description: 'Timestamp ISO 8601 da persistência (primeira chamada)',
    example: '2026-05-12T14:30:00.000Z',
  })
  persistedAt!: string;

  @ApiPropertyOptional({
    description:
      'true em chamadas duplicadas (idempotência): payload NO-OP, persistedAt é da primeira',
    example: false,
  })
  alreadyPersisted?: boolean;
}

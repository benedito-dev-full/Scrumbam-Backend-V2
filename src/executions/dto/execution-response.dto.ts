import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Mapa de idClasse para riskLevel legível (ADR-V2-006).
 * O riskLevel é derivado do idClasse do DPedido — não lido de dados.risk.level.
 */
export const RISK_CLASSE_MAP: Record<string, 'LOW' | 'MEDIUM' | 'HIGH'> = {
  '-301': 'LOW',
  '-302': 'MEDIUM',
  '-303': 'HIGH',
};

/**
 * DTO de resumo do comando executado.
 */
export class CommandSummaryDto {
  @ApiProperty({ description: 'Texto do comando enviado ao Claude' })
  text!: string;

  @ApiPropertyOptional({ description: 'Executavel estruturado' })
  executable?: string;

  @ApiPropertyOptional({ description: 'Args estruturados', type: [String] })
  args?: string[];

  @ApiPropertyOptional({ description: 'Working directory usado' })
  cwd?: string;

  @ApiPropertyOptional({ description: 'Timeout em ms' })
  timeoutMs?: number;
}

/**
 * DTO de status de aprovação da execution.
 */
export class ApprovalStatusDto {
  @ApiProperty({
    description: 'Status de aprovação',
    enum: ['queued', 'awaiting_approval', 'approved', 'rejected', 'expired'],
  })
  status!: string;

  @ApiPropertyOptional({ description: 'ID do aprovador (string)' })
  approvedBy?: string;

  @ApiPropertyOptional({ description: 'ID do rejeitador (string)' })
  rejectedBy?: string;

  @ApiPropertyOptional({ description: 'Motivo da rejeição' })
  rejectedReason?: string;

  @ApiPropertyOptional({ description: 'Data/hora de expiração (ISO 8601)' })
  expiresAt?: string;

  @ApiPropertyOptional({ description: 'Data/hora da decisão (ISO 8601)' })
  decidedAt?: string;
}

/**
 * DTO de resultado da execução Claude.
 */
export class ClaudeResultDto {
  @ApiPropertyOptional({ description: 'Session ID do Claude Code' })
  sessionId?: string;

  @ApiPropertyOptional({ description: 'Exit code (0 = sucesso)' })
  exitCode?: number;

  @ApiPropertyOptional({ description: 'stdout truncado a 1MB' })
  stdout?: string;

  @ApiPropertyOptional({ description: 'stderr truncado a 1MB' })
  stderr?: string;

  @ApiPropertyOptional({ description: 'Início da execução (ISO 8601)' })
  startedAt?: string;

  @ApiPropertyOptional({ description: 'Fim da execução (ISO 8601)' })
  finishedAt?: string;

  @ApiPropertyOptional({ description: 'Duração em ms' })
  durationMs?: number;
}

/**
 * DTO de resultado git após execution bem-sucedida.
 */
export class GitResultDto {
  @ApiPropertyOptional({ description: 'Commit hash antes da execution' })
  headBefore?: string;

  @ApiPropertyOptional({ description: 'Commit hash após a execution' })
  headAfter?: string;

  @ApiPropertyOptional({ description: 'Branch criada pela execution' })
  branch?: string;

  @ApiPropertyOptional({ description: 'Mensagem do commit' })
  commitMessage?: string;

  @ApiPropertyOptional({ description: 'Quantidade de arquivos alterados' })
  filesChanged?: number;
}

/**
 * DTO de Pull Request gerado pela execution (via DVFS chave=7).
 */
export class PullRequestDto {
  @ApiPropertyOptional({ description: 'URL do PR criado' })
  url?: string;

  @ApiPropertyOptional({ description: 'Número do PR' })
  number?: number;

  @ApiPropertyOptional({ description: 'Data/hora de abertura (ISO 8601)' })
  openedAt?: string;

  @ApiPropertyOptional({ description: 'Data/hora de rollback (ISO 8601)' })
  rolledBackAt?: string;

  @ApiPropertyOptional({ description: 'Commit hash do rollback' })
  rollbackRef?: string;
}

/**
 * DTO de resposta completo para uma Execution (DPedido idClasse=-301|-302|-303).
 *
 * Todos os BigInt são serializados como string (ADR-V2-025).
 * O campo riskLevel é derivado de idClasse (ADR-V2-006) — não de dados.risk.level.
 *
 * @example
 * ```json
 * {
 *   "id": "1000001",
 *   "riskLevel": "LOW",
 *   "projectId": "100",
 *   "approval": { "status": "approved", "approvedBy": "auto:risk-gate-low" },
 *   "command": { "text": "adicione testes unitários", "cwd": "src/auth" },
 *   "createdAt": "2026-05-09T10:00:00Z"
 * }
 * ```
 */
export class ExecutionResponseDto {
  /** ID da execution (DPedido.chave como string) */
  @ApiProperty({ description: 'ID da execution (BigInt como string)', example: '1000001' })
  id!: string;

  /** Nível de risco derivado de idClasse (ADR-V2-006) */
  @ApiProperty({
    description: 'Nível de risco (derivado de idClasse)',
    enum: ['LOW', 'MEDIUM', 'HIGH'],
    example: 'LOW',
  })
  riskLevel!: 'LOW' | 'MEDIUM' | 'HIGH';

  /** ID do projeto (DProject.chave como string) */
  @ApiProperty({ description: 'ID do projeto (BigInt como string)', example: '100' })
  projectId!: string;

  /** ID do usuário que disparou a execution */
  @ApiProperty({ description: 'ID do usuário que disparou (BigInt como string)', example: '42' })
  triggeredBy!: string;

  /** Status de aprovação */
  @ApiProperty({ type: ApprovalStatusDto })
  approval!: ApprovalStatusDto;

  /** Resumo do comando */
  @ApiProperty({ type: CommandSummaryDto })
  command!: CommandSummaryDto;

  /** Resultado da execução Claude (preenchido após execução) */
  @ApiPropertyOptional({ type: ClaudeResultDto })
  claude?: ClaudeResultDto;

  /** Resultado git (preenchido se exitCode=0 e houve mudanças) */
  @ApiPropertyOptional({ type: GitResultDto })
  git?: GitResultDto;

  /** Pull Request gerado (preenchido pelo DVFS chave=7) */
  @ApiPropertyOptional({ type: PullRequestDto })
  pullRequest?: PullRequestDto;

  /** Data/hora de criação (ISO 8601) */
  @ApiProperty({ description: 'Data/hora de criação', example: '2026-05-09T10:00:00.000Z' })
  createdAt!: string;

  /** Data/hora de última atualização (ISO 8601) */
  @ApiProperty({ description: 'Data/hora de atualização', example: '2026-05-09T10:00:05.000Z' })
  updatedAt!: string;
}

/**
 * Serializa um DPedido de execution em ExecutionResponseDto.
 * Extrai campos do Json dados e mapeia idClasse para riskLevel.
 *
 * @param pedido - Registro DPedido do banco (dados é Json do Prisma)
 * @returns ExecutionResponseDto formatado com BigInt como string
 */
export function serializeExecution(pedido: {
  chave: bigint;
  idClasse: bigint;
  idPessoa?: bigint | null;
  dados: unknown;
  criadoEm?: Date | null;
  atualizadoEm?: Date | null;
}): ExecutionResponseDto {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const dados = (pedido.dados ?? {}) as any;
  const idClasseStr = pedido.idClasse.toString();
  const riskLevel = RISK_CLASSE_MAP[idClasseStr] ?? 'LOW';

  return {
    id: pedido.chave.toString(),
    riskLevel,
    projectId: dados?.audit?.projectId ?? '',
    triggeredBy: dados?.audit?.triggeredBy ?? (pedido.idPessoa?.toString() ?? ''),
    approval: {
      status: dados?.approval?.status ?? 'queued',
      approvedBy: dados?.approval?.approvedBy,
      rejectedBy: dados?.approval?.rejectedBy,
      rejectedReason: dados?.approval?.rejectedReason,
      expiresAt: dados?.approval?.expiresAt,
      decidedAt: dados?.approval?.decidedAt,
    },
    command: {
      // fallback para dados.prompt (formato legado pré-V2) quando command.text ausente
      text: dados?.command?.text ?? dados?.prompt ?? '',
      executable: dados?.command?.executable,
      args: dados?.command?.args,
      cwd: dados?.command?.cwd,
      timeoutMs: dados?.command?.timeoutMs,
    },
    claude: dados?.claude,
    git: dados?.git,
    pullRequest: dados?.pullRequest,
    createdAt: pedido.criadoEm?.toISOString() ?? new Date().toISOString(),
    updatedAt: pedido.atualizadoEm?.toISOString() ?? new Date().toISOString(),
  };
}

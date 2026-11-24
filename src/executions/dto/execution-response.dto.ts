import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  EXECUTION_FAILURE_REASON_CODES,
  EXECUTION_PIPELINE_REASON_CODES,
  ExecutionFailureReason,
  isExecutionFailureReason,
} from '../constants/execution-lifecycle.const';

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

  @ApiPropertyOptional({ description: 'Branch da execução (modo esteira: scrumban/exec-<id>)' })
  branch?: string;

  @ApiPropertyOptional({
    description: 'Branch base do PR (config do projeto ou default do repo) — ADR-V2-083',
    nullable: true,
  })
  baseBranch?: string | null;

  @ApiPropertyOptional({ description: 'Commits da branch à frente da base (verificado pelo agente)' })
  commitsAhead?: number;

  @ApiPropertyOptional({ description: 'Branch publicada no remoto com o mesmo SHA (verificado)' })
  pushed?: boolean;

  @ApiPropertyOptional({ description: 'Data/hora do push verificado (ISO 8601)' })
  pushedAt?: string;

  @ApiPropertyOptional({ description: 'Mensagem do commit' })
  commitMessage?: string;

  @ApiPropertyOptional({ description: 'Quantidade de arquivos alterados' })
  filesChanged?: number;
}

/**
 * DTO de Pull Request da execution. ADR-V2-083: preenchido pelo callback com o
 * PR VERIFICADO pelo agente (`gh pr list --head <branch>`).
 */
export class PullRequestDto {
  @ApiPropertyOptional({ description: 'URL do PR criado' })
  url?: string;

  @ApiPropertyOptional({ description: 'Número do PR' })
  number?: number;

  @ApiPropertyOptional({ description: 'Estado no GitHub', enum: ['OPEN', 'CLOSED', 'MERGED'] })
  state?: string;

  @ApiPropertyOptional({ description: 'PR em rascunho (esteira não aprovou ⇒ rascunho)' })
  isDraft?: boolean;

  @ApiPropertyOptional({
    description: 'Quem abriu o PR: a esteira ou a rede de segurança do agente (sempre rascunho)',
    enum: ['pipeline', 'agent-fallback'],
  })
  openedBy?: 'pipeline' | 'agent-fallback';

  @ApiPropertyOptional({ description: 'Branch base do PR' })
  baseRefName?: string;

  @ApiPropertyOptional({ description: 'Data/hora de abertura (ISO 8601)' })
  openedAt?: string;

  @ApiPropertyOptional({ description: 'Data/hora de rollback (ISO 8601)' })
  rolledBackAt?: string;

  @ApiPropertyOptional({ description: 'Commit hash do rollback' })
  rollbackRef?: string;
}

/**
 * Padrão de risco casado pelo Risk Gate (ADR-V2-081).
 *
 * Contém apenas o regex e a fonte — NUNCA o trecho do prompt/comando casado
 * (evita vazar o prompt da task na resposta HTTP).
 */
export class RiskMatchedPatternDto {
  @ApiProperty({
    description: 'Regex (ou marcador engine:*) que disparou',
    example: '/\\bproduction\\b/i',
  })
  pattern!: string;

  @ApiProperty({ description: 'Nível associado ao padrão', enum: ['LOW', 'MEDIUM', 'HIGH'] })
  level!: string;

  @ApiPropertyOptional({
    description: 'Fonte onde o padrão casou (command | prompt | engine)',
    enum: ['command', 'prompt', 'engine'],
  })
  source?: string;
}

/**
 * Resumo do motivo da classificação de risco (ADR-V2-081).
 *
 * Insumo do frontend para o gestor entender POR QUE a execução aguarda
 * aprovação. Ausente em registros antigos sem `dados.risk`.
 *
 * @example
 * ```json
 * {
 *   "explanation": "Padrão de risco ALTO detectado (prompt): /.../",
 *   "matchedPatterns": [{ "pattern": "/.../", "level": "HIGH", "source": "prompt" }]
 * }
 * ```
 */
export class RiskSummaryDto {
  @ApiProperty({ description: 'Explicação legível da classificação de risco' })
  explanation!: string;

  @ApiProperty({ type: [RiskMatchedPatternDto] })
  matchedPatterns!: RiskMatchedPatternDto[];
}

/** Etapa da esteira (projeção segura). */
export class PipelineStageSummaryDto {
  @ApiProperty({ example: 'reviewer' })
  name!: string;

  @ApiProperty({ enum: ['done', 'skipped', 'failed'], example: 'done' })
  status!: string;
}

/**
 * Resultado da esteira headless (ADR-V2-083) — projeção SEGURA de
 * `dados.pipeline`. Expõe exigências, decisão, nota, etapas, resumo (≤2000
 * chars, já limitado no callback) e a contagem de subagents do runtime. Não
 * expõe `contractError`/`verifyError` (detalhe técnico do agente).
 *
 * @example
 * ```json
 * {
 *   "required": true, "prRequired": true, "taskType": "code", "mode": "pipeline",
 *   "decision": "APPROVED", "reviewScore": 9.0,
 *   "stages": [{ "name": "reviewer", "status": "done" }],
 *   "summary": "Endpoint X implementado.",
 *   "subagents": { "strategist": 1, "implementer": 1, "reviewer": 1, "documenter": 1 },
 *   "contractValid": true, "prOpenedBy": "pipeline", "reason": null
 * }
 * ```
 */
export class ExecutionPipelineDto {
  @ApiProperty({ description: 'Execução roda pela esteira do repo (/scrumban-executar)' })
  required!: boolean;

  @ApiProperty({ description: 'Sucesso exige PR verificado + APPROVED (code/docs)' })
  prRequired!: boolean;

  @ApiPropertyOptional({ enum: ['code', 'docs', 'research', 'validation', 'other'] })
  taskType?: string;

  @ApiPropertyOptional({ enum: ['pipeline', 'simple'], nullable: true })
  mode?: string | null;

  @ApiPropertyOptional({
    enum: ['APPROVED', 'NEEDS_CHANGES', 'REJECTED', 'NO_CHANGES', 'ABORTED'],
    nullable: true,
  })
  decision?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 9.0 })
  reviewScore?: number | null;

  @ApiPropertyOptional({ type: [PipelineStageSummaryDto] })
  stages?: PipelineStageSummaryDto[];

  @ApiPropertyOptional({ nullable: true, maxLength: 2000 })
  summary?: string | null;

  @ApiPropertyOptional({
    description: 'subagent_stats.by_type do runtime (fonte independente do modelo)',
    nullable: true,
    example: { strategist: 1, implementer: 1, reviewer: 1, documenter: 1 },
  })
  subagents?: Record<string, number> | null;

  @ApiPropertyOptional({ description: 'Saída estruturada válida (contrato v1)', nullable: true })
  contractValid?: boolean | null;

  @ApiPropertyOptional({ enum: ['pipeline', 'agent-fallback'], nullable: true })
  prOpenedBy?: string | null;

  @ApiPropertyOptional({
    description: 'Motivo canônico quando a política da esteira rebaixou o desfecho',
    enum: EXECUTION_PIPELINE_REASON_CODES,
    nullable: true,
  })
  reason?: string | null;
}

/**
 * Desfecho terminal da execução (ADR-V2-082, Ciclo 3) — projeção SEGURA de
 * `dados.audit.outcome`. Expõe só o código canônico e a origem; nunca
 * stderr/stdout, `supersedes` ou mensagens livres.
 *
 * - `source='system'` → falha marcada pelo sistema; `reason` ∈
 *   {@link EXECUTION_FAILURE_REASON_CODES} (valor fora da lista vira `null`).
 * - `source='agent'` → desfecho real reportado pelo agente; `reason` só
 *   quando a política da esteira rebaixou o desfecho (ADR-V2-083) e o código
 *   ∈ {@link EXECUTION_PIPELINE_REASON_CODES}; senão `null` (falha real: ver
 *   `claude.exitCode`).
 * - Sem desfecho ainda (fila/rodando/aguardando aprovação) → ambos `null`.
 * - Outcome legado sem `source` (gravado antes da ADR-V2-082, só pelo callback)
 *   → `source='agent'`.
 *
 * @example
 * ```json
 * { "reason": "TIMEOUT_NO_CALLBACK", "source": "system" }
 * ```
 */
export class ExecutionOutcomeDto {
  @ApiProperty({
    description:
      'Código canônico da falha marcada pelo sistema (null se não houver, ou se o desfecho veio do agente)',
    enum: EXECUTION_FAILURE_REASON_CODES,
    nullable: true,
    example: 'TIMEOUT_NO_CALLBACK',
  })
  reason!: ExecutionFailureReason | null;

  @ApiProperty({
    description: 'Origem do desfecho: agent (callback real) | system (sweeper/dispatch/backfill) | null (sem desfecho)',
    enum: ['agent', 'system'],
    nullable: true,
    example: 'system',
  })
  source!: 'agent' | 'system' | null;
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

  /** Resultado git (modo esteira: branch/base na criação; headAfter/commitsAhead no callback) */
  @ApiPropertyOptional({ type: GitResultDto })
  git?: GitResultDto;

  /** Pull Request VERIFICADO pelo agente (ADR-V2-083) */
  @ApiPropertyOptional({ type: PullRequestDto })
  pullRequest?: PullRequestDto;

  /** Resultado da esteira headless (ADR-V2-083) — ausente em execuções legadas/COMMAND. */
  @ApiPropertyOptional({ type: ExecutionPipelineDto })
  pipeline?: ExecutionPipelineDto;

  /**
   * Motivo da classificação de risco (ADR-V2-081) — explanation + padrões
   * casados com a fonte. Nunca contém o texto do prompt.
   */
  @ApiPropertyOptional({ type: RiskSummaryDto })
  risk?: RiskSummaryDto;

  /**
   * Desfecho terminal (ADR-V2-082, Ciclo 3): `{ reason, source }` — sempre
   * presente (ambos `null` enquanto não há desfecho). Ver {@link ExecutionOutcomeDto}.
   */
  @ApiProperty({ type: ExecutionOutcomeDto })
  outcome!: ExecutionOutcomeDto;

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
    git: toGit(dados?.git),
    pullRequest: toPullRequest(dados?.pullRequest),
    pipeline: toPipeline(dados?.pipeline),
    risk: toRiskSummary(dados?.risk),
    outcome: toOutcome(dados?.audit?.outcome),
    createdAt: pedido.criadoEm?.toISOString() ?? new Date().toISOString(),
    updatedAt: pedido.atualizadoEm?.toISOString() ?? new Date().toISOString(),
  };
}

/**
 * Projeta `dados.risk` em `RiskSummaryDto` copiando SOMENTE campos seguros
 * (explanation + pattern/level/source). Nunca ecoa o prompt (ADR-V2-081, R8).
 *
 * @param risk - `dados.risk` bruto do DPedido (Json)
 * @returns RiskSummaryDto ou undefined se ausente/malformado
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toRiskSummary(risk: any): RiskSummaryDto | undefined {
  if (!risk || typeof risk !== 'object' || typeof risk.explanation !== 'string') {
    return undefined;
  }
  const patterns: unknown[] = Array.isArray(risk.matchedPatterns) ? risk.matchedPatterns : [];
  return {
    explanation: risk.explanation,
    matchedPatterns: patterns
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .filter((p: any) => p && typeof p.pattern === 'string')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .map((p: any) => ({
        pattern: p.pattern,
        level: String(p.level ?? ''),
        ...(typeof p.source === 'string' ? { source: p.source } : {}),
      })),
  };
}

/**
 * Projeta `dados.audit.outcome` em {@link ExecutionOutcomeDto} (ADR-V2-082, Ciclo 3).
 * Whitelist: só `reason` canônico (com `source='system'`) e `source`; nada mais
 * do outcome (nem `supersedes`, `recordedAt`) nem do stderr é exposto.
 *
 * @param outcome - `dados.audit.outcome` bruto (Json)
 * @returns `{ reason, source }` (ambos `null` sem desfecho)
 */
export function toOutcome(outcome: unknown): ExecutionOutcomeDto {
  if (!outcome || typeof outcome !== 'object' || Array.isArray(outcome)) {
    return { reason: null, source: null };
  }
  const o = outcome as { source?: unknown; reason?: unknown };
  // Legado (pré-ADR-V2-082): só o callback do agente gravava outcome, sem `source`.
  const source: 'agent' | 'system' = o.source === 'system' ? 'system' : 'agent';
  // ADR-V2-083: desfecho do agente só expõe motivo da política da esteira.
  const allowed: readonly string[] =
    source === 'system' ? EXECUTION_FAILURE_REASON_CODES : EXECUTION_PIPELINE_REASON_CODES;
  const reason =
    isExecutionFailureReason(o.reason) && allowed.includes(o.reason) ? o.reason : null;
  return { reason, source };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyRecord = Record<string, any>;

function asRecord(v: unknown): AnyRecord | undefined {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as AnyRecord) : undefined;
}

function pick<T>(v: unknown, guard: (x: unknown) => boolean): T | undefined {
  return guard(v) ? (v as T) : undefined;
}

const isStr = (x: unknown): boolean => typeof x === 'string';
const isNum = (x: unknown): boolean => typeof x === 'number' && Number.isFinite(x);
const isBool = (x: unknown): boolean => typeof x === 'boolean';

/** Remove chaves `undefined` (resposta enxuta, igual ao spread antigo do Json). */
function compact<T extends AnyRecord>(o: T): T {
  return Object.fromEntries(Object.entries(o).filter(([, v]) => v !== undefined)) as T;
}

/**
 * Projeta `dados.git` (whitelist — ADR-V2-083). Campos legados preservados.
 *
 * @param git - `dados.git` bruto
 * @returns GitResultDto ou undefined
 */
export function toGit(git: unknown): GitResultDto | undefined {
  const g = asRecord(git);
  if (!g) return undefined;
  return compact({
    headBefore: pick<string>(g.headBefore, isStr),
    headAfter: pick<string>(g.headAfter, isStr),
    branch: pick<string>(g.branch, isStr),
    baseBranch: g.baseBranch === null ? null : pick<string>(g.baseBranch, isStr),
    commitsAhead: pick<number>(g.commitsAhead, isNum),
    pushed: pick<boolean>(g.pushed, isBool),
    pushedAt: pick<string>(g.pushedAt, isStr),
    commitMessage: pick<string>(g.commitMessage, isStr),
    filesChanged: pick<number>(g.filesChanged, isNum),
  });
}

/**
 * Projeta `dados.pullRequest` (whitelist — ADR-V2-083).
 *
 * @param pr - `dados.pullRequest` bruto
 * @returns PullRequestDto ou undefined
 */
export function toPullRequest(pr: unknown): PullRequestDto | undefined {
  const p = asRecord(pr);
  if (!p) return undefined;
  const openedBy = p.openedBy === 'pipeline' || p.openedBy === 'agent-fallback' ? p.openedBy : undefined;
  return compact({
    url: pick<string>(p.url, isStr),
    number: pick<number>(p.number, isNum),
    state: pick<string>(p.state, isStr),
    isDraft: pick<boolean>(p.isDraft, isBool),
    openedBy,
    baseRefName: pick<string>(p.baseRefName, isStr),
    openedAt: pick<string>(p.openedAt, isStr),
    rolledBackAt: pick<string>(p.rolledBackAt, isStr),
    rollbackRef: pick<string>(p.rollbackRef, isStr),
  });
}

/**
 * Projeta `dados.pipeline` em {@link ExecutionPipelineDto} (ADR-V2-083).
 * Não expõe `contractError`/`verifyError`/`declared.branch|commit|prUrl`
 * (o que vale é o verificado, já em `git`/`pullRequest`).
 *
 * @param pipeline - `dados.pipeline` bruto
 * @returns ExecutionPipelineDto ou undefined (execução sem esteira)
 */
export function toPipeline(pipeline: unknown): ExecutionPipelineDto | undefined {
  const p = asRecord(pipeline);
  if (!p) return undefined;
  const declared = asRecord(p.declared);
  const verified = asRecord(p.verified);
  const stagesRaw: unknown[] = Array.isArray(declared?.stages) ? declared!.stages : [];
  const stages = stagesRaw
    .map(asRecord)
    .filter((st): st is AnyRecord => !!st && isStr(st.name) && isStr(st.status))
    .slice(0, 10)
    .map((st) => ({ name: String(st.name).slice(0, 40), status: String(st.status) }));
  const subagentsRaw = asRecord(verified?.subagents);
  const subagents = subagentsRaw
    ? Object.fromEntries(
        Object.entries(subagentsRaw)
          .filter(([, v]) => isNum(v))
          .slice(0, 30),
      )
    : null;
  const reason =
    isExecutionFailureReason(p.reason) &&
    (EXECUTION_PIPELINE_REASON_CODES as readonly string[]).includes(p.reason)
      ? p.reason
      : null;
  return {
    required: p.required === true,
    prRequired: p.prRequired === true,
    ...(isStr(p.taskType) ? { taskType: p.taskType } : {}),
    mode: isStr(p.mode) ? p.mode : null,
    decision: isStr(p.decision) ? p.decision : null,
    reviewScore: isNum(p.reviewScore) ? p.reviewScore : null,
    stages,
    summary: isStr(declared?.summary) ? String(declared!.summary).slice(0, 2000) : null,
    subagents,
    contractValid: isBool(verified?.contractValid) ? verified!.contractValid : null,
    prOpenedBy: isStr(verified?.prOpenedBy) ? verified!.prOpenedBy : null,
    reason,
  };
}

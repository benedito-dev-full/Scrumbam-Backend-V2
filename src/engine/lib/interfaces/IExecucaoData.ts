/**
 * Tipagem dos campos que vão em DPedido.dados (Json) para uma Execution.
 * Todos os campos são opcionais exceto command — dados são preenchidos
 * progressivamente ao longo do workflow (calcula → aprova → grava → Claude → PR).
 *
 * @see docs/plano/02-DOMINIO-ENGINE.md §6.7
 */
export interface IExecucaoData {
  /** Comando solicitado (obrigatório — preenchido no constructor) */
  command: {
    /** O prompt/comando original enviado ao Claude */
    text: string;
    /** Executavel estruturado enviado ao agent */
    executable?: string;
    /** Args estruturados enviados ao agent */
    args?: string[];
    /** Working directory relativo ao project remotePath */
    cwd?: string;
    /** Variáveis de ambiente extras (sanitizadas) */
    env?: Record<string, string>;
    /** Timeout em ms (default: 600000 = 10min) */
    timeoutMs?: number;
  };

  /**
   * Prompt natural enviado ao Claude (ADR-V2-049).
   *
   * Quando preenchido, é a fonte ÚNICA do prompt — o processor
   * (`execution-run.processor.ts:resolvePrompt`) lê este campo
   * preferencialmente sobre `command.args[-p]`.
   *
   * Populado pelo `PromptBuilderService` quando `POST /projects/:id/execute`
   * recebe `taskId` no body (modo prompt). No modo legado (apenas `command`),
   * fica indefinido e o processor faz fallback para `command.args`.
   */
  prompt?: string;

  /**
   * Tipo da task que originou esta execução (ADR-V2-049).
   *
   * Valores canônicos V2: `'code' | 'docs' | 'research' | 'validation' | 'other'`.
   * Metadado de domínio — NÃO afeta workflow do Engine (Risk Gate continua
   * vencendo no `idClasse`, conforme ADR-V2-048).
   *
   * Persistido em `DPedido.dados.taskType` para audit/UI/relatórios.
   */
  taskType?: string;

  /** Lookup canonico de risco (-525/-526/-527) para UI/auditoria */
  riskLevelCode?: string;

  /** Lookup canonico de status de execution (-514..-522) */
  statusCode?: string;

  /** Dados usados para retorno idempotente de POST /execute */
  idempotency?: {
    key: string;
    userId: string;
    projectId: string;
  };

  /** Politica de rollback conservador em caso de falha */
  rollbackOnFailure?: boolean;

  /** Risk Gate — preenchido pelo script DVFS chave=3 em calcula() */
  risk?: {
    level: 'LOW' | 'MEDIUM' | 'HIGH';
    explanation: string;
    matchedPatterns: Array<{ pattern: string; level: string }>;
    classifiedAt: string; // ISO 8601
  };

  /** Approval Flow — gerenciado por OperacaoExecucaoClaude.aprova() e gravarComoAwaitingApproval() */
  approval?: {
    status: 'queued' | 'awaiting_approval' | 'approved' | 'rejected' | 'expired';
    approvedBy?: string; // entidadeId como string
    rejectedBy?: string;
    rejectedReason?: string;
    expiresAt?: string; // ISO 8601
    decidedAt?: string; // ISO 8601
  };

  /** Claude runtime — preenchido por _executarClaude() */
  claude?: {
    sessionId?: string;
    sessionPath?: string;
    stdout?: string; // truncado a 1MB
    stderr?: string; // truncado a 1MB
    exitCode?: number;
    startedAt?: string; // ISO 8601
    finishedAt?: string; // ISO 8601
    durationMs?: number;
  };

  /** Git workflow — preenchido após sucesso do Claude (exitCode=0 + mudanças detectadas) */
  git?: {
    headBefore?: string; // commit hash antes
    headAfter?: string; // commit hash após
    branch?: string; // scrumban/auto-<chave>
    commitMessage?: string;
    pushedAt?: string; // ISO 8601
    filesChanged?: number;
  };

  /** PR auto-open — preenchido pelo script DVFS chave=7 (pr-auto-open) */
  pullRequest?: {
    url?: string;
    number?: number;
    openedAt?: string; // ISO 8601
    rolledBackAt?: string; // ISO 8601 (se rollback)
    rollbackRef?: string; // commit hash do rollback
  };

  /** Vínculo task (opcional — se execution foi disparada a partir de uma task) */
  task?: {
    id?: string; // taskId como string
  };

  /** Audit trail — preenchido no constructor com dados iniciais */
  audit?: {
    correlationId: string;
    triggeredBy: string; // entidadeId do user como string
    agentId: string; // entidadeId do AGENT (-310) como string
    projectId: string; // projectId como string
  };
}

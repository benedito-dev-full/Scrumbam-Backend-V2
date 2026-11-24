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
    /**
     * Timeout em ms informado pelo caller (modo COMMAND/HÍBRIDO) ou placeholder
     * do modo PROMPT (1.800.000 ms). ESPELHO/legado: a fonte única de timeout
     * é `timeoutSec` (top-level), gravado na criação (ADR-V2-082).
     */
    timeoutMs?: number;
  };

  /**
   * Timeout efetivo da execução em segundos — FONTE ÚNICA (ADR-V2-082).
   * Gravado UMA vez por `ExecutionsService.execute` (clamp 30..3600, default 1800)
   * e lido pelo processor (enviado ao agente) e pelo sweeper de RUNNING (deadline).
   * Ausente em execuções legadas → fallback 1800.
   * ADR-V2-083: modo esteira grava default 14400 (4h), teto 21600 (6h).
   */
  timeoutSec?: number;

  /**
   * Estado de dispatch (ADR-V2-082) — preenchido quando o agente responde
   * 409 PROJECT_BUSY e a execução volta para a fila.
   */
  dispatch?: {
    busyAttempts: number;
    nextAttemptAt: string; // ISO 8601
    lastErrorCode: string;
    /** ISO do 1º 409 PROJECT_BUSY — base da espera POR TEMPO (ADR-V2-083 / P4). */
    firstBusyAt?: string;
  };

  /** Marcas de runtime gravadas pelo processor/sweeper (startedAt/finishedAt). */
  runtime?: {
    startedAt?: string;
    finishedAt?: string;
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

  /**
   * Risk Gate — preenchido pelo script DVFS chave=3 em calcula().
   *
   * Campos `source`, `scannedSources` e `validatorVersion` são opcionais
   * (retrocompat com registros/scripts v1). ADR-V2-081: o Engine eleva o
   * risco para no mínimo MEDIUM quando há `prompt` e `scannedSources` não
   * contém `'prompt'` (script DVFS desatualizado).
   */
  risk?: {
    level: 'LOW' | 'MEDIUM' | 'HIGH';
    explanation: string;
    /**
     * Padrões casados — somente o regex e a fonte, NUNCA o trecho do texto
     * (evita vazar o prompt na resposta HTTP). `source='engine'` indica
     * elevação feita pelo próprio Engine (guarda de contrato / piso de emergência).
     */
    matchedPatterns: Array<{
      pattern: string;
      level: string;
      source?: 'command' | 'prompt' | 'engine';
    }>;
    /** Fontes efetivamente varridas pelo validador (v2: `['command','prompt']`). */
    scannedSources?: string[];
    /** Versão do contrato do validador DVFS chave 3 (v2 = varre o prompt). */
    validatorVersion?: number;
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

  /**
   * Git workflow. ADR-V2-083: `branch` e `baseBranch` são decididos pelo
   * BACKEND na criação (modo esteira); `headAfter`/`commitsAhead`/`pushed`
   * vêm da verificação INDEPENDENTE do agente no callback.
   */
  git?: {
    headBefore?: string; // commit hash antes
    headAfter?: string; // commit hash após (HEAD da branch verificado pelo agente)
    branch?: string; // scrumban/exec-<chave> (modo esteira)
    /** Branch base do PR: `DProject.dados.automation.remoteBranch` ou default do repo (null = agente resolve). */
    baseBranch?: string | null;
    /** Commits da branch à frente da base (`git rev-list --count base..branch`). */
    commitsAhead?: number;
    /** Branch existe no remoto com o mesmo SHA (`git ls-remote`). */
    pushed?: boolean;
    commitMessage?: string;
    pushedAt?: string; // ISO 8601
    filesChanged?: number;
  };

  /**
   * Pull Request. ADR-V2-083: preenchido pelo callback com o PR VERIFICADO pelo
   * agente via `gh pr list` (não pela palavra do modelo). DVFS chave=7
   * (pr-auto-open) segue inerte no caminho do callback.
   */
  pullRequest?: {
    url?: string;
    number?: number;
    /** OPEN | CLOSED | MERGED (GitHub). */
    state?: string;
    /** PR em rascunho (P3: esteira não aprovada ⇒ rascunho). */
    isDraft?: boolean;
    /** Quem abriu: a esteira (`pipeline`) ou a rede de segurança do agente (`agent-fallback`). */
    openedBy?: 'pipeline' | 'agent-fallback';
    baseRefName?: string;
    headRefOid?: string;
    openedAt?: string; // ISO 8601
    rolledBackAt?: string; // ISO 8601 (se rollback)
    rollbackRef?: string; // commit hash do rollback
  };

  /** Modo esteira (ADR-V2-083) — exigências na criação + resultado no callback. */
  pipeline?: IExecucaoPipeline;

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
    /**
     * Sentinela de desfecho (ADR-V2-082) — disputada por CAS entre callback
     * do agente (`source='agent'`) e falha marcada pelo sistema (`source='system'`).
     * A verdade tardia (agent) substitui o desfecho sintético (system) uma única vez;
     * nesse caso `supersedes` guarda o desfecho substituído.
     */
    outcome?: IExecucaoOutcome;
    /** Categoria de erro reportada pelo agente ou motivo da falha sistêmica. */
    errorCode?: string;
    /** Sessão Claude anterior quando retomada via --resume. */
    resumedFrom?: string;
  };
}

/** Etapa declarada pela esteira (strategist|implementer|reviewer|documenter…). */
export interface IPipelineStage {
  name: string;
  status: 'done' | 'skipped' | 'failed';
}

/** Saída estruturada declarada pelo modelo (`structured_output`, contrato v1). */
export interface IPipelineDeclared {
  contractVersion: number;
  decision: 'APPROVED' | 'NEEDS_CHANGES' | 'REJECTED' | 'NO_CHANGES' | 'ABORTED';
  reviewScore: number | null;
  reviewFile?: string | null;
  stages: IPipelineStage[];
  branch: string | null;
  commit: string | null;
  prUrl: string | null;
  summary: string;
}

/** PR encontrado pelo agente via `gh pr list --head <branch>`. */
export interface IPipelineVerifiedPr {
  url: string;
  number: number;
  state: string;
  isDraft: boolean;
  baseRefName: string;
  headRefOid: string;
}

/** Verificação INDEPENDENTE feita pelo agente (git + gh + subagent_stats do runtime). */
export interface IPipelineVerified {
  branchExists: boolean;
  pushed: boolean;
  commitsAhead: number | null;
  headSha: string | null;
  baseBranch: string | null;
  pr: IPipelineVerifiedPr | null;
  prOpenedBy: 'pipeline' | 'agent-fallback' | null;
  /** `subagent_stats.by_type` do JSON final do CLI (null = runtime não reportou). */
  subagents: Record<string, number> | null;
  contractValid: boolean;
  contractError?: string | null;
  verifyError?: string | null;
}

/** Bloco `pipeline` do callback (ADR-V2-083). */
export interface IPipelineCallback {
  mode: 'pipeline' | 'simple';
  declared: IPipelineDeclared | null;
  verified: IPipelineVerified | null;
}

/**
 * `DPedido.dados.pipeline` (ADR-V2-083). Exigências gravadas na criação
 * (`required`, `prRequired`, `taskType`, `contractVersion`) + resultado
 * gravado pelo Engine no callback (`mode`, `declared`, `verified`, `decision`,
 * `reviewScore`, `reason`, `evaluatedAt`).
 */
export interface IExecucaoPipeline {
  /** true = execução roda pela esteira do repo (`/scrumban-executar`). */
  required: boolean;
  /** true = sucesso exige PR verificado + APPROVED (taskType code/docs). */
  prRequired: boolean;
  taskType?: string;
  contractVersion?: number;
  mode?: 'pipeline' | 'simple';
  declared?: IPipelineDeclared | null;
  verified?: IPipelineVerified | null;
  decision?: IPipelineDeclared['decision'] | null;
  reviewScore?: number | null;
  /** Motivo canônico quando a política rebaixou o desfecho. */
  reason?: string | null;
  evaluatedAt?: string;
}

/**
 * Desfecho terminal de uma execução (ADR-V2-082).
 */
export interface IExecucaoOutcome {
  success: boolean;
  recordedAt: string; // ISO 8601
  /** Quem gravou: callback real do agente ou o próprio sistema (sweeper/dispatch/backfill). */
  source?: 'agent' | 'system';
  /**
   * Motivo canônico (EXECUTION_FAILURE_REASONS). `source='system'`: TIMEOUT_NO_CALLBACK,
   * AGENT_RESTARTED, ... `source='agent'`: só motivos da política da esteira
   * (PIPELINE_* / PR_NOT_CREATED — ADR-V2-083).
   */
  reason?: string;
  /** Desfecho sintético substituído pelo callback tardio (no máximo 1 vez). */
  supersedes?: { reason?: string; recordedAt?: string };
}

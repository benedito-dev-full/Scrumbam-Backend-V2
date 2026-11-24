/**
 * Fluxo assíncrono do MODO ESTEIRA (ADR-V2-083) — roda depois do ACK 200.
 *
 * ```
 *  preflight (gh + token + origin) ─► base (config | origin/HEAD) ─► prepara branch
 *     │ falha: PIPELINE_PRECONDITION_FAILED     │ falha: BASE_BRANCH_NOT_FOUND
 *     ▼
 *  claude -p "/scrumban-executar <controle JSON>\n\n<envelope>"
 *         --append-system-prompt <contrato> --json-schema <schema>
 *     ▼
 *  parse (structured_output + subagent_stats) ─► verifica git (HEAD, à frente, push)
 *     ─► gh pr list ─► rede de segurança (P3): sem PR + commits ⇒ PR RASCUNHO
 *     ─► não aprovado ⇒ PR vira rascunho ─► payload do callback com `pipeline`
 * ```
 *
 * Nunca lança: toda falha vira `ExecutionResultPayload` com `errorCode`.
 * A DECISÃO de sucesso é do backend (Engine `avaliarDesfechoEsteira`); aqui
 * `success` continua sendo o do runtime (exit 0 + sessão + sem timeout).
 */
import { randomBytes } from 'node:crypto';
import type { Logger } from 'pino';
import {
  isApprovalVerified,
  PIPELINE_APPEND_SYSTEM_PROMPT,
  PIPELINE_RESULT_SCHEMA_JSON,
  parsePipelineOutput,
} from './pipeline-contract';
import { PIPELINE_COMMAND_NAME, checkPreconditions } from './pipeline-preflight';
import type { RunnerResult, runClaudeCode } from './runner';
import {
  computeSessionJsonlPath,
  findNewSessionIdFromFilesystem,
  parseClaudeOutput,
  snapshotSessionDir,
} from './session-parser';
import {
  findPr,
  markPrAsDraft,
  openDraftPr,
  PipelineGitError,
  prepareBranch,
  resolveBaseBranch,
  verifyBranch,
  type GitExec,
  type VerifiedPr,
} from '../git/pipeline-git';
import type { ExecutionPipelinePayload, ExecutionResultPayload } from '../outbound/backend-client';
import type { Redactor } from '../security/redact';

/** Exigências da esteira recebidas no payload RUN_CLAUDE_CODE. */
export interface PipelineRequest {
  required: boolean;
  prRequired: boolean;
  taskType: string;
}

/** Git recebido no payload (o backend decide a branch). */
export interface GitRequest {
  branch: string;
  baseBranch: string | null;
}

/**
 * Entrada da esteira headless (ADR-V2-083): uma execução, já validada pelo handler.
 *
 * `resumeSessionId` é null em execução nova; `maxBudgetUsd` fica ausente enquanto
 * o teto não é medido (decisão P-custo). `prFallback` liga a rede de segurança P3
 * (commit sem PR vira PR rascunho com `prOpenedBy='agent-fallback'`).
 */
export interface PipelineFlowInput {
  executionId: string;
  prompt: string;
  resumeSessionId: string | null;
  timeoutSec: number;
  git: GitRequest;
  pipeline: PipelineRequest;
  cwd: string;
  maxBudgetUsd?: number;
  prFallback: boolean;
}

/**
 * Dependências injetáveis da esteira (exec git, runner do claude, snapshot de
 * sessão, logger). Existe para teste: produção usa as implementações reais.
 */
export interface PipelineFlowDeps {
  logger: Logger;
  exec: GitExec;
  env: NodeJS.ProcessEnv;
  runImpl: typeof runClaudeCode;
  snapshotImpl: typeof snapshotSessionDir;
  fallbackImpl: typeof findNewSessionIdFromFilesystem;
  /** Trunca para o limite do callback — chamado SEMPRE depois de `redact` (Ciclo 2 / M3). */
  truncate: (s: string) => string;
  /** Troca valores de segredos (GITHUB_TOKEN, …) por [REDACTED] (Ciclo 2 / M3). */
  redact: Redactor;
}

const MAX_NOTE = 300;

/** Marcador do bloco de dado não confiável (envelope da task) — Ciclo 2 / M5. */
export const UNTRUSTED_MARKER = 'DADO-NAO-CONFIAVEL';

/**
 * Neutraliza, DENTRO do texto livre da task, qualquer coisa que imite o bloco
 * de controle ou o comando (Ciclo 2 / M5; normalização Unicode no Ciclo 3 / N3). O texto vem de título/descrição
 * digitados por usuários — é dado, não instrução.
 *
 * @param envelope - Envelope renderizado pelo backend
 * @returns Envelope com marcadores de controle neutralizados
 */
export function neutralizeEnvelope(envelope: string): string {
  // Ciclo 3 / N3: normaliza ANTES dos regex — NFKC desfaz formas de largura
  // total/compatibilidade (ex.: letras fullwidth), \p{Cf} remove invisíveis de
  // formatação (zero-width, BOM, marcas bidi) e \p{Zs} vira espaço comum (NBSP,
  // espaços finos). Sem isso, "CONTROLE<zero-width>-SCRUMBAN" escaparia.
  const normalized = envelope.normalize('NFKC').replace(/\p{Cf}/gu, '').replace(/\p{Zs}/gu, ' ');
  return normalized
    .replace(/CONTROLE[\s_-]*SCRUMBAN/gi, '[marcador de controle removido do texto da task]')
    .replace(new RegExp(UNTRUSTED_MARKER, 'gi'), '[marcador removido]')
    .replace(/^([ \t]*)\/scrumban-executar\b/gim, '$1[comando removido do texto da task]');
}

/**
 * Monta o prompt final: comando do repo + bloco de controle JSON (CONFIÁVEL,
 * gerado pelo agente) + envelope do backend dentro de um bloco de DADO NÃO
 * CONFIÁVEL delimitado por um nonce aleatório (o texto da task não consegue
 * "fechar" o bloco nem forjar outro controle) — Ciclo 2 / M5.
 *
 * @param input - executionId, branch, base resolvida, exigências, envelope e nonce (testes)
 * @returns Prompt para `-p`
 */
export function buildPipelinePrompt(input: {
  executionId: string;
  branch: string;
  baseBranch: string;
  pipeline: PipelineRequest;
  envelope: string;
  nonce?: string;
}): string {
  const control = {
    contractVersion: 1,
    executionId: input.executionId,
    branch: input.branch,
    baseBranch: input.baseBranch,
    taskType: input.pipeline.taskType,
    prRequired: input.pipeline.prRequired,
  };
  const nonce = input.nonce ?? randomBytes(8).toString('hex');
  return [
    `/${PIPELINE_COMMAND_NAME} CONTROLE-SCRUMBAN v1`,
    '```json',
    JSON.stringify(control, null, 2),
    '```',
    '',
    `<<<${UNTRUSTED_MARKER} id=${nonce}`,
    neutralizeEnvelope(input.envelope),
    `${UNTRUSTED_MARKER} id=${nonce}>>>`,
  ].join('\n');
}

/**
 * Junta observações e corta em {@link MAX_NOTE} — REDIGINDO ANTES do corte
 * (Ciclo 3 / N2: cortar antes deixaria o prefixo de um token escapar da redação).
 */
function note(redact: Redactor, ...parts: Array<string | null | undefined>): string | null {
  const s = parts.filter((p): p is string => typeof p === 'string' && p.length > 0).join('; ');
  return s.length > 0 ? redact(s).slice(0, MAX_NOTE) : null;
}

function errText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

function failurePayload(
  input: PipelineFlowInput,
  errorCode: string,
  message: string,
): ExecutionResultPayload {
  return {
    executionId: input.executionId,
    exitCode: -1,
    success: false,
    durationMs: 0,
    claudeSessionId: null,
    claudeSessionPath: null,
    resumedFrom: input.resumeSessionId,
    stdoutTruncated: '',
    stderrTruncated: message,
    errorCode,
    pipeline: { mode: 'pipeline', declared: null, verified: null },
  };
}

/**
 * Executa o modo esteira de ponta a ponta e devolve o payload do callback.
 *
 * @param input - Dados validados do payload + cwd
 * @param deps - Executor git/gh, runner, parsers, logger
 * @returns Payload do `execution-result` (com bloco `pipeline`)
 */
export async function runPipelineFlow(
  input: PipelineFlowInput,
  deps: PipelineFlowDeps,
): Promise<ExecutionResultPayload> {
  const { logger, exec, redact } = deps;

  // 1. Pré-condições (gh, token, origin)
  const pre = await checkPreconditions({ cwd: input.cwd, env: deps.env, exec });
  if (!pre.ok) {
    logger.error({ reason: redact(pre.message) }, 'esteira: pre-condicao ausente');
    return failurePayload(input, 'PIPELINE_PRECONDITION_FAILED', redact(pre.message));
  }

  // 2. Base + 3. branch
  let base: string;
  try {
    base = await resolveBaseBranch(exec, input.cwd, input.git.baseBranch);
    const prep = await prepareBranch(exec, {
      cwd: input.cwd,
      branch: input.git.branch,
      base,
      executionId: input.executionId,
      resume: input.resumeSessionId !== null,
    });
    if (prep.stashed) logger.warn('esteira: sobras do clone guardadas em stash nomeado');
  } catch (err) {
    const code = err instanceof PipelineGitError ? err.code : 'PIPELINE_PRECONDITION_FAILED';
    // M3: stderr do git pode conter a URL autenticada (https://x-access-token:<token>@…)
    // N2: redige o texto INTEIRO e só então corta.
    const message = deps.truncate(redact(errText(err)));
    logger.error({ errorCode: code, err: message.slice(0, 1000) }, 'esteira: preparo do git falhou');
    return failurePayload(input, code, message);
  }

  // 4. Executa a esteira do repo
  const beforeFiles = deps.snapshotImpl(input.cwd);
  const prompt = buildPipelinePrompt({
    executionId: input.executionId,
    branch: input.git.branch,
    baseBranch: base,
    pipeline: input.pipeline,
    envelope: input.prompt,
  });
  let run: RunnerResult;
  try {
    run = await deps.runImpl({
      prompt,
      cwd: input.cwd,
      resumeSessionId: input.resumeSessionId,
      timeoutSec: input.timeoutSec,
      appendSystemPrompt: PIPELINE_APPEND_SYSTEM_PROMPT,
      jsonSchema: PIPELINE_RESULT_SCHEMA_JSON,
      excludeDynamicSections: true,
      maxBudgetUsd: input.maxBudgetUsd,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    run = { stdout: '', stderr: message, exitCode: -1, signal: null, timedOut: false, durationMs: 0 };
  }

  // 5. Sessão (mesma regra do modo simples)
  let claudeSessionId: string | null = null;
  let claudeSessionPath: string | null = null;
  let errorCode: string | undefined;
  let rawJson: Record<string, unknown> | null = null;
  // Ciclo 3 / N1: redige o stdout BRUTO antes do parse — `structured_output`
  // (summary, prUrl, …) já nasce limpo e pode ir para o corpo do PR no GitHub.
  // Tokens são [A-Za-z0-9_-]: a troca por "[REDACTED]" mantém o JSON válido.
  const safeStdout = redact(run.stdout);
  try {
    const parsed = parseClaudeOutput(safeStdout);
    claudeSessionId = parsed.sessionId;
    claudeSessionPath = computeSessionJsonlPath(input.cwd, parsed.sessionId);
    rawJson = parsed.raw;
    if (parsed.isError) logger.warn({ terminalReason: parsed.terminalReason }, 'claude is_error=true');
  } catch {
    const fb = deps.fallbackImpl(input.cwd, beforeFiles);
    if (fb !== null) {
      claudeSessionId = fb;
      claudeSessionPath = computeSessionJsonlPath(input.cwd, fb);
    } else {
      errorCode = 'SESSION_ID_EXTRACTION_FAILED';
    }
  }
  if (run.timedOut) errorCode = 'TIMEOUT';

  // 6. Contrato (o que o modelo DISSE) + subagents (o que o runtime REGISTROU)
  const contract = parsePipelineOutput(rawJson);

  // 7. Verificação independente (git + GitHub)
  let verifyError: string | null = null;
  const vb = await verifyBranch(exec, { cwd: input.cwd, branch: input.git.branch, base });
  let pr: VerifiedPr | null = null;
  try {
    pr = await findPr(exec, { cwd: input.cwd, branch: input.git.branch });
  } catch (err) {
    verifyError = note(redact, verifyError, `gh pr list falhou: ${errText(err)}`);
  }
  let prOpenedBy: 'pipeline' | 'agent-fallback' | null = pr ? 'pipeline' : null;
  let pushed = vb.pushed;

  // 8. Rede de segurança (P3): commits sem PR ⇒ PR em RASCUNHO pelo agente
  if (!pr && input.prFallback && vb.branchExists && (vb.commitsAhead ?? 0) > 0) {
    try {
      await openDraftPr(exec, {
        cwd: input.cwd,
        branch: input.git.branch,
        base,
        pushed: vb.pushed,
        // N1: tudo que vai para o GitHub (título/corpo do PR) passa pelo redator.
        title: redact(`scrumban: execução ${input.executionId} (rascunho — revisar)`),
        body: redact(
          [
            'PR aberto pela rede de segurança do agente Scrumban (a esteira não abriu o PR).',
            'Rascunho: NÃO mergear sem revisão.',
            '',
            contract.declared?.summary ?? '(sem resumo da esteira)',
          ].join('\n'),
        ),
      });
      pushed = true;
      pr = await findPr(exec, { cwd: input.cwd, branch: input.git.branch });
      prOpenedBy = pr ? 'agent-fallback' : null;
    } catch (err) {
      verifyError = note(redact, verifyError, `fallback de PR falhou: ${errText(err)}`);
    }
  }

  // 9. Nada mergeável por engano (P3): sem aprovação verificável ⇒ PR rascunho.
  //    Mesma regra do Engine (Ciclo 2 / M1): prRequired exige reviewer E implementer.
  const approvedLocally = isApprovalVerified(contract, input.pipeline.prRequired);
  if (pr && pr.state === 'OPEN' && !pr.isDraft && !approvedLocally) {
    try {
      await markPrAsDraft(exec, { cwd: input.cwd, number: pr.number });
      pr = { ...pr, isDraft: true };
    } catch (err) {
      verifyError = note(redact, verifyError, `converter PR em rascunho falhou: ${errText(err)}`);
    }
  }

  // Revalida o push depois do fallback (o SHA remoto precisa bater)
  const finalVb = pushed && !vb.pushed ? await verifyBranch(exec, { cwd: input.cwd, branch: input.git.branch, base }) : vb;

  const pipeline: ExecutionPipelinePayload = {
    mode: 'pipeline',
    declared: contract.declared,
    verified: {
      branchExists: finalVb.branchExists,
      pushed: finalVb.pushed,
      commitsAhead: finalVb.commitsAhead,
      headSha: finalVb.headSha,
      baseBranch: base,
      pr,
      prOpenedBy,
      subagents: contract.subagents,
      contractValid: contract.contractValid,
      contractError: contract.contractError,
      verifyError: note(redact, verifyError, contract.runtimeNotes),
    },
  };

  const success = run.exitCode === 0 && claudeSessionId !== null && errorCode === undefined && !run.timedOut;
  logger.info(
    {
      success,
      decision: contract.declared?.decision ?? null,
      contractValid: contract.contractValid,
      prUrl: pr?.url ?? null,
      prOpenedBy,
      subagents: contract.subagents,
    },
    'esteira: verificacao concluida',
  );

  return {
    executionId: input.executionId,
    exitCode: run.exitCode ?? -1,
    success,
    durationMs: run.durationMs,
    claudeSessionId,
    claudeSessionPath,
    resumedFrom: input.resumeSessionId,
    stdoutTruncated: deps.truncate(safeStdout),
    stderrTruncated: deps.truncate(redact(run.stderr)),
    ...(errorCode !== undefined ? { errorCode } : {}),
    pipeline,
  };
}

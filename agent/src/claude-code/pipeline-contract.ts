/**
 * Contrato da esteira headless (ADR-V2-083) — lado agente.
 *
 * Três peças, FONTE ÚNICA (o template `agent/templates/pipeline-result.schema.json`
 * é espelho verificado por teste anti-drift):
 *
 *  1. {@link PIPELINE_RESULT_SCHEMA} — JSON Schema passado ao CLI via
 *     `--json-schema`. O `claude -p` passa a terminar com `structured_output`
 *     validado contra ele (verificado no CLI 2.1.330).
 *  2. {@link PIPELINE_APPEND_SYSTEM_PROMPT} — contrato CURTO e FIXO passado via
 *     `--append-system-prompt` (acrescenta ao prompt padrão do Claude Code; o
 *     `--system-prompt` antigo SUBSTITUÍA o prompt padrão). Fixo = cacheável e
 *     idêntico entre task real e warm (paridade ADR-V2-046).
 *  3. {@link parsePipelineOutput} — lê `structured_output` (o que o modelo
 *     DISSE) e `subagent_stats` (o que o RUNTIME registrou — fonte independente)
 *     do JSON final do CLI, sanitizando para os mesmos limites do DTO do backend
 *     (um campo fora do limite viraria 400 e o resultado de horas se perderia).
 *
 * @see docs/decisions/ADR-V2-083-esteira-headless-contrato-verificavel.md
 * @see src/automation/agents/dto/execution-pipeline-result.dto.ts (backend)
 */

/** Versão do contrato de saída. Backend aceita só `1`. */
export const PIPELINE_CONTRACT_VERSION = 1;

/** Decisões possíveis da esteira. */
export const PIPELINE_DECISIONS = [
  'APPROVED',
  'NEEDS_CHANGES',
  'REJECTED',
  'NO_CHANGES',
  'ABORTED',
] as const;
/** Uma das decisões de `PIPELINE_DECISIONS` (união literal, derivada da lista). */
export type PipelineDecision = (typeof PIPELINE_DECISIONS)[number];

const STAGE_STATUSES = ['done', 'skipped', 'failed'] as const;

/** Limites — iguais aos do DTO do backend (`execution-pipeline-result.dto.ts`). */
export const PIPELINE_LIMITS = {
  summary: 2000,
  reviewFile: 300,
  stages: 10,
  stageName: 40,
  branch: 200,
  commit: 64,
  prUrl: 500,
  subagentKeys: 30,
  error: 300,
} as const;

/**
 * JSON Schema do resultado final da esteira (contrato v1).
 * Mudança aqui = bump de `contractVersion` + ADR + backend aceitar a versão nova.
 */
export const PIPELINE_RESULT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: [
    'contractVersion',
    'decision',
    'reviewScore',
    'stages',
    'branch',
    'commit',
    'prUrl',
    'summary',
  ],
  properties: {
    contractVersion: { type: 'integer', const: PIPELINE_CONTRACT_VERSION },
    decision: { type: 'string', enum: [...PIPELINE_DECISIONS] },
    reviewScore: { type: ['number', 'null'], minimum: 0, maximum: 10 },
    reviewFile: { type: ['string', 'null'], maxLength: PIPELINE_LIMITS.reviewFile },
    stages: {
      type: 'array',
      maxItems: PIPELINE_LIMITS.stages,
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'status'],
        properties: {
          name: { type: 'string', maxLength: PIPELINE_LIMITS.stageName },
          status: { type: 'string', enum: [...STAGE_STATUSES] },
        },
      },
    },
    branch: { type: ['string', 'null'], maxLength: PIPELINE_LIMITS.branch },
    commit: { type: ['string', 'null'], maxLength: PIPELINE_LIMITS.commit },
    prUrl: { type: ['string', 'null'], maxLength: PIPELINE_LIMITS.prUrl },
    summary: { type: 'string', maxLength: PIPELINE_LIMITS.summary },
  },
} as const;

/** Schema serializado (argv de `--json-schema`). Estável byte-a-byte (cache). */
export const PIPELINE_RESULT_SCHEMA_JSON = JSON.stringify(PIPELINE_RESULT_SCHEMA);

/**
 * Contrato curto anexado ao system prompt padrão (`--append-system-prompt`).
 * NÃO contém o mapa de slugs nem regras de git do CLAUDE.md global — o
 * CLAUDE.md do REPO e os `.claude/agents` são carregados pelo próprio CLI em
 * `-p` (verificado). Texto fixo: qualquer mudança invalida o cache do prefixo.
 */
export const PIPELINE_APPEND_SYSTEM_PROMPT = [
  '[Scrumban VPS — execução headless, sem humano na sessão]',
  '- Nunca faça perguntas nem espere confirmação: decida com bom senso e registre a decisão no resumo.',
  '- Trabalhe somente na branch indicada no bloco de controle; não troque de branch, não faça merge e não reescreva histórico.',
  '- Rode cada subagente em primeiro plano (foreground) e aguarde o término antes de seguir.',
  `- Ao final, responda somente com a saída estruturada do contrato (contractVersion ${PIPELINE_CONTRACT_VERSION}).`,
].join('\n');

/** Etapa declarada. */
export interface PipelineStage {
  name: string;
  status: (typeof STAGE_STATUSES)[number];
}

/** Saída declarada pelo modelo (sanitizada). */
export interface PipelineDeclared {
  contractVersion: number;
  decision: PipelineDecision;
  reviewScore: number | null;
  reviewFile?: string | null;
  stages: PipelineStage[];
  branch: string | null;
  commit: string | null;
  prUrl: string | null;
  summary: string;
}

/** Resultado do parse do JSON final do CLI. */
export interface ParsedPipelineOutput {
  declared: PipelineDeclared | null;
  contractValid: boolean;
  contractError: string | null;
  /** `subagent_stats.by_type` sanitizado (null = runtime não reportou). */
  subagents: Record<string, number> | null;
  /** Observações do runtime (subagent em background, falhas) — informativo. */
  runtimeNotes: string | null;
}

const SUBAGENT_NAME_RE = /^[A-Za-z0-9._:-]{1,80}$/;

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

function clip(s: string, max: number): string {
  return s.length > max ? s.slice(0, max) : s;
}

function nullableString(v: unknown, max: number): string | null | undefined {
  if (v === null) return null;
  if (typeof v === 'string') return clip(v, max);
  return undefined; // inválido
}

/**
 * Valida/sanitiza `structured_output` contra o contrato v1.
 *
 * @param so - Valor bruto de `structured_output`
 * @returns `{ declared }` ou `{ error }`
 */
export function validateDeclared(so: unknown): { declared: PipelineDeclared } | { error: string } {
  if (!isRecord(so)) return { error: 'structured_output ausente (esteira não respondeu no contrato)' };
  if (so.contractVersion !== PIPELINE_CONTRACT_VERSION) {
    return { error: `contractVersion desconhecida: ${JSON.stringify(so.contractVersion)}` };
  }
  if (typeof so.decision !== 'string' || !(PIPELINE_DECISIONS as readonly string[]).includes(so.decision)) {
    return { error: `decision inválida: ${JSON.stringify(so.decision)}` };
  }
  let reviewScore: number | null;
  if (so.reviewScore === null || so.reviewScore === undefined) reviewScore = null;
  else if (typeof so.reviewScore === 'number' && so.reviewScore >= 0 && so.reviewScore <= 10) {
    reviewScore = so.reviewScore;
  } else return { error: 'reviewScore fora de 0..10' };

  if (!Array.isArray(so.stages)) return { error: 'stages ausente' };
  const stages: PipelineStage[] = [];
  for (const raw of so.stages.slice(0, PIPELINE_LIMITS.stages)) {
    if (
      !isRecord(raw) ||
      typeof raw.name !== 'string' ||
      typeof raw.status !== 'string' ||
      !(STAGE_STATUSES as readonly string[]).includes(raw.status)
    ) {
      return { error: 'stage inválida' };
    }
    stages.push({
      name: clip(raw.name, PIPELINE_LIMITS.stageName),
      status: raw.status as PipelineStage['status'],
    });
  }

  const branch = nullableString(so.branch ?? null, PIPELINE_LIMITS.branch);
  const commit = nullableString(so.commit ?? null, PIPELINE_LIMITS.commit);
  const prUrl = nullableString(so.prUrl ?? null, PIPELINE_LIMITS.prUrl);
  const reviewFile = nullableString(so.reviewFile ?? null, PIPELINE_LIMITS.reviewFile);
  if (branch === undefined || commit === undefined || prUrl === undefined || reviewFile === undefined) {
    return { error: 'branch/commit/prUrl/reviewFile com tipo inválido' };
  }
  if (typeof so.summary !== 'string') return { error: 'summary ausente' };

  return {
    declared: {
      contractVersion: PIPELINE_CONTRACT_VERSION,
      decision: so.decision as PipelineDecision,
      reviewScore,
      reviewFile,
      stages,
      branch,
      commit,
      prUrl,
      summary: clip(so.summary, PIPELINE_LIMITS.summary),
    },
  };
}

/**
 * Sanitiza `subagent_stats.by_type` (nomes seguros, contagens inteiras ≥ 0, ≤ 30 chaves).
 *
 * @param stats - Valor bruto de `subagent_stats`
 * @returns Mapa ou null (ausente)
 */
export function extractSubagents(stats: unknown): Record<string, number> | null {
  if (!isRecord(stats) || !isRecord(stats.by_type)) return null;
  const out: Record<string, number> = {};
  for (const [k, v] of Object.entries(stats.by_type).slice(0, PIPELINE_LIMITS.subagentKeys)) {
    if (SUBAGENT_NAME_RE.test(k) && typeof v === 'number' && Number.isInteger(v) && v >= 0) {
      out[k] = Math.min(v, 1000);
    }
  }
  return out;
}

/**
 * Lê o JSON final do `claude -p --output-format json --json-schema …`.
 *
 * @param raw - Objeto JSON do stdout (ou null se o stdout não era JSON)
 * @returns Declarado (ou null + erro) + subagents do runtime
 *
 * @example
 *   const p = parsePipelineOutput(JSON.parse(stdout));
 *   if (!p.contractValid) log.warn(p.contractError);
 */
export function parsePipelineOutput(raw: Record<string, unknown> | null): ParsedPipelineOutput {
  if (!raw) {
    return {
      declared: null,
      contractValid: false,
      contractError: 'stdout do claude não é JSON',
      subagents: null,
      runtimeNotes: null,
    };
  }
  const subagents = extractSubagents(raw.subagent_stats);
  const notes: string[] = [];
  const stats = isRecord(raw.subagent_stats) ? raw.subagent_stats : null;
  if (stats) {
    const bg = stats.started_in_background;
    const failed = stats.failed;
    if (typeof bg === 'number' && bg > 0) notes.push(`${bg} subagente(s) em background`);
    if (typeof failed === 'number' && failed > 0) notes.push(`${failed} subagente(s) falharam`);
  }
  const v = validateDeclared(raw.structured_output);
  return {
    declared: 'declared' in v ? v.declared : null,
    contractValid: 'declared' in v,
    contractError: 'error' in v ? clip(v.error, PIPELINE_LIMITS.error) : null,
    subagents,
    runtimeNotes: notes.length > 0 ? notes.join('; ') : null,
  };
}

/**
 * A aprovação da esteira é VERIFICÁVEL pelo runtime? (ADR-V2-083 — Ciclo 2 / M1+M2)
 *
 * ESPELHO da política do Engine (`OperacaoExecucaoClaude.avaliarDesfechoEsteira`):
 *  - contrato válido + `decision=APPROVED`;
 *  - `prRequired` (code/docs): `subagent_stats.by_type` com `reviewer>0` E `implementer>0`;
 *  - sem `prRequired`: ao menos 1 subagente com contagem > 0.
 * Usada no passo "nada mergeável por engano": se falso, o PR aberto vira rascunho.
 * Teste de paridade em `__tests__/pipeline-contract.spec.ts` replica a tabela do Engine.
 *
 * @param contract - Resultado de {@link parsePipelineOutput}
 * @param prRequired - Exigência do tipo da task
 * @returns true só quando o backend também consideraria a aprovação verificada
 */
export function isApprovalVerified(
  contract: Pick<ParsedPipelineOutput, 'contractValid' | 'declared' | 'subagents'>,
  prRequired: boolean,
): boolean {
  if (!contract.contractValid || contract.declared?.decision !== 'APPROVED') return false;
  const subagents = contract.subagents;
  if (!subagents) return false;
  if (prRequired) return (subagents.reviewer ?? 0) > 0 && (subagents.implementer ?? 0) > 0;
  return Object.values(subagents).some((n) => n > 0);
}

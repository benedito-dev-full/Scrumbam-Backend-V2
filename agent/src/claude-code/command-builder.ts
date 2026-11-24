/**
 * Único call-site da montagem do argv para o CLI `claude`.
 *
 * **Por que existe:** o Cache Warmer depende de PARIDADE do prefixo cacheável
 * entre uma execução real (`run-claude-code.handler.ts`) e um warm
 * (`warm-cache.handler.ts`). Ambos chamam ESTA função com as MESMAS flags de
 * sessão ({@link pipelineSessionFlags}); specs de snapshot em
 * `command-builder.spec.ts` validam a ordem.
 *
 * **ADR-V2-083 (re-baseline da ADR-V2-046):**
 *  - `--system-prompt` SAIU. Ele SUBSTITUÍA o prompt padrão do Claude Code pelo
 *    CLAUDE.md global (mapa de slugs). Em `-p` o CLI já carrega o CLAUDE.md do
 *    REPO, as rules ancestrais, `~/.claude/CLAUDE.md` e os `.claude/agents`
 *    (verificado no CLI 2.1.330). O prefixo cacheável passa a ser
 *    "prompt padrão + CLAUDE.md do repo + contrato fixo" — varia por projeto,
 *    o que o warmer já respeita (aquece por slug, no cwd do projeto).
 *  - `--append-system-prompt <contrato curto fixo>` + `--json-schema <schema>`
 *    + `--exclude-dynamic-system-prompt-sections` (melhora o reuso do cache).
 *  - NUNCA `--bare`: pula hooks E CLAUDE.md (mataria a esteira).
 *
 * **Função pura, ZERO side-effects.**
 */

/** Input do builder. Subset estável das opções que afetam o argv do CLI. */
export interface BuildClaudeArgsInput {
  /** Prompt da tarefa (vai como `-p <prompt>`). Obrigatório. */
  prompt: string;
  /**
   * Texto anexado ao system prompt padrão (`--append-system-prompt`).
   * Undefined/vazio ⇒ flag omitida (modo simples/legado).
   */
  appendSystemPrompt?: string;
  /** JSON Schema serializado (`--json-schema`). Undefined/vazio ⇒ omitida. */
  jsonSchema?: string;
  /** Adiciona `--exclude-dynamic-system-prompt-sections` (reuso de cache). */
  excludeDynamicSections?: boolean;
  /** Teto de custo da sessão (`--max-budget-usd`). Undefined ⇒ sem teto (P2: desligado no início). */
  maxBudgetUsd?: number;
  /** Session id para `--resume <id>`. Warmer NUNCA passa. */
  resumeSessionId?: string | null;
  /** Flags extras no FINAL do argv (warmer: `--permission-mode=plan --max-turns=1`). */
  extraFlags?: string[];
}

export interface BuildClaudeArgsResult {
  /** Argv pronto para `spawn(CLAUDE_BINARY, args, ...)`. */
  args: string[];
}

/**
 * Flags de SESSÃO do modo esteira — as mesmas para task real e warm
 * (paridade ADR-V2-046 re-baselinada pela ADR-V2-083).
 *
 * @param contract - `{ appendSystemPrompt, jsonSchema }` do `pipeline-contract`
 * @returns Fragmento de {@link BuildClaudeArgsInput}
 */
export function pipelineSessionFlags(contract: {
  appendSystemPrompt: string;
  jsonSchema: string;
}): Pick<BuildClaudeArgsInput, 'appendSystemPrompt' | 'jsonSchema' | 'excludeDynamicSections'> {
  return {
    appendSystemPrompt: contract.appendSystemPrompt,
    jsonSchema: contract.jsonSchema,
    excludeDynamicSections: true,
  };
}

/**
 * Constrói o argv canônico do CLI `claude`.
 *
 * **Ordem garantida (snapshot-tested):**
 *   1. `--append-system-prompt <texto>`              (se presente)
 *   2. `--json-schema <schema>`                       (se presente)
 *   3. `--exclude-dynamic-system-prompt-sections`     (se true)
 *   4. `-p <prompt>`
 *   5. `--output-format json`
 *   6. `--dangerously-skip-permissions`
 *   7. `--max-budget-usd <n>`                         (se > 0)
 *   8. `--resume <id>`                                (se presente)
 *   9. ...extraFlags
 *
 * **Por que `--dangerously-skip-permissions`:** em `-p` (headless) o CLI recusa
 * Edit/Write sem confirmação. Risk Gate + Approval Flow já filtraram; o
 * serviço roda sem root (systemd) e o allowlist delimita o blast radius.
 * Hooks do repo continuam rodando sob bypass (verificado).
 *
 * @example
 *   buildClaudeArgs({ prompt: 'x', ...pipelineSessionFlags(contract) }).args
 */
export function buildClaudeArgs(input: BuildClaudeArgsInput): BuildClaudeArgsResult {
  const args: string[] = [];

  if (input.appendSystemPrompt !== undefined && input.appendSystemPrompt.trim() !== '') {
    args.push('--append-system-prompt', input.appendSystemPrompt);
  }
  if (input.jsonSchema !== undefined && input.jsonSchema.trim() !== '') {
    args.push('--json-schema', input.jsonSchema);
  }
  if (input.excludeDynamicSections === true) {
    args.push('--exclude-dynamic-system-prompt-sections');
  }

  args.push('-p', input.prompt, '--output-format', 'json', '--dangerously-skip-permissions');

  if (
    typeof input.maxBudgetUsd === 'number' &&
    Number.isFinite(input.maxBudgetUsd) &&
    input.maxBudgetUsd > 0
  ) {
    args.push('--max-budget-usd', String(input.maxBudgetUsd));
  }

  if (
    input.resumeSessionId !== undefined &&
    input.resumeSessionId !== null &&
    input.resumeSessionId.length > 0
  ) {
    args.push('--resume', input.resumeSessionId);
  }

  if (input.extraFlags && input.extraFlags.length > 0) {
    args.push(...input.extraFlags);
  }

  return { args };
}

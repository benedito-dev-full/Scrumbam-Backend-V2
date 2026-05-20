/**
 * Único call-site da montagem do argv para o CLI `claude`.
 *
 * **Por que existe:** o Cache Warmer depende de PARIDADE BYTE-A-BYTE
 * do prefixo do prompt entre uma execução real (`run-claude-code.handler.ts`)
 * e um warm (`warm-cache.handler.ts`). Sem isso, o warmer aquece um prefixo
 * diferente do que as tasks reais usam → cache da Anthropic (TTL=1h) é por
 * prefixo, então prefixo divergente = warmer vira teatro (zero cache_read em
 * tasks subsequentes).
 *
 * **Garantia técnica:** ambos os handlers chamam ESTA função para montar o
 * argv. Specs de snapshot em `command-builder.spec.ts` validam byte-a-byte
 * os 4 primeiros argumentos (`--system-prompt`, CLAUDE.md, `-p`, prompt) —
 * são eles que formam o prefixo cacheável do Anthropic API.
 *
 * **Função pura, ZERO side-effects.** Recebe input, retorna argv. Sem leitura
 * de arquivo, sem env, sem clock. Testável com snapshot determinístico.
 */

/**
 * Input do builder. Subset estável das opções que afetam o argv do CLI.
 * Adicionar campos novos aqui exige bumping cuidadoso — qualquer mudança
 * de ordem ou nome de flag invalida o cache do Anthropic.
 */
export interface BuildClaudeArgsInput {
  /** Prompt da tarefa (vai como `-p <prompt>`). Obrigatório. */
  prompt: string;
  /**
   * Conteúdo do CLAUDE.md global (vai como `--system-prompt <conteúdo>`).
   * Se undefined OR vazio (após trim), a flag NÃO é adicionada. Mesma
   * semântica do legado em `runner.ts` antes do refactor.
   */
  systemPrompt?: string;
  /**
   * Session id para continuar conversa anterior (vai como `--resume <id>`).
   * Se undefined OR vazio, flag NÃO é adicionada. Warmer NUNCA passa este
   * campo (cada warm cria uma sessão nova efêmera).
   */
  resumeSessionId?: string | null;
  /**
   * Flags adicionais inseridas APÓS as flags-base do prefixo cacheável
   * (`--system-prompt`, `-p`, `--output-format json`, `--dangerously-skip-permissions`).
   * Usadas pelo warmer para `--permission-mode=plan --max-turns=1` sem
   * poluir o handler real.
   *
   * **Crítico:** estas flags vão DEPOIS do prefixo cacheável — não afetam
   * o cache do system-prompt (que é o ganho de ~58k tokens). Cache do
   * Anthropic é por PREFIXO; flags no final são "sufixo variável" e o
   * cache continua válido para a parte de cima.
   */
  extraFlags?: string[];
}

export interface BuildClaudeArgsResult {
  /** Argv pronto para passar a `execFile(CLAUDE_BINARY, args, ...)`. */
  args: string[];
}

/**
 * Constrói o argv canônico do CLI `claude`. Ordem dos argumentos é
 * deliberada — qualquer mudança quebra paridade com tasks já cacheadas.
 *
 * **Ordem garantida (snapshot-tested):**
 *   1. `--system-prompt <conteúdo>`  (se systemPrompt presente e não-vazio)
 *   2. `-p <prompt>`
 *   3. `--output-format json`
 *   4. `--dangerously-skip-permissions`
 *   5. `--resume <id>`               (se resumeSessionId presente e não-vazio)
 *   6. ...extraFlags                 (se array presente; itens na ordem fornecida)
 *
 * **Por que `--dangerously-skip-permissions`:** comentário longo no
 * `runner.ts` original — em modo `-p` (headless), o CLI recusa Edit/Write
 * sem confirmação. Risk Gate + Approval Flow já filtraram, então o
 * agente assume aprovação prévia. Container roda sem root, allowlist
 * delimita blast radius.
 */
export function buildClaudeArgs(input: BuildClaudeArgsInput): BuildClaudeArgsResult {
  const args: string[] = [];

  if (input.systemPrompt !== undefined && input.systemPrompt.trim() !== '') {
    args.push('--system-prompt', input.systemPrompt);
  }

  args.push('-p', input.prompt, '--output-format', 'json', '--dangerously-skip-permissions');

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

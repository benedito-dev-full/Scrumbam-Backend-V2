/**
 * Specs do `command-builder.ts` — ADR-V2-046 re-baselinada pela ADR-V2-083.
 *
 * Mudança consciente de baseline (snapshots regenerados nesta task):
 *  - `--system-prompt <CLAUDE.md global>` SAIU (substituía o prompt padrão do
 *    Claude Code e injetava o mapa de slugs em todo repo);
 *  - entram `--append-system-prompt <contrato fixo>`, `--json-schema <schema>` e
 *    `--exclude-dynamic-system-prompt-sections`, IGUAIS em task real e warm.
 *  - `--bare` nunca aparece (pularia hooks e CLAUDE.md — mataria a esteira).
 */
import { buildClaudeArgs, pipelineSessionFlags } from '../src/claude-code/command-builder';
import {
  PIPELINE_APPEND_SYSTEM_PROMPT,
  PIPELINE_RESULT_SCHEMA_JSON,
} from '../src/claude-code/pipeline-contract';

const SESSION = pipelineSessionFlags({
  appendSystemPrompt: PIPELINE_APPEND_SYSTEM_PROMPT,
  jsonSchema: PIPELINE_RESULT_SCHEMA_JSON,
});

describe('buildClaudeArgs', () => {
  describe('argv básico (modo simples: sem flags de sessão)', () => {
    it('retorna apenas -p, prompt e flags-base — SEM --system-prompt', () => {
      const { args } = buildClaudeArgs({ prompt: 'list files' });

      expect(args).toEqual([
        '-p',
        'list files',
        '--output-format',
        'json',
        '--dangerously-skip-permissions',
      ]);
      expect(args).not.toContain('--system-prompt');
    });
  });

  describe('flags de sessão do modo esteira', () => {
    it('ordem: --append-system-prompt, --json-schema, --exclude-dynamic…, -p …', () => {
      const { args } = buildClaudeArgs({ prompt: 'do thing', ...SESSION });

      expect(args).toEqual([
        '--append-system-prompt',
        PIPELINE_APPEND_SYSTEM_PROMPT,
        '--json-schema',
        PIPELINE_RESULT_SCHEMA_JSON,
        '--exclude-dynamic-system-prompt-sections',
        '-p',
        'do thing',
        '--output-format',
        'json',
        '--dangerously-skip-permissions',
      ]);
    });

    it('appendSystemPrompt/jsonSchema vazios (ou só whitespace) NÃO geram flag', () => {
      const { args } = buildClaudeArgs({ prompt: 'x', appendSystemPrompt: '  \n', jsonSchema: '' });
      expect(args).not.toContain('--append-system-prompt');
      expect(args).not.toContain('--json-schema');
    });

    it('nunca usa --system-prompt nem --bare', () => {
      const { args } = buildClaudeArgs({ prompt: 'x', ...SESSION, resumeSessionId: 'r' });
      expect(args).not.toContain('--system-prompt');
      expect(args).not.toContain('--bare');
    });
  });

  describe('--max-budget-usd (P2: desligado no início)', () => {
    it('ausente ⇒ sem flag', () => {
      expect(buildClaudeArgs({ prompt: 'x' }).args).not.toContain('--max-budget-usd');
    });

    it('positivo ⇒ flag após as flags-base e antes do --resume', () => {
      const { args } = buildClaudeArgs({ prompt: 'x', maxBudgetUsd: 12.5, resumeSessionId: 'r' });
      expect(args.slice(-4)).toEqual(['--max-budget-usd', '12.5', '--resume', 'r']);
    });

    it('zero/negativo/NaN ⇒ sem flag', () => {
      for (const v of [0, -1, Number.NaN]) {
        expect(buildClaudeArgs({ prompt: 'x', maxBudgetUsd: v }).args).not.toContain(
          '--max-budget-usd',
        );
      }
    });
  });

  describe('com resumeSessionId', () => {
    it('adiciona --resume APÓS as flags-base', () => {
      const { args } = buildClaudeArgs({ prompt: 'continue', resumeSessionId: 'abc-123' });
      expect(args).toEqual([
        '-p',
        'continue',
        '--output-format',
        'json',
        '--dangerously-skip-permissions',
        '--resume',
        'abc-123',
      ]);
    });

    it.each([undefined, null, ''])('NÃO adiciona --resume se %p', (v) => {
      expect(buildClaudeArgs({ prompt: 'x', resumeSessionId: v }).args).not.toContain('--resume');
    });
  });

  describe('com extraFlags', () => {
    it('adiciona extraFlags no FINAL do argv', () => {
      const { args } = buildClaudeArgs({
        prompt: 'warm',
        ...SESSION,
        extraFlags: ['--permission-mode=plan', '--max-turns=1'],
      });
      expect(args.slice(-2)).toEqual(['--permission-mode=plan', '--max-turns=1']);
    });

    it('extraFlags vazio NÃO altera argv', () => {
      expect(buildClaudeArgs({ prompt: 'x', extraFlags: [] }).args).toEqual(
        buildClaudeArgs({ prompt: 'x' }).args,
      );
    });
  });

  // ===========================================================================
  // PARIDADE — task real (esteira) × warm (ADR-V2-046 re-baselinada, ADR-V2-083)
  // ===========================================================================
  describe('paridade task real vs warm', () => {
    const TASK_PROMPT = '/scrumban-executar CONTROLE-SCRUMBAN v1 ...';
    const WARM_PROMPT = 'responda apenas ok. nao use ferramentas.';

    it('as 5 PRIMEIRAS posições (flags de sessão = prefixo cacheável) são IDÊNTICAS', () => {
      const taskArgs = buildClaudeArgs({ prompt: TASK_PROMPT, ...SESSION, resumeSessionId: null }).args;
      const warmArgs = buildClaudeArgs({
        prompt: WARM_PROMPT,
        ...SESSION,
        extraFlags: ['--permission-mode=plan', '--max-turns=1'],
      }).args;

      expect(warmArgs.slice(0, 5)).toEqual(taskArgs.slice(0, 5));
      expect(warmArgs[5]).toBe('-p');
      expect(taskArgs[5]).toBe('-p');
      // flags-base idênticas após o prompt
      expect(warmArgs.slice(7, 10)).toEqual(taskArgs.slice(7, 10));
    });

    it('snapshot do argv de uma task real (referência de paridade)', () => {
      expect(buildClaudeArgs({ prompt: TASK_PROMPT, ...SESSION }).args).toMatchSnapshot();
    });

    it('snapshot do argv de um warm (referência de paridade)', () => {
      expect(
        buildClaudeArgs({
          prompt: WARM_PROMPT,
          ...SESSION,
          extraFlags: ['--permission-mode=plan', '--max-turns=1'],
        }).args,
      ).toMatchSnapshot();
    });
  });

  describe('determinismo', () => {
    it('mesmo input produz mesmo argv (função pura)', () => {
      const input = { prompt: 'x', ...SESSION, resumeSessionId: 'z', extraFlags: ['--a', '--b'] };
      expect(buildClaudeArgs(input).args).toEqual(buildClaudeArgs(input).args);
    });
  });
});

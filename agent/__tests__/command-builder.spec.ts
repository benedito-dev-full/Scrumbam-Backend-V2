/**
 * Specs do `command-builder.ts` (ADR-V2-046).
 *
 * Foco PRINCIPAL: paridade byte-a-byte do prefixo cacheável entre uma
 * execução real (task) e uma execução de warm. Se os 4 primeiros
 * argumentos divergirem, o cache do Anthropic API (TTL=1h, indexado
 * por prefixo) não é compartilhado → warmer vira teatro.
 *
 * Estratégia: snapshot tests + assertions explícitas sobre os 4
 * primeiros argumentos.
 */
import { buildClaudeArgs } from '../src/claude-code/command-builder';

describe('buildClaudeArgs', () => {
  describe('argv básico (sem systemPrompt nem resume nem extraFlags)', () => {
    it('retorna apenas -p, prompt e flags-base', () => {
      const { args } = buildClaudeArgs({ prompt: 'list files' });

      expect(args).toEqual([
        '-p',
        'list files',
        '--output-format',
        'json',
        '--dangerously-skip-permissions',
      ]);
    });
  });

  describe('com systemPrompt', () => {
    it('insere --system-prompt ANTES de -p', () => {
      const { args } = buildClaudeArgs({
        prompt: 'do thing',
        systemPrompt: 'You are a senior engineer.',
      });

      expect(args[0]).toBe('--system-prompt');
      expect(args[1]).toBe('You are a senior engineer.');
      expect(args[2]).toBe('-p');
      expect(args[3]).toBe('do thing');
    });

    it('NÃO insere --system-prompt se systemPrompt for undefined', () => {
      const { args } = buildClaudeArgs({ prompt: 'x' });
      expect(args.includes('--system-prompt')).toBe(false);
    });

    it('NÃO insere --system-prompt se string vazia', () => {
      const { args } = buildClaudeArgs({ prompt: 'x', systemPrompt: '' });
      expect(args.includes('--system-prompt')).toBe(false);
    });

    it('NÃO insere --system-prompt se string só com whitespace', () => {
      const { args } = buildClaudeArgs({ prompt: 'x', systemPrompt: '   \n\t  ' });
      expect(args.includes('--system-prompt')).toBe(false);
    });
  });

  describe('com resumeSessionId', () => {
    it('adiciona --resume APÓS as flags-base', () => {
      const { args } = buildClaudeArgs({
        prompt: 'continue',
        resumeSessionId: 'abc-123',
      });

      // Ordem esperada: -p, prompt, --output-format, json, --dangerously, --resume, abc-123
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

    it('NÃO adiciona --resume se undefined', () => {
      const { args } = buildClaudeArgs({ prompt: 'x' });
      expect(args.includes('--resume')).toBe(false);
    });

    it('NÃO adiciona --resume se null', () => {
      const { args } = buildClaudeArgs({ prompt: 'x', resumeSessionId: null });
      expect(args.includes('--resume')).toBe(false);
    });

    it('NÃO adiciona --resume se string vazia', () => {
      const { args } = buildClaudeArgs({ prompt: 'x', resumeSessionId: '' });
      expect(args.includes('--resume')).toBe(false);
    });
  });

  describe('com extraFlags', () => {
    it('adiciona extraFlags no FINAL do argv (após resume se houver)', () => {
      const { args } = buildClaudeArgs({
        prompt: 'warm',
        systemPrompt: 'CLAUDE.md content',
        extraFlags: ['--permission-mode=plan', '--max-turns=1'],
      });

      expect(args).toEqual([
        '--system-prompt',
        'CLAUDE.md content',
        '-p',
        'warm',
        '--output-format',
        'json',
        '--dangerously-skip-permissions',
        '--permission-mode=plan',
        '--max-turns=1',
      ]);
    });

    it('extraFlags vazio NÃO altera argv', () => {
      const a = buildClaudeArgs({ prompt: 'x' });
      const b = buildClaudeArgs({ prompt: 'x', extraFlags: [] });
      expect(a.args).toEqual(b.args);
    });
  });

  // ===========================================================================
  // PARIDADE — A ÚNICA RAZÃO DE EXISTIR DESTE MÓDULO (ADR-V2-046)
  // ===========================================================================
  describe('paridade task real vs warm (ADR-V2-045/039)', () => {
    const CLAUDE_MD = '# Padrões Backend Devari\n\n... 58k tokens ...';
    const TASK_PROMPT = 'You are an Implementer. Faça X.';
    const WARM_PROMPT = 'responda apenas ok. nao use ferramentas.';

    it('os 4 PRIMEIROS argumentos são IDÊNTICOS entre task e warm', () => {
      // Esta asserção é o coração do plano. Se quebrar, warmer está
      // aquecendo um prefixo diferente do que tasks reais usam → cache
      // do Anthropic não é compartilhado → warmer vira teatro.
      const taskArgs = buildClaudeArgs({
        prompt: TASK_PROMPT,
        systemPrompt: CLAUDE_MD,
        resumeSessionId: null,
      }).args;

      const warmArgs = buildClaudeArgs({
        prompt: WARM_PROMPT,
        systemPrompt: CLAUDE_MD,
        extraFlags: ['--permission-mode=plan', '--max-turns=1'],
      }).args;

      // Os 2 primeiros argumentos formam o systemPrompt — esta é a
      // parte pesada (~58k tokens) cacheável pelo Anthropic.
      expect(warmArgs[0]).toBe(taskArgs[0]); // '--system-prompt'
      expect(warmArgs[1]).toBe(taskArgs[1]); // CLAUDE.md content

      // Posições 2-3 são `-p <prompt>` — o prompt em si é DIFERENTE
      // (warm é minúsculo, task é o real), mas a FLAG é a mesma.
      // O cache do Anthropic é por PREFIXO; ao chegar no -p, ele
      // ainda casa o --system-prompt acima (cache hit do CLAUDE.md).
      expect(warmArgs[2]).toBe('-p');
      expect(taskArgs[2]).toBe('-p');

      // Os argumentos 4-6 (--output-format json --dangerously-skip-permissions)
      // são idênticos.
      expect(warmArgs.slice(4, 7)).toEqual(taskArgs.slice(4, 7));
    });

    it('snapshot do argv de uma task real (referência de paridade)', () => {
      const { args } = buildClaudeArgs({
        prompt: TASK_PROMPT,
        systemPrompt: CLAUDE_MD,
        resumeSessionId: null,
      });
      expect(args).toMatchSnapshot();
    });

    it('snapshot do argv de um warm (referência de paridade)', () => {
      const { args } = buildClaudeArgs({
        prompt: WARM_PROMPT,
        systemPrompt: CLAUDE_MD,
        extraFlags: ['--permission-mode=plan', '--max-turns=1'],
      });
      expect(args).toMatchSnapshot();
    });

    it('snapshot do argv de uma task real COM resume (referência)', () => {
      const { args } = buildClaudeArgs({
        prompt: TASK_PROMPT,
        systemPrompt: CLAUDE_MD,
        resumeSessionId: 'session-uuid-here',
      });
      expect(args).toMatchSnapshot();
    });
  });

  describe('determinismo', () => {
    it('mesmo input produz mesmo argv (função pura)', () => {
      const input = {
        prompt: 'x',
        systemPrompt: 'y',
        resumeSessionId: 'z',
        extraFlags: ['--a', '--b'],
      };
      const a = buildClaudeArgs(input);
      const b = buildClaudeArgs(input);
      expect(a.args).toEqual(b.args);
    });
  });
});

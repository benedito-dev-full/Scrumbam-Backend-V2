/** pipeline-preflight.ts — ADR-V2-083 (P1: repo sem esteira ⇒ parar e avisar). */
import {
  checkPreconditions,
  isPipelineInstalled,
  PIPELINE_COMMAND_RELATIVE_PATH,
} from '../src/claude-code/pipeline-preflight';
import type { GitExec } from '../src/git/pipeline-git';

describe('isPipelineInstalled', () => {
  it('checa exatamente <cwd>/.claude/commands/scrumban-executar.md', () => {
    const seen: string[] = [];
    expect(isPipelineInstalled('/repo', (p) => (seen.push(p), true))).toBe(true);
    expect(seen).toEqual([`/repo/${PIPELINE_COMMAND_RELATIVE_PATH}`]);
    expect(isPipelineInstalled('/repo', () => false)).toBe(false);
  });
});

describe('checkPreconditions', () => {
  const okExec: GitExec = async () => ({ stdout: '', stderr: '' });

  it('tudo presente → ok', async () => {
    expect(await checkPreconditions({ cwd: '/r', env: { GITHUB_TOKEN: 't' }, exec: okExec })).toEqual({ ok: true });
  });

  it('GH_TOKEN também vale', async () => {
    expect(await checkPreconditions({ cwd: '/r', env: { GH_TOKEN: 't' }, exec: okExec })).toEqual({ ok: true });
  });

  it('sem token → falha com mensagem SEM segredo', async () => {
    const r = await checkPreconditions({ cwd: '/r', env: {}, exec: okExec });
    expect(r).toEqual({ ok: false, message: expect.stringContaining('GITHUB_TOKEN') });
  });

  it('gh ausente → falha', async () => {
    const exec: GitExec = async (file) => {
      if (file === 'gh') throw new Error('ENOENT');
      return { stdout: '', stderr: '' };
    };
    const r = await checkPreconditions({ cwd: '/r', env: { GITHUB_TOKEN: 'segredo-123' }, exec });
    expect(r).toEqual({ ok: false, message: expect.stringContaining('gh') });
    expect(JSON.stringify(r)).not.toContain('segredo-123');
  });

  it('sem remoto origin → falha', async () => {
    const exec: GitExec = async (_f, args) => {
      if (args[0] === 'remote') throw new Error('no such remote');
      return { stdout: '', stderr: '' };
    };
    expect((await checkPreconditions({ cwd: '/r', env: { GITHUB_TOKEN: 't' }, exec })).ok).toBe(false);
  });
});

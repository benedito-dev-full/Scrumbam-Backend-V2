/** pipeline-git.ts — branch/base/verificação/PR (ADR-V2-083). Executor git/gh mockado. */
import {
  findPr,
  isSafeRef,
  markPrAsDraft,
  openDraftPr,
  PipelineGitError,
  prepareBranch,
  resolveBaseBranch,
  verifyBranch,
  type GitExec,
} from '../src/git/pipeline-git';

type Handler = (args: string[], file: string) => string | Error;

function execMock(handler: Handler): { exec: GitExec; calls: Array<[string, string[]]> } {
  const calls: Array<[string, string[]]> = [];
  const exec: GitExec = async (file, args) => {
    calls.push([file, args]);
    const r = handler(args, file);
    if (r instanceof Error) throw r;
    return { stdout: r, stderr: '' };
  };
  return { exec, calls };
}

const SHA = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';

describe('isSafeRef', () => {
  it.each(['main', 'develop', 'scrumban/exec-12', 'release/1.2'])('%s é segura', (r) => {
    expect(isSafeRef(r)).toBe(true);
  });
  it.each(['--upload-pack=x', 'a..b', 'a b', '', null, 'x;rm'])('%p é insegura', (r) => {
    expect(isSafeRef(r as string)).toBe(false);
  });
});

describe('resolveBaseBranch', () => {
  it('base explícita existente no remoto → usa a explícita', async () => {
    const m = execMock(() => '');
    expect(await resolveBaseBranch(m.exec, '/r', 'develop')).toBe('develop');
    expect(m.calls[0][1]).toEqual(['ls-remote', '--exit-code', '--heads', 'origin', 'develop']);
  });

  it('base explícita inexistente → BASE_BRANCH_NOT_FOUND', async () => {
    const m = execMock(() => new Error('exit 2'));
    await expect(resolveBaseBranch(m.exec, '/r', 'nope')).rejects.toMatchObject({ code: 'BASE_BRANCH_NOT_FOUND' });
  });

  it('null → default do repo via origin/HEAD (fim do main fixo)', async () => {
    const m = execMock((a) => (a[0] === 'symbolic-ref' ? 'origin/trunk\n' : ''));
    expect(await resolveBaseBranch(m.exec, '/r', null)).toBe('trunk');
  });

  it('R7: sem origin/HEAD → set-head --auto e tenta de novo', async () => {
    let n = 0;
    const m = execMock((a) => {
      if (a[0] === 'symbolic-ref') return n++ === 0 ? new Error('not a symbolic ref') : 'origin/main\n';
      return '';
    });
    expect(await resolveBaseBranch(m.exec, '/r', null)).toBe('main');
    expect(m.calls.map((c) => c[1][0])).toContain('remote');
  });

  it('sem origin/HEAD mesmo após set-head → BASE_BRANCH_NOT_FOUND', async () => {
    const m = execMock((a) => (a[0] === 'symbolic-ref' ? new Error('x') : ''));
    await expect(resolveBaseBranch(m.exec, '/r', null)).rejects.toBeInstanceOf(PipelineGitError);
  });
});

describe('prepareBranch', () => {
  it('clone limpo: fetch + checkout -B <branch> origin/<base>; sem stash', async () => {
    const m = execMock(() => '');
    const r = await prepareBranch(m.exec, { cwd: '/r', branch: 'scrumban/exec-1', base: 'develop', executionId: '1', resume: false });
    expect(r.stashed).toBe(false);
    expect(m.calls.map((c) => c[1])).toEqual([
      ['fetch', 'origin', '--prune'],
      ['status', '--porcelain'],
      ['checkout', '-B', 'scrumban/exec-1', 'origin/develop'],
    ]);
  });

  it('R9: sobras no clone → stash nomeado (nunca reset --hard)', async () => {
    const m = execMock((a) => (a[0] === 'status' ? ' M src/x.ts\n' : ''));
    const r = await prepareBranch(m.exec, { cwd: '/r', branch: 'b', base: 'main', executionId: '77', resume: false });
    expect(r.stashed).toBe(true);
    expect(m.calls.map((c) => c[1])).toContainEqual(['stash', 'push', '-u', '-m', 'scrumban-leftover-77']);
    expect(m.calls.flatMap((c) => c[1])).not.toContain('--hard');
  });

  it('resume: branch já no remoto → reusa origin/<branch>', async () => {
    const m = execMock(() => '');
    await prepareBranch(m.exec, { cwd: '/r', branch: 'scrumban/exec-1', base: 'main', executionId: '1', resume: true });
    expect(m.calls.map((c) => c[1])).toContainEqual(['checkout', '-B', 'scrumban/exec-1', 'origin/scrumban/exec-1']);
  });

  it('falha de git vira PIPELINE_PRECONDITION_FAILED', async () => {
    const m = execMock((a) => (a[0] === 'fetch' ? new Error('could not read from remote') : ''));
    await expect(
      prepareBranch(m.exec, { cwd: '/r', branch: 'b', base: 'main', executionId: '1', resume: false }),
    ).rejects.toMatchObject({ code: 'PIPELINE_PRECONDITION_FAILED' });
  });

  it('ref insegura é recusada antes de chamar o git', async () => {
    const m = execMock(() => '');
    await expect(
      prepareBranch(m.exec, { cwd: '/r', branch: '--upload-pack=x', base: 'main', executionId: '1', resume: false }),
    ).rejects.toBeInstanceOf(PipelineGitError);
    expect(m.calls).toHaveLength(0);
  });
});

describe('verifyBranch', () => {
  it('branch publicada com o mesmo SHA → pushed=true, commitsAhead lido do rev-list', async () => {
    const m = execMock((a) => {
      if (a[0] === 'rev-parse') return `${SHA}\n`;
      if (a[0] === 'rev-list') return '3\n';
      if (a[0] === 'ls-remote') return `${SHA}\trefs/heads/b\n`;
      return '';
    });
    expect(await verifyBranch(m.exec, { cwd: '/r', branch: 'b', base: 'main' })).toEqual({
      branchExists: true,
      headSha: SHA,
      commitsAhead: 3,
      pushed: true,
    });
  });

  it('SHA remoto diferente (push atrasado) → pushed=false', async () => {
    const m = execMock((a) => {
      if (a[0] === 'rev-parse') return `${SHA}\n`;
      if (a[0] === 'rev-list') return '1\n';
      if (a[0] === 'ls-remote') return `ffffffffffffffffffffffffffffffffffffffff\trefs/heads/b\n`;
      return '';
    });
    expect((await verifyBranch(m.exec, { cwd: '/r', branch: 'b', base: 'main' })).pushed).toBe(false);
  });

  it('branch inexistente → branchExists=false', async () => {
    const m = execMock(() => new Error('fatal'));
    expect(await verifyBranch(m.exec, { cwd: '/r', branch: 'b', base: 'main' })).toEqual({
      branchExists: false,
      headSha: null,
      commitsAhead: null,
      pushed: false,
    });
  });
});

describe('findPr / openDraftPr / markPrAsDraft', () => {
  const pr = {
    url: 'https://github.com/acme/api/pull/42',
    number: 42,
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    headRefOid: SHA,
  };

  it('gh pr list --head <branch> --state all → PR', async () => {
    const m = execMock(() => JSON.stringify([pr]));
    expect(await findPr(m.exec, { cwd: '/r', branch: 'b' })).toEqual(pr);
    expect(m.calls[0]).toEqual([
      'gh',
      ['pr', 'list', '--head', 'b', '--state', 'all', '--json', 'url,number,state,isDraft,baseRefName,headRefOid', '--limit', '1'],
    ]);
  });

  it('lista vazia → null; URL fora do github.com → null', async () => {
    expect(await findPr(execMock(() => '[]').exec, { cwd: '/r', branch: 'b' })).toBeNull();
    expect(
      await findPr(execMock(() => JSON.stringify([{ ...pr, url: 'https://evil.com/a/b/pull/1' }])).exec, {
        cwd: '/r',
        branch: 'b',
      }),
    ).toBeNull();
  });

  it('openDraftPr: push (se preciso) + gh pr create --draft --base --head', async () => {
    const m = execMock(() => '');
    await openDraftPr(m.exec, { cwd: '/r', branch: 'b', base: 'main', pushed: false, title: 't', body: 'x' });
    expect(m.calls[0]).toEqual(['git', ['push', '-u', 'origin', 'b']]);
    expect(m.calls[1][1].slice(0, 7)).toEqual(['pr', 'create', '--draft', '--base', 'main', '--head', 'b']);
  });

  it('markPrAsDraft: gh pr ready <n> --undo', async () => {
    const m = execMock(() => '');
    await markPrAsDraft(m.exec, { cwd: '/r', number: 42 });
    expect(m.calls[0]).toEqual(['gh', ['pr', 'ready', '42', '--undo']]);
  });
});

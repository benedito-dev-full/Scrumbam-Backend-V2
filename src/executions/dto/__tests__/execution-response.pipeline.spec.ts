import { serializeExecution, toGit, toPipeline, toPullRequest } from '../execution-response.dto';

/**
 * ADR-V2-083 — contrato para o frontend: `git`, `pullRequest` e `pipeline`
 * no `ExecutionResponseDto` são projeções SEGURAS (whitelist) de `dados.*`.
 */
const SHA = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';

const dadosEsteira = {
  command: { text: 'x' },
  audit: { projectId: '20', triggeredBy: '1', outcome: { success: false, source: 'agent', reason: 'PIPELINE_NOT_APPROVED' } },
  git: { branch: 'scrumban/exec-9', baseBranch: 'develop', headAfter: SHA, commitsAhead: 2, pushed: true, pushedAt: 't', lixo: 'x' },
  pullRequest: {
    url: 'https://github.com/acme/api/pull/42',
    number: 42,
    state: 'OPEN',
    isDraft: true,
    openedBy: 'pipeline',
    baseRefName: 'develop',
    headRefOid: SHA,
    openedAt: 't',
  },
  pipeline: {
    required: true,
    prRequired: true,
    taskType: 'code',
    mode: 'pipeline',
    decision: 'NEEDS_CHANGES',
    reviewScore: 7.5,
    reason: 'PIPELINE_NOT_APPROVED',
    declared: {
      decision: 'NEEDS_CHANGES',
      summary: 'faltou teste',
      stages: [{ name: 'reviewer', status: 'done' }, { bogus: 1 }],
      branch: 'outra-branch',
    },
    verified: {
      contractValid: true,
      prOpenedBy: 'pipeline',
      subagents: { reviewer: 3, implementer: 3, hack: 'x' },
      contractError: 'detalhe interno',
      verifyError: 'stderr do gh',
    },
  },
};

describe('ExecutionResponseDto — esteira (ADR-V2-083)', () => {
  it('serializeExecution expõe pipeline/git/pullRequest projetados + outcome.reason do agente', () => {
    const dto = serializeExecution({ chave: BigInt(9), idClasse: BigInt(-301), dados: dadosEsteira });

    expect(dto.outcome).toEqual({ reason: 'PIPELINE_NOT_APPROVED', source: 'agent' });
    expect(dto.pullRequest).toEqual({
      url: 'https://github.com/acme/api/pull/42',
      number: 42,
      state: 'OPEN',
      isDraft: true,
      openedBy: 'pipeline',
      baseRefName: 'develop',
      openedAt: 't',
    });
    expect(dto.git).toEqual({
      branch: 'scrumban/exec-9',
      baseBranch: 'develop',
      headAfter: SHA,
      commitsAhead: 2,
      pushed: true,
      pushedAt: 't',
    });
    expect(dto.pipeline).toEqual({
      required: true,
      prRequired: true,
      taskType: 'code',
      mode: 'pipeline',
      decision: 'NEEDS_CHANGES',
      reviewScore: 7.5,
      stages: [{ name: 'reviewer', status: 'done' }],
      summary: 'faltou teste',
      subagents: { reviewer: 3, implementer: 3 },
      contractValid: true,
      prOpenedBy: 'pipeline',
      reason: 'PIPELINE_NOT_APPROVED',
    });
  });

  it('NUNCA expõe contractError/verifyError nem campos fora da whitelist', () => {
    const json = JSON.stringify(
      serializeExecution({ chave: BigInt(9), idClasse: BigInt(-301), dados: dadosEsteira }),
    );
    expect(json).not.toContain('detalhe interno');
    expect(json).not.toContain('stderr do gh');
    expect(json).not.toContain('lixo');
    expect(json).not.toContain('outra-branch');
  });

  it('execução legada/COMMAND (sem dados.pipeline) → pipeline undefined; git/pullRequest legados preservados', () => {
    expect(toPipeline(undefined)).toBeUndefined();
    expect(toGit({ headBefore: 'a', headAfter: 'b', commitMessage: 'm', filesChanged: 2 })).toEqual({
      headBefore: 'a',
      headAfter: 'b',
      commitMessage: 'm',
      filesChanged: 2,
    });
    expect(toPullRequest({ url: 'u', number: 1, rolledBackAt: 'r', rollbackRef: 'f' })).toEqual({
      url: 'u',
      number: 1,
      rolledBackAt: 'r',
      rollbackRef: 'f',
    });
  });

  it('motivo fora da lista da esteira não vaza em pipeline.reason; summary truncado em 2000', () => {
    const p = toPipeline({
      required: true,
      prRequired: false,
      reason: 'TIMEOUT_NO_CALLBACK',
      declared: { summary: 'y'.repeat(5000) },
    })!;
    expect(p.reason).toBeNull();
    expect(p.summary).toHaveLength(2000);
  });
});

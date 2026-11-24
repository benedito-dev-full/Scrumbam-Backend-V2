/* eslint-disable @typescript-eslint/no-explicit-any */
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import OperacaoExecucaoClaude from '../OperacaoExecucaoClaude';
import {
  IExecucaoPipeline,
  IPipelineCallback,
  IPipelineDeclared,
  IPipelineVerified,
} from '../../interfaces/IExecucaoData';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

/**
 * ADR-V2-083 — esteira headless: política de desfecho (pura) + gravação de
 * `dados.git` / `pullRequest` / `pipeline` no MESMO UPDATE CAS de registrarOutcome.
 * Zona da Task 1 (calcula/guardas de prompt) NÃO é exercitada.
 */

const SHA = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';
const REQ_CODE: IExecucaoPipeline = { required: true, prRequired: true, taskType: 'code' };
const REQ_RESEARCH: IExecucaoPipeline = { required: true, prRequired: false, taskType: 'research' };

function declared(over: Partial<IPipelineDeclared> = {}): IPipelineDeclared {
  return {
    contractVersion: 1,
    decision: 'APPROVED',
    reviewScore: 9,
    stages: [
      { name: 'strategist', status: 'done' },
      { name: 'implementer', status: 'done' },
      { name: 'reviewer', status: 'done' },
      { name: 'documenter', status: 'done' },
    ],
    branch: 'scrumban/exec-1',
    commit: SHA.slice(0, 7),
    prUrl: 'https://github.com/acme/api/pull/42',
    summary: 'feito',
    ...over,
  };
}

function verified(over: Partial<IPipelineVerified> = {}): IPipelineVerified {
  return {
    branchExists: true,
    pushed: true,
    commitsAhead: 3,
    headSha: SHA,
    baseBranch: 'develop',
    pr: {
      url: 'https://github.com/acme/api/pull/42',
      number: 42,
      state: 'OPEN',
      isDraft: false,
      baseRefName: 'develop',
      headRefOid: SHA,
    },
    prOpenedBy: 'pipeline',
    subagents: { strategist: 1, implementer: 1, reviewer: 1, documenter: 1 },
    contractValid: true,
    ...over,
  };
}

function cb(d: IPipelineDeclared | null, v: IPipelineVerified | null): IPipelineCallback {
  return { mode: 'pipeline', declared: d, verified: v };
}

const avaliar = OperacaoExecucaoClaude.avaliarDesfechoEsteira;

describe('OperacaoExecucaoClaude.avaliarDesfechoEsteira — 1 teste por linha da tabela (ADR-V2-083)', () => {
  it('execução sem pipeline.required (legado/COMMAND) → regra atual (exit 0)', () => {
    expect(avaliar({ agentSuccess: true, requisitos: undefined, callback: null })).toEqual({
      success: true,
    });
    expect(avaliar({ agentSuccess: false, requisitos: undefined, callback: null })).toEqual({
      success: false,
    });
  });

  it('callback sem bloco pipeline (agente 0.1.x) → regra legada (compat)', () => {
    expect(avaliar({ agentSuccess: true, requisitos: REQ_CODE, callback: null })).toEqual({
      success: true,
    });
  });

  it('agente falhou com PIPELINE_NOT_INSTALLED → FAILED PIPELINE_NOT_INSTALLED', () => {
    expect(
      avaliar({
        agentSuccess: false,
        errorCode: 'PIPELINE_NOT_INSTALLED',
        requisitos: REQ_CODE,
        callback: null,
      }),
    ).toEqual({ success: false, reason: 'PIPELINE_NOT_INSTALLED' });
  });

  it.each(['PIPELINE_PRECONDITION_FAILED', 'BASE_BRANCH_NOT_FOUND'])(
    'agente falhou com %s → FAILED PIPELINE_PRECONDITION_FAILED',
    (code) => {
      expect(
        avaliar({ agentSuccess: false, errorCode: code, requisitos: REQ_CODE, callback: null }),
      ).toEqual({ success: false, reason: 'PIPELINE_PRECONDITION_FAILED' });
    },
  );

  it('agente falhou por outro motivo (exit≠0, TIMEOUT) → FAILED sem motivo de esteira', () => {
    expect(
      avaliar({
        agentSuccess: false,
        errorCode: 'TIMEOUT',
        requisitos: REQ_CODE,
        callback: cb(declared(), verified()),
      }),
    ).toEqual({ success: false });
  });

  it('contrato ausente (declared null) → PIPELINE_CONTRACT_MISSING', () => {
    expect(
      avaliar({ agentSuccess: true, requisitos: REQ_CODE, callback: cb(null, verified()) }),
    ).toEqual({ success: false, reason: 'PIPELINE_CONTRACT_MISSING' });
  });

  it('contrato inválido (verified.contractValid=false) → PIPELINE_CONTRACT_MISSING', () => {
    expect(
      avaliar({
        agentSuccess: true,
        requisitos: REQ_CODE,
        callback: cb(declared(), verified({ contractValid: false })),
      }),
    ).toEqual({ success: false, reason: 'PIPELINE_CONTRACT_MISSING' });
  });

  it.each(['NEEDS_CHANGES', 'REJECTED', 'ABORTED'] as const)(
    'decisão %s → PIPELINE_NOT_APPROVED (PR fica rascunho — P3)',
    (decision) => {
      expect(
        avaliar({
          agentSuccess: true,
          requisitos: REQ_CODE,
          callback: cb(declared({ decision }), verified()),
        }),
      ).toEqual({ success: false, reason: 'PIPELINE_NOT_APPROVED' });
    },
  );

  it('NO_CHANGES + prRequired (code) → PR_NOT_CREATED', () => {
    expect(
      avaliar({
        agentSuccess: true,
        requisitos: REQ_CODE,
        callback: cb(declared({ decision: 'NO_CHANGES', prUrl: null }), verified({ pr: null })),
      }),
    ).toEqual({ success: false, reason: 'PR_NOT_CREATED' });
  });

  it('NO_CHANGES sem prRequired (research) → SUCCESS', () => {
    expect(
      avaliar({
        agentSuccess: true,
        requisitos: REQ_RESEARCH,
        callback: cb(declared({ decision: 'NO_CHANGES' }), verified({ pr: null, subagents: {} })),
      }),
    ).toEqual({ success: true });
  });

  it('R1: APPROVED + prRequired sem reviewer no runtime → PIPELINE_CONTRACT_MISSING', () => {
    expect(
      avaliar({
        agentSuccess: true,
        requisitos: REQ_CODE,
        callback: cb(declared(), verified({ subagents: { implementer: 1 } })),
      }),
    ).toEqual({ success: false, reason: 'PIPELINE_CONTRACT_MISSING' });
  });

  it('R1: APPROVED + prRequired sem subagent_stats (runtime não reportou) → PIPELINE_CONTRACT_MISSING', () => {
    expect(
      avaliar({
        agentSuccess: true,
        requisitos: REQ_CODE,
        callback: cb(declared(), verified({ subagents: null })),
      }),
    ).toEqual({ success: false, reason: 'PIPELINE_CONTRACT_MISSING' });
  });

  it('APPROVED + prRequired sem PR verificado → PR_NOT_CREATED', () => {
    expect(
      avaliar({
        agentSuccess: true,
        requisitos: REQ_CODE,
        callback: cb(declared(), verified({ pr: null, prOpenedBy: null })),
      }),
    ).toEqual({ success: false, reason: 'PR_NOT_CREATED' });
  });

  it('APPROVED + PR com headRefOid ≠ headSha (PR desatualizado) → PR_NOT_CREATED', () => {
    const v = verified();
    v.pr = { ...v.pr!, headRefOid: 'ffffffffffffffffffffffffffffffffffffffff' };
    expect(avaliar({ agentSuccess: true, requisitos: REQ_CODE, callback: cb(declared(), v) })).toEqual(
      { success: false, reason: 'PR_NOT_CREATED' },
    );
  });

  it('APPROVED + PR aberto pela rede de segurança do agente (não pela esteira) → PR_NOT_CREATED (P3)', () => {
    expect(
      avaliar({
        agentSuccess: true,
        requisitos: REQ_CODE,
        callback: cb(declared(), verified({ prOpenedBy: 'agent-fallback' })),
      }),
    ).toEqual({ success: false, reason: 'PR_NOT_CREATED' });
  });

  it('APPROVED + branch não publicada (pushed=false) → PR_NOT_CREATED', () => {
    expect(
      avaliar({
        agentSuccess: true,
        requisitos: REQ_CODE,
        callback: cb(declared(), verified({ pushed: false })),
      }),
    ).toEqual({ success: false, reason: 'PR_NOT_CREATED' });
  });

  it('APPROVED + prRequired + PR verificado (headRefOid == headSha) → SUCCESS', () => {
    expect(
      avaliar({ agentSuccess: true, requisitos: REQ_CODE, callback: cb(declared(), verified()) }),
    ).toEqual({ success: true });
  });

  it('APPROVED sem prRequired com ≥1 subagente no runtime → SUCCESS', () => {
    expect(
      avaliar({
        agentSuccess: true,
        requisitos: REQ_RESEARCH,
        callback: cb(declared(), verified({ pr: null, subagents: { strategist: 1 } })),
      }),
    ).toEqual({ success: true });
  });

  it.each([{}, null, { strategist: 0 }])(
    'M2: APPROVED sem prRequired e SEM subagente no runtime (%p) → PIPELINE_CONTRACT_MISSING',
    (subagents) => {
      expect(
        avaliar({
          agentSuccess: true,
          requisitos: REQ_RESEARCH,
          callback: cb(declared(), verified({ pr: null, subagents: subagents as any })),
        }),
      ).toEqual({ success: false, reason: 'PIPELINE_CONTRACT_MISSING' });
    },
  );
});

function build(rows: unknown[] = [{ chave: BigInt(1), supersedes: null }]) {
  const bd: any = {
    $queryRaw: jest.fn().mockResolvedValue(rows),
    dVFS: { findFirst: jest.fn().mockResolvedValue(null) },
  };
  const op = new OperacaoExecucaoClaude({
    usuario: 'system:test',
    classe: '-301',
    bd,
    projectId: '20',
    agentId: '30',
    correlationId: 'corr',
    command: { text: 'x' },
    agentTunnelService: {},
    eventProducer: { addInternalEvent: jest.fn() } as any,
  });
  const persisted = (): any =>
    JSON.parse(
      (bd.$queryRaw.mock.calls[0][0] as Prisma.Sql).values.find(
        (v) => typeof v === 'string' && v.startsWith('{'),
      ) as string,
    );
  return { op, bd, persisted };
}

const baseDados = (): any => ({
  command: { text: 'x' },
  git: { branch: 'scrumban/exec-1', baseBranch: null },
  pipeline: { ...REQ_CODE, contractVersion: 1 },
  task: { id: '55' },
  audit: { correlationId: 'corr', triggeredBy: '1', agentId: '30', projectId: '20' },
});

const outcomeParams = (over: Record<string, unknown> = {}) => ({
  dadosExistentes: { chave: BigInt(1), idClasse: BigInt(-301), dados: baseDados() },
  claudeSessionId: null,
  claudeSessionPath: null,
  resumedFrom: null,
  exitCode: 0,
  success: true,
  durationMs: 10,
  stdoutTruncated: '',
  stderrTruncated: '',
  ...over,
});

describe('OperacaoExecucaoClaude.registrarOutcome — modo esteira (ADR-V2-083)', () => {
  it('APPROVED + PR verificado: grava git/pullRequest/pipeline no MESMO UPDATE CAS e SUCCESS', async () => {
    const t = build();

    const r = await t.op.registrarOutcome(
      outcomeParams({ pipeline: cb(declared(), verified()) }) as any,
    );

    expect(r).toEqual(expect.objectContaining({ applied: true, success: true }));
    expect(t.bd.$queryRaw).toHaveBeenCalledTimes(1); // um único UPDATE (CAS)
    const d = t.persisted();
    expect(d.statusCode).toBe('-519');
    expect(d.git).toEqual(
      expect.objectContaining({
        branch: 'scrumban/exec-1',
        headAfter: SHA,
        baseBranch: 'develop',
        commitsAhead: 3,
        pushed: true,
      }),
    );
    expect(d.pullRequest).toEqual(
      expect.objectContaining({
        url: 'https://github.com/acme/api/pull/42',
        number: 42,
        isDraft: false,
        openedBy: 'pipeline',
        headRefOid: SHA,
      }),
    );
    expect(d.pipeline).toEqual(
      expect.objectContaining({
        required: true,
        prRequired: true,
        mode: 'pipeline',
        decision: 'APPROVED',
        reviewScore: 9,
        reason: null,
      }),
    );
    expect(d.audit.outcome).toEqual(
      expect.objectContaining({ success: true, source: 'agent' }),
    );
    expect(d.audit.outcome.reason).toBeUndefined();
  });

  it('política rebaixa exit 0 → FAILED -520 com outcome.reason + errorCode canônicos; result.success=false', async () => {
    const t = build();

    const r = await t.op.registrarOutcome(
      outcomeParams({ pipeline: cb(declared({ decision: 'NEEDS_CHANGES' }), verified({ pr: { ...verified().pr!, isDraft: true } })) }) as any,
    );

    expect(r).toEqual(
      expect.objectContaining({ applied: true, success: false, reason: 'PIPELINE_NOT_APPROVED' }),
    );
    const d = t.persisted();
    expect(d.statusCode).toBe('-520');
    expect(d.audit.outcome).toEqual(
      expect.objectContaining({ success: false, source: 'agent', reason: 'PIPELINE_NOT_APPROVED' }),
    );
    expect(d.audit.errorCode).toBe('PIPELINE_NOT_APPROVED');
    // PR em rascunho continua visível (nenhum trabalho perdido — P3)
    expect(d.pullRequest.isDraft).toBe(true);
    expect(d.pipeline.reason).toBe('PIPELINE_NOT_APPROVED');
  });

  it('supersede (P1 da ADR-V2-082): o UPDATE com jsonb_set preserva o bloco novo da esteira', async () => {
    const t = build([{ chave: BigInt(1), supersedes: { reason: 'TIMEOUT_NO_CALLBACK', recordedAt: 'x' } }]);

    const r = await t.op.registrarOutcome(
      outcomeParams({ pipeline: cb(declared(), verified()) }) as any,
    );

    expect(r.superseded).toEqual({ reason: 'TIMEOUT_NO_CALLBACK', recordedAt: 'x' });
    const sql = t.bd.$queryRaw.mock.calls[0][0] as Prisma.Sql;
    expect(sql.sql).toContain("'{audit,outcome,supersedes}'");
    // o MESMO JSON (com pipeline/pullRequest) entra nos dois ramos do CASE
    const jsons = sql.values.filter((v) => typeof v === 'string' && v.startsWith('{')) as string[];
    expect(jsons).toHaveLength(2);
    for (const j of jsons) {
      expect(JSON.parse(j).pullRequest.url).toBe('https://github.com/acme/api/pull/42');
    }
  });

  it('CAS não aplica → applied=false + success do outcome existente (sem rebaixar de novo)', async () => {
    const t = build([]);
    const params = outcomeParams({ pipeline: cb(null, null) }) as any;
    params.dadosExistentes.dados.audit.outcome = {
      success: true,
      recordedAt: 'r',
      source: 'agent',
    };

    const r = await t.op.registrarOutcome(params);

    expect(r).toEqual({ applied: false, persistedAt: 'r', success: true });
  });

  it('execução legada (sem dados.pipeline) + callback sem pipeline → comportamento anterior intacto', async () => {
    const t = build();
    const params = outcomeParams() as any;
    delete params.dadosExistentes.dados.pipeline;
    delete params.dadosExistentes.dados.git;

    const r = await t.op.registrarOutcome(params);

    expect(r.success).toBe(true);
    const d = t.persisted();
    expect(d.statusCode).toBe('-519');
    expect(d.pipeline).toBeUndefined();
    expect(d.pullRequest).toBeUndefined();
  });
});

describe('DVFS chave 7 (pr-auto-open) segue INERTE no caminho do callback (ADR-V2-083)', () => {
  const script = fs.readFileSync(path.join(__dirname, '../../../dvfs/pr-auto-open.js'), 'utf8');
  // eslint-disable-next-line no-eval
  const prAutoOpen: (op: any) => Promise<void> = eval(`(function(){ ${script}; return prAutoOpen; })()`);

  it('dados.git.headAfter preenchido pelo callback NÃO ativa o script (sem githubClient)', async () => {
    const pr = { url: 'https://github.com/acme/api/pull/42', number: 42, openedBy: 'pipeline' };
    const op: any = {
      dados: { git: { branch: 'scrumban/exec-1', headAfter: SHA }, pullRequest: { ...pr } },
      _database: { dProject: { findFirst: jest.fn() } },
    };

    await prAutoOpen(op);

    expect(op._database.dProject.findFirst).not.toHaveBeenCalled();
    expect(op.dados.pullRequest).toEqual(pr);
  });

  it('registrarOutcome (AgentsService não injeta githubClient) não perde o PR verificado', async () => {
    const t = build();
    (t.bd as any).dVFS.findFirst = jest.fn().mockImplementation(({ where }: any) =>
      where.chaveScript === 7
        ? Promise.resolve({ chave: BigInt(7), chaveScript: 7, conteudo: `(${script.replace(/^\/\/.*$/gm, '')})`, ativo: true })
        : Promise.resolve(null),
    );

    await t.op.registrarOutcome(outcomeParams({ pipeline: cb(declared(), verified()) }) as any);

    expect((t.op as any).dados.pullRequest.url).toBe('https://github.com/acme/api/pull/42');
    expect((t.op as any).dados.pullRequest.openedBy).toBe('pipeline');
  });
});

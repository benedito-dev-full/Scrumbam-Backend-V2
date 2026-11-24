import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validate, ValidationError } from 'class-validator';
import { ExecutionResultDto } from '../execution-result.dto';

/**
 * ADR-V2-083 — bloco `pipeline` do callback `execution-result`.
 * Mesmas opções do ValidationPipe global (`src/main.ts`): whitelist +
 * forbidNonWhitelisted (campo desconhecido = 400 — por isso backend sobe ANTES do agente).
 */
const SHA = 'a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6a7b8c9d0';

function base(): Record<string, unknown> {
  return {
    executionId: '4815',
    exitCode: 0,
    success: true,
    durationMs: 10,
    claudeSessionId: null,
    claudeSessionPath: null,
    resumedFrom: null,
    stdoutTruncated: '',
    stderrTruncated: '',
  };
}

function pipeline(): Record<string, unknown> {
  return {
    mode: 'pipeline',
    declared: {
      contractVersion: 1,
      decision: 'APPROVED',
      reviewScore: 9,
      reviewFile: 'workspace/reviews/review-x.md',
      stages: [{ name: 'reviewer', status: 'done' }],
      branch: 'scrumban/exec-4815',
      commit: 'a1b2c3d',
      prUrl: 'https://github.com/acme/api/pull/42',
      summary: 'ok',
    },
    verified: {
      branchExists: true,
      pushed: true,
      commitsAhead: 2,
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
      subagents: { strategist: 1, implementer: 2, reviewer: 2, documenter: 1 },
      contractValid: true,
      contractError: null,
    },
  };
}

async function errorsOf(body: Record<string, unknown>): Promise<string[]> {
  const dto = plainToInstance(ExecutionResultDto, body);
  const errs = await validate(dto, { whitelist: true, forbidNonWhitelisted: true });
  const flat: string[] = [];
  const walk = (list: ValidationError[], prefix: string): void => {
    for (const e of list) {
      const p = prefix ? `${prefix}.${e.property}` : e.property;
      if (e.constraints) flat.push(`${p}:${Object.keys(e.constraints).join(',')}`);
      if (e.children?.length) walk(e.children, p);
    }
  };
  walk(errs, '');
  return flat;
}

describe('ExecutionResultDto.pipeline (ADR-V2-083)', () => {
  it('payload legado (sem pipeline) continua válido — agente 0.1.x', async () => {
    expect(await errorsOf(base())).toEqual([]);
  });

  it('bloco pipeline completo é válido', async () => {
    expect(await errorsOf({ ...base(), pipeline: pipeline() })).toEqual([]);
  });

  it('declared/verified null (contrato ausente) é válido — o Engine decide CONTRACT_MISSING', async () => {
    expect(
      await errorsOf({ ...base(), pipeline: { mode: 'pipeline', declared: null, verified: null } }),
    ).toEqual([]);
  });

  it.each(['PIPELINE_NOT_INSTALLED', 'PIPELINE_PRECONDITION_FAILED', 'BASE_BRANCH_NOT_FOUND'])(
    'errorCode novo %s aceito',
    async (code) => {
      expect(await errorsOf({ ...base(), success: false, errorCode: code })).toEqual([]);
    },
  );

  it('pr.url fora do github.com é rejeitado', async () => {
    const p = pipeline();
    (p.verified as Record<string, any>).pr.url = 'https://evil.example.com/acme/api/pull/42'; // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(await errorsOf({ ...base(), pipeline: p })).toEqual(
      expect.arrayContaining([expect.stringMatching(/^pipeline\.verified\.pr\.url:/)]),
    );
  });

  it('summary acima de 2000 chars é rejeitado (R8 — agente trunca antes de enviar)', async () => {
    const p = pipeline();
    (p.declared as Record<string, unknown>).summary = 'x'.repeat(2001);
    expect(await errorsOf({ ...base(), pipeline: p })).toEqual(
      expect.arrayContaining([expect.stringMatching(/^pipeline\.declared\.summary:maxLength/)]),
    );
  });

  it('decision fora do contrato e contractVersion desconhecida são rejeitadas', async () => {
    const p = pipeline();
    (p.declared as Record<string, unknown>).decision = 'MERGED';
    (p.declared as Record<string, unknown>).contractVersion = 2;
    const errs = await errorsOf({ ...base(), pipeline: p });
    expect(errs).toEqual(
      expect.arrayContaining([
        expect.stringMatching(/^pipeline\.declared\.decision:/),
        expect.stringMatching(/^pipeline\.declared\.contractVersion:/),
      ]),
    );
  });

  it('subagents com contagem não-inteira ou nome inseguro é rejeitado', async () => {
    const p = pipeline();
    (p.verified as Record<string, unknown>).subagents = { 'rm -rf': 1, reviewer: 1.5 };
    expect(await errorsOf({ ...base(), pipeline: p })).toEqual(
      expect.arrayContaining([expect.stringMatching(/^pipeline\.verified\.subagents:isSubagentCountMap/)]),
    );
  });

  it('baseBranch com injeção de argumento (--upload-pack) é rejeitada', async () => {
    const p = pipeline();
    (p.verified as Record<string, unknown>).baseBranch = '--upload-pack=x';
    expect(await errorsOf({ ...base(), pipeline: p })).toEqual(
      expect.arrayContaining([expect.stringMatching(/^pipeline\.verified\.baseBranch:/)]),
    );
  });

  it('campo desconhecido dentro de pipeline.verified → forbidNonWhitelisted', async () => {
    const p = pipeline();
    (p.verified as Record<string, unknown>).stdout = 'segredo';
    expect(await errorsOf({ ...base(), pipeline: p })).toEqual(
      expect.arrayContaining([expect.stringMatching(/^pipeline\.verified\.stdout:whitelistValidation/)]),
    );
  });
});

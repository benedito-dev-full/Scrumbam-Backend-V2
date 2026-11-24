/**
 * pipeline-contract.ts — contrato de saída da esteira (ADR-V2-083).
 * Formato do JSON final do CLI verificado empiricamente (claude 2.1.330):
 * `structured_output` + `subagent_stats.{spawned,completed,failed,started_in_background,by_type}`.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  PIPELINE_APPEND_SYSTEM_PROMPT,
  PIPELINE_LIMITS,
  PIPELINE_RESULT_SCHEMA,
  PIPELINE_RESULT_SCHEMA_JSON,
  parsePipelineOutput,
  isApprovalVerified,
  type ParsedPipelineOutput,
} from '../src/claude-code/pipeline-contract';

function cliJson(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'result',
    subtype: 'success',
    is_error: false,
    session_id: '22df17ba-7d3d-4c0c-ad5d-234a9ad4b03d',
    structured_output: {
      contractVersion: 1,
      decision: 'APPROVED',
      reviewScore: 9,
      stages: [
        { name: 'strategist', status: 'done' },
        { name: 'reviewer', status: 'done' },
      ],
      branch: 'scrumban/exec-1',
      commit: 'a1b2c3d',
      prUrl: 'https://github.com/acme/api/pull/42',
      summary: 'feito',
    },
    subagent_stats: {
      spawned: 4,
      requested: { background: 0, foreground: 4, unset: 0 },
      started_in_background: 0,
      completed: 4,
      failed: 0,
      by_type: { strategist: 1, implementer: 1, reviewer: 1, documenter: 1 },
    },
    ...over,
  };
}

describe('parsePipelineOutput', () => {
  it('JSON válido → declared + subagents do runtime', () => {
    const p = parsePipelineOutput(cliJson());
    expect(p.contractValid).toBe(true);
    expect(p.contractError).toBeNull();
    expect(p.declared?.decision).toBe('APPROVED');
    expect(p.subagents).toEqual({ strategist: 1, implementer: 1, reviewer: 1, documenter: 1 });
    expect(p.runtimeNotes).toBeNull();
  });

  it('stdout não-JSON → contrato inválido', () => {
    const p = parsePipelineOutput(null);
    expect(p).toEqual(expect.objectContaining({ contractValid: false, declared: null, subagents: null }));
  });

  it('sem structured_output (modelo não respondeu no contrato) → inválido, subagents preservados', () => {
    const raw = cliJson();
    delete raw.structured_output;
    const p = parsePipelineOutput(raw);
    expect(p.contractValid).toBe(false);
    expect(p.contractError).toMatch(/structured_output ausente/);
    expect(p.subagents).not.toBeNull();
  });

  it('contractVersion desconhecida → inválido', () => {
    const raw = cliJson();
    (raw.structured_output as Record<string, unknown>).contractVersion = 2;
    expect(parsePipelineOutput(raw).contractError).toMatch(/contractVersion/);
  });

  it('decision fora do contrato / stage inválida / reviewScore fora de 0..10 → inválido', () => {
    for (const mut of [
      (so: Record<string, unknown>) => (so.decision = 'MERGED'),
      (so: Record<string, unknown>) => (so.stages = [{ name: 'x', status: 'talvez' }]),
      (so: Record<string, unknown>) => (so.reviewScore = 11),
      (so: Record<string, unknown>) => (so.summary = 42),
    ]) {
      const raw = cliJson();
      mut(raw.structured_output as Record<string, unknown>);
      expect(parsePipelineOutput(raw).contractValid).toBe(false);
    }
  });

  it('subagent_stats ausente (CLI antigo) → subagents null (backend decide)', () => {
    const raw = cliJson();
    delete raw.subagent_stats;
    expect(parsePipelineOutput(raw).subagents).toBeNull();
  });

  it('sanitiza para os limites do DTO do backend (summary, nomes de subagent, contagens)', () => {
    const raw = cliJson({
      subagent_stats: { by_type: { reviewer: 2, 'rm -rf /': 1, implementer: 1.5 }, started_in_background: 1, failed: 2 },
    });
    (raw.structured_output as Record<string, unknown>).summary = 'x'.repeat(5000);
    const p = parsePipelineOutput(raw);
    expect(p.declared?.summary).toHaveLength(PIPELINE_LIMITS.summary);
    expect(p.subagents).toEqual({ reviewer: 2 });
    expect(p.runtimeNotes).toBe('1 subagente(s) em background; 2 subagente(s) falharam');
  });
});

describe('contrato fixo (cache) e template anti-drift', () => {
  it('append system prompt é curto e não contém mapa de slugs nem regras de branch scrumban/auto', () => {
    expect(PIPELINE_APPEND_SYSTEM_PROMPT.length).toBeLessThan(800);
    expect(PIPELINE_APPEND_SYSTEM_PROMPT).not.toMatch(/scrumban\/auto|Caminho:/);
    expect(PIPELINE_APPEND_SYSTEM_PROMPT).toContain('contractVersion 1');
  });

  it('schema serializado é estável (mesmo objeto → mesma string)', () => {
    expect(PIPELINE_RESULT_SCHEMA_JSON).toBe(JSON.stringify(PIPELINE_RESULT_SCHEMA));
  });

  it('agent/templates/pipeline-result.schema.json (espelho p/ Devari-Core) == schema do código', () => {
    const file = JSON.parse(
      readFileSync(join(__dirname, '..', 'templates', 'pipeline-result.schema.json'), 'utf8'),
    );
    const { $comment, ...schema } = file;
    expect(typeof $comment).toBe('string');
    expect(schema).toEqual(JSON.parse(PIPELINE_RESULT_SCHEMA_JSON));
  });

  it('comando /scrumban-executar: template == cópias do backend e do frontend', () => {
    const tpl = readFileSync(join(__dirname, '..', 'templates', 'scrumban-executar.md'), 'utf8');
    const backend = readFileSync(join(__dirname, '..', '..', '.claude', 'commands', 'scrumban-executar.md'), 'utf8');
    expect(backend).toBe(tpl);
    const frontendPath = join(__dirname, '..', '..', '..', 'frontend', '.claude', 'commands', 'scrumban-executar.md');
    let frontend: string | null = null;
    try {
      frontend = readFileSync(frontendPath, 'utf8');
    } catch {
      frontend = null; // repo do frontend ausente na máquina (CI do backend isolado)
    }
    if (frontend !== null) expect(frontend).toBe(tpl);
  });
});

/**
 * Ciclo 2 / M1+M2 — PARIDADE com o Engine (`OperacaoExecucaoClaude.avaliarDesfechoEsteira`).
 * Cada linha espelha um caso de `src/engine/lib/operacao/__tests__/OperacaoExecucaoClaude.esteira.spec.ts`:
 * `isApprovalVerified=true` ⇔ o Engine não rebaixaria por falta de prova do runtime.
 */
describe('isApprovalVerified — paridade agente × Engine', () => {
  const c = (
    decision: string,
    subagents: Record<string, number> | null,
    contractValid = true,
  ): Pick<ParsedPipelineOutput, 'contractValid' | 'declared' | 'subagents'> => ({
    contractValid,
    declared: contractValid ? ({ decision } as ParsedPipelineOutput['declared']) : null,
    subagents,
  });

  it.each<[string, ReturnType<typeof c>, boolean, boolean]>([
    ['code: APPROVED + reviewer + implementer', c('APPROVED', { reviewer: 1, implementer: 1 }), true, true],
    ['code: APPROVED + reviewer SEM implementer (M1)', c('APPROVED', { reviewer: 1 }), true, false],
    ['code: APPROVED + implementer SEM reviewer (R1)', c('APPROVED', { implementer: 1 }), true, false],
    ['code: APPROVED + subagent_stats ausente', c('APPROVED', null), true, false],
    ['code: NEEDS_CHANGES', c('NEEDS_CHANGES', { reviewer: 1, implementer: 1 }), true, false],
    ['code: contrato inválido', c('APPROVED', { reviewer: 1, implementer: 1 }, false), true, false],
    ['research: APPROVED + ≥1 subagente', c('APPROVED', { strategist: 1 }), false, true],
    ['research: APPROVED sem subagente (M2)', c('APPROVED', {}), false, false],
    ['research: APPROVED com contagens zeradas (M2)', c('APPROVED', { strategist: 0 }), false, false],
  ])('%s', (_label, contract, prRequired, expected) => {
    expect(isApprovalVerified(contract, prRequired)).toBe(expected);
  });
});

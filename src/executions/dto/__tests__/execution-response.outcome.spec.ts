import { serializeExecution, toOutcome } from '../execution-response.dto';
import {
  EXECUTION_FAILURE_REASON_CODES,
  isExecutionFailureReason,
} from '../../constants/execution-lifecycle.const';

/**
 * ADR-V2-082 Ciclo 3 — `ExecutionResponseDto.outcome` = projeção segura de
 * `dados.audit.outcome` (`{ reason, source }`). Contrato consumido pelo frontend.
 */
describe('ExecutionResponseDto.outcome (Ciclo 3)', () => {
  it('CONTRATO: lista canônica de motivos é exatamente esta (frontend mapeia 1:1)', () => {
    expect([...EXECUTION_FAILURE_REASON_CODES].sort()).toEqual(
      [
        'AGENT_RESTARTED',
        'BACKFILL_STALE',
        'DISPATCH_FAILED',
        'DUPLICATE_TASK_EXECUTION',
        'PROJECT_BUSY_EXHAUSTED',
        'QUEUE_STALE',
        'TIMEOUT_NO_CALLBACK',
        'TUNNEL_UNAVAILABLE',
        // ADR-V2-083 (esteira headless) — aditivos; frontend tem fallback genérico
        'PIPELINE_NOT_INSTALLED',
        'PIPELINE_PRECONDITION_FAILED',
        'PIPELINE_CONTRACT_MISSING',
        'PIPELINE_NOT_APPROVED',
        'PR_NOT_CREATED',
      ].sort(),
    );
  });

  it('ADR-V2-083: desfecho do AGENTE expõe motivo da política da esteira (e só ele)', () => {
    for (const code of [
      'PIPELINE_NOT_INSTALLED',
      'PIPELINE_PRECONDITION_FAILED',
      'PIPELINE_CONTRACT_MISSING',
      'PIPELINE_NOT_APPROVED',
      'PR_NOT_CREATED',
    ]) {
      expect(toOutcome({ success: false, source: 'agent', reason: code })).toEqual({
        reason: code,
        source: 'agent',
      });
    }
    // motivo sistêmico com source agent continua oculto
    expect(toOutcome({ source: 'agent', reason: 'QUEUE_STALE' })).toEqual({
      reason: null,
      source: 'agent',
    });
  });

  it('ADR-V2-083: 422 do preflight (source system) expõe PIPELINE_NOT_INSTALLED', () => {
    expect(toOutcome({ source: 'system', reason: 'PIPELINE_NOT_INSTALLED' })).toEqual({
      reason: 'PIPELINE_NOT_INSTALLED',
      source: 'system',
    });
  });

  it('sem desfecho (fila/rodando) → { reason:null, source:null }', () => {
    expect(toOutcome(undefined)).toEqual({ reason: null, source: null });
    expect(toOutcome(null)).toEqual({ reason: null, source: null });
    expect(toOutcome('x')).toEqual({ reason: null, source: null });
    expect(toOutcome([])).toEqual({ reason: null, source: null });
  });

  it.each(EXECUTION_FAILURE_REASON_CODES.map((c) => [c]))(
    'falha sistêmica %s → { reason:%s, source:"system" }',
    (code) => {
      expect(
        toOutcome({ success: false, source: 'system', reason: code, recordedAt: 'x' }),
      ).toEqual({ reason: code, source: 'system' });
    },
  );

  it('reason fora da lista (texto livre / detalhe técnico) NÃO vaza → null', () => {
    for (const bad of ['ECONNREFUSED', 'PROJECT_BUSY: agente recusou 10 tentativas', '', 42]) {
      expect(toOutcome({ source: 'system', reason: bad })).toEqual({
        reason: null,
        source: 'system',
      });
    }
  });

  it('desfecho real do agente → reason null (mesmo que algo tenha sido gravado em reason)', () => {
    expect(toOutcome({ success: false, source: 'agent', recordedAt: 'x' })).toEqual({
      reason: null,
      source: 'agent',
    });
    expect(toOutcome({ source: 'agent', reason: 'TIMEOUT_NO_CALLBACK' })).toEqual({
      reason: null,
      source: 'agent',
    });
  });

  it('outcome legado sem source (pré-ADR-V2-082, só callback gravava) → source "agent"', () => {
    expect(toOutcome({ success: true, recordedAt: '2026-05-12T10:00:00.000Z' })).toEqual({
      reason: null,
      source: 'agent',
    });
  });

  it('serializeExecution expõe SÓ {reason, source} — sem supersedes/recordedAt/errorCode', () => {
    const dto = serializeExecution({
      chave: BigInt(1),
      idClasse: BigInt(-301),
      dados: {
        claude: { exitCode: -1, stderr: 'TIMEOUT_NO_CALLBACK', finishedAt: 'x' },
        audit: {
          projectId: '20',
          errorCode: 'TIMEOUT_NO_CALLBACK',
          outcome: {
            success: true,
            source: 'agent',
            recordedAt: 'y',
            supersedes: { reason: 'TIMEOUT_NO_CALLBACK', recordedAt: 'z' },
          },
        },
      },
    });

    expect(dto.outcome).toEqual({ reason: null, source: 'agent' });
    expect(Object.keys(dto.outcome).sort()).toEqual(['reason', 'source']);
  });

  it('serializeExecution de execução sistêmica → código canônico identificável', () => {
    const dto = serializeExecution({
      chave: BigInt(2),
      idClasse: BigInt(-302),
      dados: {
        statusCode: '-520',
        claude: { exitCode: -1, stderr: 'Execucao 9 da mesma task ja esta RUNNING', finishedAt: 'x' },
        audit: {
          outcome: { success: false, source: 'system', reason: 'DUPLICATE_TASK_EXECUTION', recordedAt: 'x' },
        },
      },
    });

    expect(dto.outcome).toEqual({ reason: 'DUPLICATE_TASK_EXECUTION', source: 'system' });
    expect(isExecutionFailureReason(dto.outcome.reason)).toBe(true);
  });
});

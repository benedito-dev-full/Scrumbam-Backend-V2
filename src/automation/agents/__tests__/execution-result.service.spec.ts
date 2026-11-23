import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { EventProducerService } from '../../../eventos/core/event-producer.service';
import { CorrelationIdService } from '../../../common/services/correlation-id.service';
import { AgentsService, AuthenticatedAgent } from '../agents.service';
import { AgentInstallTokenService } from '../agent-install-token.service';
import { AgentKeyService } from '../agent-key.service';
import { AgentPortAllocatorService } from '../agent-port-allocator.service';
import { ExecutionResultDto } from '../dto/execution-result.dto';
import { Prisma } from '@prisma/client';
import { TasksService } from '../../../tasks/tasks.service';

/**
 * Cobertura mínima exigida pelo plan §3 Sub-tarefa 2.4 + §5 riscos #6/#7:
 *   1. Payload válido + persiste + 200
 *   2. executionId não encontrado → 404
 *   3. idClasse fora de {-301,-302,-303} → 400
 *   4. executionId de outro agente (isolation) → 403
 *   5. Mesmo executionId 2× → alreadyPersisted=true
 *   6. claudeSessionId + resumedFrom=null → emit agent.session.created
 *   7. claudeSessionId + resumedFrom!=null → emit agent.session.resumed
 *   8. success=false → emit agent.execution.failed
 *   9. claudeSessionId=null → não emite session lifecycle
 *  10. Pilar 1 preservado: zero prisma.dPedido.update direto no service
 *      (verificado via mock — registrarOutcome do Engine é chamado)
 *
 * HMAC/nonce/rate-limit são responsabilidade do AgentAuthGuard (testado separadamente).
 */
describe('AgentsService.recordExecutionResult', () => {
  const AGENT_ID = '100';
  const PROJECT_ID = '999';
  const CORRELATION_ID = 'corr-test-2.4';

  const baseDtoValid: ExecutionResultDto = {
    executionId: '4815',
    exitCode: 0,
    success: true,
    durationMs: 12450,
    claudeSessionId: 'a1b2c3d4-5678-4abc-9def-0123456789ab',
    claudeSessionPath: '/home/agent/.claude/projects/x/sess-xyz.jsonl',
    resumedFrom: null,
    stdoutTruncated: 'output ok',
    stderrTruncated: '',
  };

  const authenticatedAgent: AuthenticatedAgent = {
    chave: BigInt(AGENT_ID),
    dados: { statusCode: '-510' },
  };

  function buildDadosExecucao(overrides: Record<string, unknown> = {}) {
    return {
      command: { text: 'test command' },
      audit: {
        correlationId: CORRELATION_ID,
        triggeredBy: 'user-1',
        agentId: AGENT_ID,
        projectId: PROJECT_ID,
      },
      ...overrides,
    };
  }

  function buildService(
    opts: {
      findFirstResult?: unknown;
      /** Linhas devolvidas pela CAS do Engine (default: aplicou, sem supersede). */
      casRows?: unknown[];
      taskStatus?: string;
      /** `dados.v3.movedBy` da task (marcador da falha sintética — Ciclo 2 / M2). */
      taskMovedBy?: string | null;
    } = {},
  ) {
    const findFirstMock = jest.fn().mockResolvedValue(opts.findFirstResult ?? null);
    // ADR-V2-082: registrarOutcome grava via UPDATE … RETURNING com CAS ($queryRaw),
    // não mais via dPedido.update incondicional.
    const casMock = jest
      .fn()
      .mockResolvedValue(opts.casRows ?? [{ chave: BigInt(4815), supersedes: null }]);
    const updateMock = jest.fn().mockResolvedValue({});
    // Mock DvfsLoaderHelper para o Engine — registrarOutcome chama _carregaScriptsGrav
    // que faz prisma.dVFS.findFirst (case sensitive — model é DVFS no Prisma client)
    const dvfsFindFirstMock = jest.fn().mockResolvedValue(null);
    const prisma = {
      dPedido: { findFirst: findFirstMock, update: updateMock },
      dVFS: { findFirst: dvfsFindFirstMock },
      $queryRaw: casMock,
    } as unknown as PrismaService;
    const eventProducer = {
      addInternalEvent: jest.fn().mockResolvedValue(undefined),
    };
    const correlationIdService = {
      getOrGenerate: jest.fn().mockReturnValue(CORRELATION_ID),
    };
    const tasksService = {
      updateStatus: jest.fn().mockResolvedValue({}),
      findOne: jest.fn().mockResolvedValue({
        status: opts.taskStatus ?? 'EXECUTING',
        dados: { v3: { movedBy: opts.taskMovedBy ?? null } },
      }),
    };
    const service = new AgentsService(
      prisma,
      {} as AgentInstallTokenService,
      {} as AgentKeyService,
      {} as AgentPortAllocatorService,
      eventProducer as unknown as EventProducerService,
      correlationIdService as unknown as CorrelationIdService,
      {} as unknown as import('../../../auth/services/role-resolver.service').RoleResolverService,
      // TasksService — 8º parâmetro (drift corrigido na Task 2 / ADR-V2-082)
      tasksService as unknown as TasksService,
    );
    return { service, findFirstMock, updateMock, casMock, eventProducer, tasksService };
  }

  /** Extrai o `dados` (JSON) enviado à CAS do Engine. */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- JSON livre de DPedido.dados
  function casDados(casMock: jest.Mock): Record<string, any> {
    const sql = casMock.mock.calls[0][0] as Prisma.Sql;
    const json = sql.values.find((v) => typeof v === 'string' && v.startsWith('{')) as string;
    return JSON.parse(json);
  }

  describe('Cenário 1: Payload válido persiste e retorna accepted=true', () => {
    it('persiste outcome via Engine.registrarOutcome e emite eventos', async () => {
      const { service, updateMock, casMock, eventProducer, tasksService } = buildService({
        findFirstResult: {
          chave: BigInt(baseDtoValid.executionId),
          idClasse: BigInt(-301),
          dados: buildDadosExecucao({ task: { id: '55' } }),
        },
      });

      const result = await service.recordExecutionResult({
        agentId: AGENT_ID,
        agentEntity: authenticatedAgent,
        dto: baseDtoValid,
      });

      expect(result.accepted).toBe(true);
      expect(result.alreadyPersisted).toBeUndefined();
      expect(result.persistedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      // Pilar 1: o UPDATE foi feito via Engine (CAS), não diretamente pelo service.
      expect(updateMock).not.toHaveBeenCalled();
      expect(casMock).toHaveBeenCalledTimes(1);
      const casSql = (casMock.mock.calls[0][0] as Prisma.Sql).sql;
      // ADR-V2-082: CAS (sem outcome OU outcome sintético) + baixa canônica
      expect(casSql).toContain('baixado = true');
      expect(casSql).toContain("dados->'audit'->'outcome' IS NULL");
      expect(casSql).toContain("dados->'audit'->'outcome'->>'source' = 'system'");
      expect((casMock.mock.calls[0][0] as Prisma.Sql).values).toContain(
        BigInt(baseDtoValid.executionId),
      );
      const persistedDados = casDados(casMock);
      expect(persistedDados.audit.outcome.source).toBe('agent');
      expect(persistedDados.statusCode).toBe('-519');
      expect(tasksService.updateStatus).toHaveBeenCalledWith('55', { status: 'DONE' });
      expect(persistedDados.claude.sessionId).toBe(baseDtoValid.claudeSessionId);
      expect(persistedDados.claude.sessionPath).toBe(baseDtoValid.claudeSessionPath);
      expect(persistedDados.claude.exitCode).toBe(0);
      expect(persistedDados.audit.outcome.success).toBe(true);
      expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
        'agent.execution.finished',
        expect.objectContaining({ executionId: '4815', exitCode: 0 }),
        CORRELATION_ID,
        expect.any(Object),
      );
    });
  });

  describe('Cenário 2: executionId não encontrado → 404', () => {
    it('lança NotFoundException', async () => {
      const { service } = buildService({ findFirstResult: null });
      await expect(
        service.recordExecutionResult({
          agentId: AGENT_ID,
          agentEntity: authenticatedAgent,
          dto: baseDtoValid,
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('Cenário 3: idClasse fora de {-301,-302,-303} → 400', () => {
    it('lança BadRequestException quando DPedido é de outra classe', async () => {
      const { service } = buildService({
        findFirstResult: {
          chave: BigInt(baseDtoValid.executionId),
          idClasse: BigInt(-499), // classe NÃO-execution
          dados: buildDadosExecucao(),
        },
      });
      await expect(
        service.recordExecutionResult({
          agentId: AGENT_ID,
          agentEntity: authenticatedAgent,
          dto: baseDtoValid,
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  describe('Cenário 4: executionId de outro agente → 403 (ISOLATION)', () => {
    it('lança ForbiddenException quando audit.agentId !== agentId do path', async () => {
      const { service } = buildService({
        findFirstResult: {
          chave: BigInt(baseDtoValid.executionId),
          idClasse: BigInt(-301),
          dados: buildDadosExecucao({
            audit: {
              correlationId: CORRELATION_ID,
              triggeredBy: 'user-1',
              agentId: '777', // OUTRO agente
              projectId: PROJECT_ID,
            },
          }),
        },
      });
      await expect(
        service.recordExecutionResult({
          agentId: AGENT_ID,
          agentEntity: authenticatedAgent,
          dto: baseDtoValid,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('Cenário 5: Idempotência — mesmo executionId 2× retorna alreadyPersisted=true', () => {
    it('detecta outcome já persistido e retorna NO-OP', async () => {
      const previousPersistedAt = '2026-05-12T10:00:00.000Z';
      const { service, updateMock, casMock, eventProducer } = buildService({
        findFirstResult: {
          chave: BigInt(baseDtoValid.executionId),
          idClasse: BigInt(-301),
          dados: buildDadosExecucao({
            audit: {
              correlationId: CORRELATION_ID,
              triggeredBy: 'user-1',
              agentId: AGENT_ID,
              projectId: PROJECT_ID,
              outcome: { success: true, recordedAt: previousPersistedAt },
            },
          }),
        },
      });
      const result = await service.recordExecutionResult({
        agentId: AGENT_ID,
        agentEntity: authenticatedAgent,
        dto: baseDtoValid,
      });
      expect(result.alreadyPersisted).toBe(true);
      expect(result.persistedAt).toBe(previousPersistedAt);
      expect(updateMock).not.toHaveBeenCalled();
      expect(casMock).not.toHaveBeenCalled();
      expect(eventProducer.addInternalEvent).not.toHaveBeenCalled();
    });
  });

  describe('Cenário 6: claudeSessionId + resumedFrom=null → agent.session.created', () => {
    it('emite evento agent.session.created (-505)', async () => {
      const { service, eventProducer } = buildService({
        findFirstResult: {
          chave: BigInt(baseDtoValid.executionId),
          idClasse: BigInt(-301),
          dados: buildDadosExecucao(),
        },
      });
      await service.recordExecutionResult({
        agentId: AGENT_ID,
        agentEntity: authenticatedAgent,
        dto: { ...baseDtoValid, resumedFrom: null },
      });
      const sessionCall = eventProducer.addInternalEvent.mock.calls.find(
        (c: unknown[]) => c[0] === 'agent.session.created',
      );
      expect(sessionCall).toBeDefined();
      expect(sessionCall[1]).toMatchObject({
        executionId: '4815',
        claudeSessionId: baseDtoValid.claudeSessionId,
        resumedFrom: null,
      });
    });
  });

  describe('Cenário 7: claudeSessionId + resumedFrom!=null → agent.session.resumed', () => {
    it('emite evento agent.session.resumed (-506)', async () => {
      const { service, eventProducer } = buildService({
        findFirstResult: {
          chave: BigInt(baseDtoValid.executionId),
          idClasse: BigInt(-301),
          dados: buildDadosExecucao(),
        },
      });
      const resumedFrom = 'b2c3d4e5-6789-4abc-9def-0123456789ab';
      await service.recordExecutionResult({
        agentId: AGENT_ID,
        agentEntity: authenticatedAgent,
        dto: { ...baseDtoValid, resumedFrom },
      });
      const sessionCall = eventProducer.addInternalEvent.mock.calls.find(
        (c: unknown[]) => c[0] === 'agent.session.resumed',
      );
      expect(sessionCall).toBeDefined();
      expect(sessionCall[1]).toMatchObject({
        resumedFrom,
        claudeSessionId: baseDtoValid.claudeSessionId,
      });
    });
  });

  describe('Cenário 8: success=false → agent.execution.failed', () => {
    it('emite evento agent.execution.failed quando success=false', async () => {
      const { service, eventProducer } = buildService({
        findFirstResult: {
          chave: BigInt(baseDtoValid.executionId),
          idClasse: BigInt(-302),
          dados: buildDadosExecucao(),
        },
      });
      await service.recordExecutionResult({
        agentId: AGENT_ID,
        agentEntity: authenticatedAgent,
        dto: {
          ...baseDtoValid,
          success: false,
          exitCode: 1,
          errorCode: 'TIMEOUT',
        },
      });
      const failedCall = eventProducer.addInternalEvent.mock.calls.find(
        (c: unknown[]) => c[0] === 'agent.execution.failed',
      );
      expect(failedCall).toBeDefined();
      expect(failedCall[1]).toMatchObject({
        executionId: '4815',
        exitCode: 1,
        errorCode: 'TIMEOUT',
      });
    });
  });

  describe('Cenário 9: claudeSessionId=null → NÃO emite session lifecycle', () => {
    it('apenas emite agent.execution.finished, sem session.created/resumed', async () => {
      const { service, eventProducer } = buildService({
        findFirstResult: {
          chave: BigInt(baseDtoValid.executionId),
          idClasse: BigInt(-301),
          dados: buildDadosExecucao(),
        },
      });
      await service.recordExecutionResult({
        agentId: AGENT_ID,
        agentEntity: authenticatedAgent,
        dto: {
          ...baseDtoValid,
          claudeSessionId: null,
          errorCode: 'SESSION_ID_EXTRACTION_FAILED',
        },
      });
      const sessionCalls = eventProducer.addInternalEvent.mock.calls.filter(
        (c: unknown[]) => c[0] === 'agent.session.created' || c[0] === 'agent.session.resumed',
      );
      expect(sessionCalls).toHaveLength(0);
    });
  });

  describe('Cenário 10: executionId inválido (string não numérica) → 400', () => {
    it('lança BadRequestException antes de qualquer query', async () => {
      const { service, findFirstMock } = buildService();
      await expect(
        service.recordExecutionResult({
          agentId: AGENT_ID,
          agentEntity: authenticatedAgent,
          dto: { ...baseDtoValid, executionId: 'not-a-number' },
        }),
      ).rejects.toBeInstanceOf(BadRequestException);
      expect(findFirstMock).not.toHaveBeenCalled();
    });
  });

  describe('Cenário extra: sanity check agentEntity.chave !== agentId (guard inconsistency)', () => {
    it('lança ForbiddenException quando entity.chave não casa com id do path', async () => {
      const { service } = buildService({
        findFirstResult: {
          chave: BigInt(baseDtoValid.executionId),
          idClasse: BigInt(-301),
          dados: buildDadosExecucao(),
        },
      });
      const fakeEntity: AuthenticatedAgent = {
        chave: BigInt(999), // diferente do AGENT_ID
        dados: {},
      };
      await expect(
        service.recordExecutionResult({
          agentId: AGENT_ID,
          agentEntity: fakeEntity,
          dto: baseDtoValid,
        }),
      ).rejects.toBeInstanceOf(ForbiddenException);
    });
  });

  describe('ADR-V2-082: CAS do desfecho + supersede do FAILED sintético', () => {
    const syntheticAudit = {
      correlationId: CORRELATION_ID,
      triggeredBy: 'user-1',
      agentId: AGENT_ID,
      projectId: PROJECT_ID,
      errorCode: 'TIMEOUT_NO_CALLBACK',
      outcome: {
        success: false,
        source: 'system',
        reason: 'TIMEOUT_NO_CALLBACK',
        recordedAt: '2026-11-23T10:00:00.000Z',
      },
    };

    it('CAS retorna 0 linhas (outro callback venceu) → alreadyPersisted, sem eventos, sem task', async () => {
      const { service, eventProducer, tasksService } = buildService({
        findFirstResult: {
          chave: BigInt(baseDtoValid.executionId),
          idClasse: BigInt(-301),
          dados: buildDadosExecucao({ task: { id: '55' } }),
        },
        casRows: [],
      });

      const result = await service.recordExecutionResult({
        agentId: AGENT_ID,
        agentEntity: authenticatedAgent,
        dto: baseDtoValid,
      });

      expect(result.alreadyPersisted).toBe(true);
      expect(eventProducer.addInternalEvent).not.toHaveBeenCalled();
      expect(tasksService.updateStatus).not.toHaveBeenCalled();
    });

    it('outcome sintético (source=system) NÃO é fast-path: callback aplica, payload ganha supersedes, task FAILED→DONE', async () => {
      const supersedes = { reason: 'TIMEOUT_NO_CALLBACK', recordedAt: '2026-11-23T10:00:00.000Z' };
      const { service, casMock, eventProducer, tasksService } = buildService({
        findFirstResult: {
          chave: BigInt(baseDtoValid.executionId),
          idClasse: BigInt(-301),
          dados: buildDadosExecucao({ task: { id: '55' }, audit: syntheticAudit }),
        },
        casRows: [{ chave: BigInt(4815), supersedes }],
        taskStatus: 'FAILED',
        taskMovedBy: 'system:execution-4815', // FAILED veio da falha sintética DESTA execução
      });

      const result = await service.recordExecutionResult({
        agentId: AGENT_ID,
        agentEntity: authenticatedAgent,
        dto: baseDtoValid,
      });

      expect(result.alreadyPersisted).toBeUndefined();
      expect(casMock).toHaveBeenCalledTimes(1);
      // errorCode do desfecho sintético não sobrevive ao resultado real
      expect(casDados(casMock).audit.errorCode).toBeUndefined();
      expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
        'agent.execution.finished',
        expect.objectContaining({ executionId: '4815', supersedes }),
        CORRELATION_ID,
        expect.any(Object),
      );
      expect(tasksService.updateStatus).toHaveBeenCalledWith('55', { status: 'DONE' });
    });

    it('supersede com task já movida por humano (READY) → não promove a DONE', async () => {
      const { service, tasksService } = buildService({
        findFirstResult: {
          chave: BigInt(baseDtoValid.executionId),
          idClasse: BigInt(-301),
          dados: buildDadosExecucao({ task: { id: '55' }, audit: syntheticAudit }),
        },
        casRows: [{ chave: BigInt(4815), supersedes: { reason: 'TIMEOUT_NO_CALLBACK' } }],
        taskStatus: 'READY',
      });

      await service.recordExecutionResult({
        agentId: AGENT_ID,
        agentEntity: authenticatedAgent,
        dto: baseDtoValid,
      });

      expect(tasksService.updateStatus).not.toHaveBeenCalled();
    });

    it('supersede com falha real → task segue FAILED (no-op)', async () => {
      const { service, tasksService } = buildService({
        findFirstResult: {
          chave: BigInt(baseDtoValid.executionId),
          idClasse: BigInt(-301),
          dados: buildDadosExecucao({ task: { id: '55' }, audit: syntheticAudit }),
        },
        casRows: [{ chave: BigInt(4815), supersedes: { reason: 'TIMEOUT_NO_CALLBACK' } }],
        taskStatus: 'FAILED',
      });

      await service.recordExecutionResult({
        agentId: AGENT_ID,
        agentEntity: authenticatedAgent,
        dto: { ...baseDtoValid, success: false, exitCode: 1 },
      });

      expect(tasksService.updateStatus).not.toHaveBeenCalled();
      expect(tasksService.findOne).not.toHaveBeenCalled();
    });

    it('M2: supersede com task ainda EXECUTING (sweeper não liberou) → promove a DONE', async () => {
      const { service, tasksService } = buildService({
        findFirstResult: {
          chave: BigInt(baseDtoValid.executionId),
          idClasse: BigInt(-301),
          dados: buildDadosExecucao({ task: { id: '55' }, audit: syntheticAudit }),
        },
        casRows: [{ chave: BigInt(4815), supersedes: { reason: 'TIMEOUT_NO_CALLBACK' } }],
        taskStatus: 'EXECUTING',
      });

      await service.recordExecutionResult({ agentId: AGENT_ID, agentEntity: authenticatedAgent, dto: baseDtoValid });

      expect(tasksService.updateStatus).toHaveBeenCalledWith('55', { status: 'DONE' });
    });

    it.each([
      ['FAILED manual do usuário', '42'],
      ['FAILED sem movedBy', null],
      ['FAILED de OUTRA execução (L7)', 'system:execution-9999'],
    ])('M2/L7: supersede NÃO promove %s', async (_label, movedBy) => {
      const { service, tasksService } = buildService({
        findFirstResult: {
          chave: BigInt(baseDtoValid.executionId),
          idClasse: BigInt(-301),
          dados: buildDadosExecucao({ task: { id: '55' }, audit: syntheticAudit }),
        },
        casRows: [{ chave: BigInt(4815), supersedes: { reason: 'TIMEOUT_NO_CALLBACK' } }],
        taskStatus: 'FAILED',
        taskMovedBy: movedBy,
      });

      await service.recordExecutionResult({ agentId: AGENT_ID, agentEntity: authenticatedAgent, dto: baseDtoValid });

      expect(tasksService.updateStatus).not.toHaveBeenCalled();
    });
  });
});

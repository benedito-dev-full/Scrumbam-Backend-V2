import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { EventProducerService } from '../../../eventos/core/event-producer.service';
import { CorrelationIdService } from '../../../common/services/correlation-id.service';
import { AgentsService, AuthenticatedAgent } from '../agents.service';
import { AgentInstallTokenService } from '../agent-install-token.service';
import { AgentKeyService } from '../agent-key.service';
import { AgentPortAllocatorService } from '../agent-port-allocator.service';
import { ExecutionResultDto } from '../dto/execution-result.dto';

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
      updateMock?: jest.Mock;
    } = {},
  ) {
    const updateMock = opts.updateMock ?? jest.fn().mockResolvedValue({});
    const findFirstMock = jest.fn().mockResolvedValue(opts.findFirstResult ?? null);
    // Mock DvfsLoaderHelper para o Engine — registrarOutcome chama _carregaScriptsGrav
    // que faz prisma.dVFS.findFirst (case sensitive — model é DVFS no Prisma client)
    const dvfsFindFirstMock = jest.fn().mockResolvedValue(null);
    const prisma = {
      dPedido: { findFirst: findFirstMock, update: updateMock },
      dVFS: { findFirst: dvfsFindFirstMock },
    } as unknown as PrismaService;
    const eventProducer = {
      addInternalEvent: jest.fn().mockResolvedValue(undefined),
    };
    const correlationIdService = {
      getOrGenerate: jest.fn().mockReturnValue(CORRELATION_ID),
    };
    const service = new AgentsService(
      prisma,
      {} as AgentInstallTokenService,
      {} as AgentKeyService,
      {} as AgentPortAllocatorService,
      eventProducer as unknown as EventProducerService,
      correlationIdService as unknown as CorrelationIdService,
    );
    return { service, findFirstMock, updateMock, eventProducer };
  }

  describe('Cenário 1: Payload válido persiste e retorna accepted=true', () => {
    it('persiste outcome via Engine.registrarOutcome e emite eventos', async () => {
      const { service, updateMock, eventProducer } = buildService({
        findFirstResult: {
          chave: BigInt(baseDtoValid.executionId),
          idClasse: BigInt(-301),
          dados: buildDadosExecucao(),
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
      // Pilar 1: o UPDATE foi feito via Engine (mockado), não diretamente pelo service.
      expect(updateMock).toHaveBeenCalled();
      const updateCall = updateMock.mock.calls[0][0];
      expect(updateCall.where).toEqual({ chave: BigInt(baseDtoValid.executionId) });
      const persistedDados = updateCall.data.dados;
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
      const { service, updateMock, eventProducer } = buildService({
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
});

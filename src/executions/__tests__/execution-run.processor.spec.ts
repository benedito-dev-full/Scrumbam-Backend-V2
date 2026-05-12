import { Logger } from '@nestjs/common';
import { Job } from 'bullmq';
import { ExecutionRunProcessor } from '../processors/execution-run.processor';
import { ExecutionRunJobData } from '../queues/execution-queue.service';
import { PrismaService } from '../../prisma.service';
import { EventProducerService } from '../../eventos/core/event-producer.service';
import { AgentTunnelService } from '../../automation/agents/agent-tunnel.service';
import { RemoteExecutionClient } from '../../automation/runtime/remote-execution-client';
import { ExecutionRuntimeLogService } from '../../automation/runtime/execution-runtime-log.service';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

interface DependencyStubs {
  prisma: PrismaService;
  eventProducer: EventProducerService;
  agentTunnel: AgentTunnelService;
  remoteClient: RemoteExecutionClient;
  logService: ExecutionRuntimeLogService;
}

function buildProcessor(stubs: DependencyStubs): ExecutionRunProcessor {
  return new ExecutionRunProcessor(
    stubs.prisma,
    stubs.eventProducer,
    stubs.agentTunnel,
    stubs.remoteClient,
    stubs.logService,
  );
}

function buildJob(): Job<ExecutionRunJobData> {
  return {
    data: {
      executionId: '123',
      projectId: '20',
      agentId: '30',
      enqueuedAt: new Date().toISOString(),
    },
  } as Job<ExecutionRunJobData>;
}

describe('ExecutionRunProcessor', () => {
  it('falha fechado quando probe do agent esta offline e nao executa RUN_CLAUDE_CODE', async () => {
    const pedido = {
      chave: BigInt(123),
      idClasse: BigInt(-301),
      idLocEscritu: BigInt(20),
      dados: {
        statusCode: '-514',
        prompt: 'refatore o servico X',
        audit: { projectId: '20', agentId: '30', correlationId: 'corr' },
      },
    };
    const prisma = {
      dPedido: {
        findFirst: jest.fn().mockResolvedValue(pedido),
        update: jest.fn().mockResolvedValue({}),
      },
      dProject: {
        findFirst: jest.fn().mockResolvedValue({
          chave: BigInt(20),
          dados: {
            slug: 'projeto-x',
            automation: { remotePath: '/srv/repo' },
          },
        }),
      },
      dEntidade: {
        findFirst: jest.fn().mockResolvedValue({
          chave: BigInt(30),
          dados: { tunnelPort: 20000, agentCommandSecretEncrypted: 'encrypted' },
        }),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
    const eventProducer = {
      addInternalEvent: jest.fn().mockResolvedValue(undefined),
    };
    const agentTunnel = {
      probe: jest.fn().mockResolvedValue({ tunnelOk: false, error: 'TUNNEL_UNAVAILABLE' }),
    };
    const remoteClient = { execute: jest.fn() };
    const logService = {
      createContext: jest
        .fn()
        .mockReturnValue({ nextSequence: 1, bytesWritten: 0, truncated: false }),
      recordSystem: jest.fn().mockResolvedValue(undefined),
    };

    const processor = buildProcessor({
      prisma: prisma as unknown as PrismaService,
      eventProducer: eventProducer as unknown as EventProducerService,
      agentTunnel: agentTunnel as unknown as AgentTunnelService,
      remoteClient: remoteClient as unknown as RemoteExecutionClient,
      logService: logService as unknown as ExecutionRuntimeLogService,
    });

    await processor.process(buildJob());

    expect(remoteClient.execute).not.toHaveBeenCalled();
    expect(prisma.dPedido.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { chave: BigInt(123) },
        data: expect.objectContaining({
          dados: expect.objectContaining({
            statusCode: '-520',
            claude: expect.objectContaining({ stderr: 'TUNNEL_UNAVAILABLE' }),
          }),
        }),
      }),
    );
    expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
      'execution.failed',
      expect.objectContaining({
        executionId: '123',
        projectId: '20',
        agentId: '30',
      }),
      'corr',
      { source: ExecutionRunProcessor.name },
    );
    expect(eventProducer.addInternalEvent).not.toHaveBeenCalledWith(
      'execution.started',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });

  it('falha fechado quando contrato runtime do agent esta incompleto', async () => {
    const pedido = {
      chave: BigInt(123),
      idClasse: BigInt(-301),
      idLocEscritu: BigInt(20),
      dados: {
        statusCode: '-514',
        prompt: 'refatore o servico X',
        audit: { projectId: '20', agentId: '30', correlationId: 'corr' },
      },
    };
    const prisma = {
      dPedido: {
        findFirst: jest.fn().mockResolvedValue(pedido),
        update: jest.fn().mockResolvedValue({}),
      },
      dProject: {
        findFirst: jest.fn().mockResolvedValue({
          chave: BigInt(20),
          dados: {
            slug: 'projeto-x',
            automation: { remotePath: '/srv/repo' },
          },
        }),
      },
      dEntidade: {
        findFirst: jest.fn().mockResolvedValue({
          chave: BigInt(30),
          // sem agentCommandSecretEncrypted → contrato incompleto
          dados: { tunnelPort: 20000 },
        }),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
    const eventProducer = {
      addInternalEvent: jest.fn().mockResolvedValue(undefined),
    };
    const processor = buildProcessor({
      prisma: prisma as unknown as PrismaService,
      eventProducer: eventProducer as unknown as EventProducerService,
      agentTunnel: { probe: jest.fn() } as unknown as AgentTunnelService,
      remoteClient: { execute: jest.fn() } as unknown as RemoteExecutionClient,
      logService: {
        createContext: jest.fn().mockReturnValue({
          nextSequence: 1,
          bytesWritten: 0,
          truncated: false,
        }),
        recordSystem: jest.fn().mockResolvedValue(undefined),
      } as unknown as ExecutionRuntimeLogService,
    });

    await processor.process(buildJob());

    expect(prisma.dPedido.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { chave: BigInt(123) },
        data: expect.objectContaining({
          dados: expect.objectContaining({
            statusCode: '-520',
            claude: expect.objectContaining({
              stderr: 'Agent sem tunnelPort ou agentCommandSecretEncrypted.',
            }),
          }),
        }),
      }),
    );
    expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
      'execution.failed',
      expect.objectContaining({ executionId: '123' }),
      'corr',
      { source: ExecutionRunProcessor.name },
    );
  });

  it('falha barulhento quando DProject.dados.slug ausente (V2)', async () => {
    const pedido = {
      chave: BigInt(123),
      idClasse: BigInt(-301),
      idLocEscritu: BigInt(20),
      dados: {
        statusCode: '-514',
        prompt: 'refatore o servico X',
        audit: { projectId: '20', agentId: '30', correlationId: 'corr' },
      },
    };
    const prisma = {
      dPedido: {
        findFirst: jest.fn().mockResolvedValue(pedido),
        update: jest.fn().mockResolvedValue({}),
      },
      dProject: {
        findFirst: jest.fn().mockResolvedValue({
          chave: BigInt(20),
          // sem slug! → InternalServerErrorException
          dados: { automation: { remotePath: '/srv/repo' } },
        }),
      },
      dEntidade: {
        findFirst: jest.fn().mockResolvedValue({
          chave: BigInt(30),
          dados: { tunnelPort: 20000, agentCommandSecretEncrypted: 'encrypted' },
        }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const eventProducer = {
      addInternalEvent: jest.fn().mockResolvedValue(undefined),
    };
    const agentTunnel = {
      probe: jest.fn().mockResolvedValue({ tunnelOk: true }),
    };
    const remoteClient = { execute: jest.fn() };
    const logService = {
      createContext: jest.fn().mockReturnValue({
        nextSequence: 1,
        bytesWritten: 0,
        truncated: false,
      }),
      recordSystem: jest.fn().mockResolvedValue(undefined),
    };

    const processor = buildProcessor({
      prisma: prisma as unknown as PrismaService,
      eventProducer: eventProducer as unknown as EventProducerService,
      agentTunnel: agentTunnel as unknown as AgentTunnelService,
      remoteClient: remoteClient as unknown as RemoteExecutionClient,
      logService: logService as unknown as ExecutionRuntimeLogService,
    });

    await processor.process(buildJob());

    // remoteClient.execute NUNCA chamado — falha aconteceu antes do dispatch
    expect(remoteClient.execute).not.toHaveBeenCalled();

    // status final FAILED com mensagem clara sobre slug
    const finishCall = prisma.dPedido.update.mock.calls[0]?.[0] as {
      data: { dados: { claude: { stderr: string }; statusCode: string } };
    };
    expect(finishCall.data.dados.statusCode).toBe('-520');
    expect(finishCall.data.dados.claude.stderr).toContain('slug');
  });

  it('dispatch RUN_CLAUDE_CODE com payload V2 quando tudo OK', async () => {
    const pedido = {
      chave: BigInt(123),
      idClasse: BigInt(-301),
      idLocEscritu: BigInt(20),
      dados: {
        statusCode: '-514',
        prompt: 'aplique correcao no servico Y',
        resumeSessionId: '550e8400-e29b-41d4-a716-446655440000',
        timeoutSec: 600,
        audit: { projectId: '20', agentId: '30', correlationId: 'corr-z' },
      },
    };
    const prisma = {
      dPedido: {
        findFirst: jest.fn().mockResolvedValue(pedido),
        update: jest.fn().mockResolvedValue({}),
      },
      dProject: {
        findFirst: jest.fn().mockResolvedValue({
          chave: BigInt(20),
          dados: { slug: 'scrumban-backend-v2' },
        }),
      },
      dEntidade: {
        findFirst: jest.fn().mockResolvedValue({
          chave: BigInt(30),
          dados: { tunnelPort: 20000, agentCommandSecretEncrypted: 'encrypted' },
        }),
      },
      $executeRaw: jest.fn().mockResolvedValue(1),
    };
    const eventProducer = {
      addInternalEvent: jest.fn().mockResolvedValue(undefined),
    };
    const agentTunnel = {
      probe: jest.fn().mockResolvedValue({ tunnelOk: true }),
    };
    const remoteClient = {
      execute: jest.fn().mockResolvedValue({ accepted: true, executionId: '123' }),
    };
    const logService = {
      createContext: jest.fn().mockReturnValue({
        nextSequence: 1,
        bytesWritten: 0,
        truncated: false,
      }),
      recordSystem: jest.fn().mockResolvedValue(undefined),
    };

    const processor = buildProcessor({
      prisma: prisma as unknown as PrismaService,
      eventProducer: eventProducer as unknown as EventProducerService,
      agentTunnel: agentTunnel as unknown as AgentTunnelService,
      remoteClient: remoteClient as unknown as RemoteExecutionClient,
      logService: logService as unknown as ExecutionRuntimeLogService,
    });

    await processor.process(buildJob());

    expect(remoteClient.execute).toHaveBeenCalledTimes(1);
    expect(remoteClient.execute).toHaveBeenCalledWith(
      expect.objectContaining({
        executionId: '123',
        projectId: '20',
        correlationId: 'corr-z',
        projectSlug: 'scrumban-backend-v2',
        idClasseRisk: -301,
        prompt: 'aplique correcao no servico Y',
        resumeSessionId: '550e8400-e29b-41d4-a716-446655440000',
        timeoutSec: 600,
        agent: expect.objectContaining({ agentId: '30', tunnelPort: 20000 }),
      }),
    );
    expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
      'execution.started',
      expect.objectContaining({ executionId: '123' }),
      'corr-z',
      { source: ExecutionRunProcessor.name },
    );
    // execution.failed/succeeded NAO sao emitidos aqui — fica para callback (Sub 2.4)
    expect(eventProducer.addInternalEvent).not.toHaveBeenCalledWith(
      'execution.failed',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
    expect(eventProducer.addInternalEvent).not.toHaveBeenCalledWith(
      'execution.succeeded',
      expect.anything(),
      expect.anything(),
      expect.anything(),
    );
  });
});

import { Logger } from '@nestjs/common';
import { ExecutionRunProcessor } from '../processors/execution-run.processor';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'debug').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('ExecutionRunProcessor', () => {
  it('falha fechado quando probe do agent esta offline e nao executa comando remoto', async () => {
    const pedido = {
      chave: BigInt(123),
      idClasse: BigInt(-301),
      idLocEscritu: BigInt(20),
      dados: {
        statusCode: '-514',
        command: { text: 'npm test', executable: 'npm', args: ['test'] },
        audit: { projectId: '20', agentId: '30', correlationId: 'corr' },
      },
    };
    const prisma = {
      dPedido: {
        findFirst: jest.fn().mockResolvedValue(pedido),
        update: jest.fn().mockResolvedValue({}),
      },
      dProject: {
        findFirst: jest.fn().mockResolvedValue({ chave: BigInt(20), dados: { automation: { remotePath: '/srv/repo' } } }),
      },
      dEntidade: {
        findFirst: jest.fn().mockResolvedValue({
          chave: BigInt(30),
          dados: { tunnelPort: 20000, agentCommandSecretEncrypted: 'encrypted' },
        }),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
    const eventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };
    const agentTunnel = {
      probe: jest.fn().mockResolvedValue({ tunnelOk: false, error: 'TUNNEL_UNAVAILABLE' }),
    };
    const remoteClient = { execute: jest.fn() };
    const logService = {
      createContext: jest.fn().mockReturnValue({ nextSequence: 1, bytesWritten: 0, truncated: false }),
      recordSystem: jest.fn().mockResolvedValue(undefined),
    };
    const processor = new ExecutionRunProcessor(
      prisma as any,
      eventProducer as any,
      agentTunnel as any,
      remoteClient as any,
      logService as any,
      { prepare: jest.fn() } as any,
      { rollbackWorktree: jest.fn() } as any,
      { openPrIfNeeded: jest.fn() } as any,
    );

    await processor.process({
      data: {
        executionId: '123',
        projectId: '20',
        agentId: '30',
        enqueuedAt: new Date().toISOString(),
      },
    } as any);

    expect(remoteClient.execute).not.toHaveBeenCalled();
    expect(prisma.dPedido.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { chave: BigInt(123) },
      data: expect.objectContaining({
        dados: expect.objectContaining({
          statusCode: '-520',
          claude: expect.objectContaining({ stderr: 'TUNNEL_UNAVAILABLE' }),
        }),
      }),
    }));
    expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
      'execution.failed',
      expect.objectContaining({ executionId: '123', projectId: '20', agentId: '30' }),
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
        command: { text: 'npm test', executable: 'npm', args: ['test'] },
        audit: { projectId: '20', agentId: '30', correlationId: 'corr' },
      },
    };
    const prisma = {
      dPedido: {
        findFirst: jest.fn().mockResolvedValue(pedido),
        update: jest.fn().mockResolvedValue({}),
      },
      dProject: {
        findFirst: jest.fn().mockResolvedValue({ chave: BigInt(20), dados: { automation: { remotePath: '/srv/repo' } } }),
      },
      dEntidade: {
        findFirst: jest.fn().mockResolvedValue({
          chave: BigInt(30),
          dados: { tunnelPort: 20000 },
        }),
      },
      $executeRaw: jest.fn().mockResolvedValue(0),
    };
    const eventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };
    const processor = new ExecutionRunProcessor(
      prisma as any,
      eventProducer as any,
      { probe: jest.fn() } as any,
      { execute: jest.fn() } as any,
      {
        createContext: jest.fn().mockReturnValue({ nextSequence: 1, bytesWritten: 0, truncated: false }),
        recordSystem: jest.fn().mockResolvedValue(undefined),
      } as any,
      { prepare: jest.fn() } as any,
      { rollbackWorktree: jest.fn() } as any,
      { openPrIfNeeded: jest.fn() } as any,
    );

    await processor.process({
      data: {
        executionId: '123',
        projectId: '20',
        agentId: '30',
        enqueuedAt: new Date().toISOString(),
      },
    } as any);

    expect(prisma.dPedido.update).toHaveBeenCalledWith(expect.objectContaining({
      where: { chave: BigInt(123) },
      data: expect.objectContaining({
        dados: expect.objectContaining({
          statusCode: '-520',
          claude: expect.objectContaining({
            stderr: 'Agent sem tunnelPort ou agentCommandSecretEncrypted.',
          }),
        }),
      }),
    }));
    expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
      'execution.failed',
      expect.objectContaining({ executionId: '123' }),
      'corr',
      { source: ExecutionRunProcessor.name },
    );
  });
});

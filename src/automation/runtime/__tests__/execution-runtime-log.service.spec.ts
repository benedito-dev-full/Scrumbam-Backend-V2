import { ExecutionRuntimeLogService } from '../execution-runtime-log.service';
import { AUTOMATION_CLASS_IDS } from '../../constants/automation-class-ids';

describe('ExecutionRuntimeLogService', () => {
  function buildService() {
    const prisma = {
      dEvento: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    return {
      service: new ExecutionRuntimeLogService(prisma as any),
      prisma,
    };
  }

  it('grava stdout sequencial e marca truncamento', async () => {
    const { service, prisma } = buildService();
    const context = {
      nextSequence: 1,
      bytesWritten: 1024 * 1024 - 2,
      truncated: false,
    };

    await service.recordOutputLine({
      executionId: '1',
      projectId: '2',
      agentId: '3',
      correlationId: 'corr',
      stream: 'stdout',
      line: 'abcdef',
    }, context);

    expect(context.truncated).toBe(true);
    expect(prisma.dEvento.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idClasse: AUTOMATION_CLASS_IDS.EXECUTION_LOG_EVENT,
        descricao: 'execution.stdout',
        metaDados: expect.objectContaining({
          sequence: 1,
          truncated: true,
          code: 'OUTPUT_LIMIT_EXCEEDED',
        }),
      }),
    });
  });

  it('grava log de sistema em DEvento -496', async () => {
    const { service, prisma } = buildService();

    await service.recordSystem({
      executionId: '1',
      projectId: '2',
      agentId: '3',
      correlationId: 'corr',
      line: 'runtime failed',
      code: 'FAILED',
      sequence: 7,
    });

    expect(prisma.dEvento.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        idClasse: AUTOMATION_CLASS_IDS.EXECUTION_LOG_EVENT,
        descricao: 'execution.system',
        metaDados: expect.objectContaining({
          sequence: 7,
          line: 'runtime failed',
          code: 'FAILED',
        }),
      }),
    });
  });
});

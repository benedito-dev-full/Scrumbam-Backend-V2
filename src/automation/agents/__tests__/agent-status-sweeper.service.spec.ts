import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma.service';
import { EventProducerService } from '../../../eventos/core/event-producer.service';
import { CorrelationIdService } from '../../../common/services/correlation-id.service';
import { AUTOMATION_CLASS_IDS } from '../../constants/automation-class-ids';
import { AgentStatusSweeperService } from '../agent-status-sweeper.service';

describe('AgentStatusSweeperService', () => {
  it('marca agents online obsoletos como offline e emite agent.offline apos transaction', async () => {
    const staleLastSeen = new Date(Date.now() - 120_000).toISOString();
    const tx = {
      dEntidade: {
        findMany: jest.fn().mockResolvedValue([
          {
            chave: BigInt(77),
            dados: {
              statusCode: AUTOMATION_CLASS_IDS.AGENT_STATUS_ONLINE.toString(),
              lastSeen: staleLastSeen,
            },
          },
        ]),
        update: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaService;
    const eventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };

    const service = new AgentStatusSweeperService(
      prisma,
      { get: jest.fn().mockReturnValue('90') } as unknown as ConfigService,
      eventProducer as unknown as EventProducerService,
      { getOrGenerate: jest.fn().mockReturnValue('corr') } as unknown as CorrelationIdService,
    );

    await service.sweepOfflineAgents();

    expect(tx.dEntidade.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { chave: BigInt(77) },
        data: expect.objectContaining({
          dados: expect.objectContaining({
            statusCode: AUTOMATION_CLASS_IDS.AGENT_STATUS_OFFLINE.toString(),
          }),
        }),
      }),
    );
    expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
      'agent.offline',
      { agentId: '77' },
      'corr',
      { source: AgentStatusSweeperService.name },
    );
  });
});

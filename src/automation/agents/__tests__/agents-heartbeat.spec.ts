import { PrismaService } from '../../../prisma.service';
import { EventProducerService } from '../../../eventos/core/event-producer.service';
import { CorrelationIdService } from '../../../common/services/correlation-id.service';
import { AUTOMATION_CLASS_IDS } from '../../constants/automation-class-ids';
import { AgentsService } from '../agents.service';
import { AgentInstallTokenService } from '../agent-install-token.service';
import { AgentKeyService } from '../agent-key.service';
import { AgentPortAllocatorService } from '../agent-port-allocator.service';

describe('AgentsService heartbeat', () => {
  it('atualiza lastSeen/status, grava DEvento -492 e emite agent.online na transicao offline->online', async () => {
    const tx = {
      dEntidade: { update: jest.fn().mockResolvedValue({}) },
      dEvento: { create: jest.fn().mockResolvedValue({}) },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaService;
    const eventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };
    const service = new AgentsService(
      prisma,
      {} as AgentInstallTokenService,
      {} as AgentKeyService,
      {} as AgentPortAllocatorService,
      eventProducer as unknown as EventProducerService,
      { getOrGenerate: jest.fn().mockReturnValue('corr') } as unknown as CorrelationIdService,
      {} as unknown as import('../../../auth/services/role-resolver.service').RoleResolverService,
    );

    const result = await service.heartbeat(
      {
        chave: BigInt(1),
        dados: { statusCode: AUTOMATION_CLASS_IDS.AGENT_STATUS_OFFLINE.toString() },
      },
      { agentVersion: '1.0.0' },
    );

    expect(result.statusCode).toBe(AUTOMATION_CLASS_IDS.AGENT_STATUS_ONLINE.toString());
    expect(tx.dEntidade.update).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { chave: BigInt(1) },
        data: expect.objectContaining({
          dados: expect.objectContaining({
            statusCode: AUTOMATION_CLASS_IDS.AGENT_STATUS_ONLINE.toString(),
            agentVersion: '1.0.0',
          }),
        }),
      }),
    );
    expect(tx.dEvento.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idClasse: AUTOMATION_CLASS_IDS.AGENT_HEARTBEAT_EVENT,
          idEntidade: BigInt(1),
          descricao: 'agent.heartbeat',
        }),
      }),
    );
    expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
      'agent.online',
      expect.objectContaining({ agentId: '1' }),
      'corr',
      { source: AgentsService.name },
    );
  });
});

import { PrismaService } from '../../../prisma.service';
import { EventProducerService } from '../../../eventos/core/event-producer.service';
import { CorrelationIdService } from '../../../common/services/correlation-id.service';
import { AUTOMATION_CLASS_IDS } from '../../constants/automation-class-ids';
import { AgentsService } from '../agents.service';
import { AgentInstallTokenService } from '../agent-install-token.service';
import { AgentKeyService } from '../agent-key.service';
import { AgentPortAllocatorService } from '../agent-port-allocator.service';

describe('AgentsService install', () => {
  it('consome token, cria agent/vinculo em transaction e emite agent.registered apos commit', async () => {
    const tx = {
      dEntidade: {
        create: jest.fn().mockResolvedValue({ chave: BigInt(900) }),
      },
      dVincula: {
        create: jest.fn().mockResolvedValue({}),
      },
    };
    const prisma = {
      $transaction: jest.fn(async (fn: (client: typeof tx) => unknown) => fn(tx)),
    } as unknown as PrismaService;
    const installTokenService = {
      consumeInstallToken: jest.fn().mockResolvedValue({
        tokenId: BigInt(10),
        projectId: BigInt(20),
        createdBy: BigInt(30),
      }),
    };
    const agentKeyService = {
      generateSecret: jest
        .fn()
        .mockReturnValueOnce('agent-api-key')
        .mockReturnValueOnce('agent-command-secret'),
      hashSecret: jest.fn().mockReturnValue('h'.repeat(64)),
      encryptCommandSecret: jest.fn().mockReturnValue('encrypted-command-secret'),
    };
    const portAllocator = { allocate: jest.fn().mockResolvedValue(20000) };
    const eventProducer = { addInternalEvent: jest.fn().mockResolvedValue(undefined) };

    const service = new AgentsService(
      prisma,
      installTokenService as unknown as AgentInstallTokenService,
      agentKeyService as unknown as AgentKeyService,
      portAllocator as unknown as AgentPortAllocatorService,
      eventProducer as unknown as EventProducerService,
      { getOrGenerate: jest.fn().mockReturnValue('corr') } as unknown as CorrelationIdService,
    );

    const result = await service.install({
      installToken: 'plain-token',
      hostname: 'vps-01',
      os: 'linux',
      agentVersion: '1.0.0',
      claudeVersion: '2.0.0',
    });

    expect(result).toEqual({
      agentId: '900',
      agentApiKey: 'agent-api-key',
      agentCommandSecret: 'agent-command-secret',
      tunnelPort: 20000,
    });
    expect(tx.dEntidade.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idClasse: AUTOMATION_CLASS_IDS.AGENT,
          nome: 'vps-01',
          idLocEscritu: BigInt(20),
          dados: expect.objectContaining({
            projectId: '20',
            apiKeyHash: 'h'.repeat(64),
            agentCommandSecretEncrypted: 'encrypted-command-secret',
            tunnelPort: 20000,
          }),
        }),
      }),
    );
    expect(tx.dVincula.create).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          idClasse: AUTOMATION_CLASS_IDS.PROJECT_AGENT,
          idLocEscritu: BigInt(20),
          idEntidade: BigInt(900),
        }),
      }),
    );
    expect(eventProducer.addInternalEvent).toHaveBeenCalledWith(
      'agent.registered',
      { agentId: '900', tunnelPort: 20000 },
      'corr',
      { source: AgentsService.name },
    );
  });
});

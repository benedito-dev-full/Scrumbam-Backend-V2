import { ConfigService } from '@nestjs/config';
import { AgentPortAllocatorService } from '../agent-port-allocator.service';

describe('AgentPortAllocatorService', () => {
  it('usa advisory lock e retorna a primeira porta livre no range', async () => {
    const service = new AgentPortAllocatorService({
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          AGENT_PORT_MIN: '20000',
          AGENT_PORT_MAX: '20002',
          AGENT_PORT_LOCK_KEY: '1337',
        };
        return values[key];
      }),
    } as unknown as ConfigService);
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      dEntidade: {
        findMany: jest.fn().mockResolvedValue([
          { dados: { tunnelPort: 20000 } },
          { dados: { tunnelPort: 20002 } },
        ]),
      },
    };

    await expect(service.allocate(tx as any)).resolves.toBe(20001);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(1);
    expect(tx.dEntidade.findMany).toHaveBeenCalledWith(
      expect.objectContaining({
        select: { dados: true },
      }),
    );
  });

  it('duas alocacoes sequenciais com lock veem portas diferentes quando o estado muda', async () => {
    const service = new AgentPortAllocatorService({
      get: jest.fn((key: string) => {
        const values: Record<string, string> = {
          AGENT_PORT_MIN: '20000',
          AGENT_PORT_MAX: '20001',
          AGENT_PORT_LOCK_KEY: '1337',
        };
        return values[key];
      }),
    } as unknown as ConfigService);
    const tx = {
      $executeRaw: jest.fn().mockResolvedValue(1),
      dEntidade: {
        findMany: jest
          .fn()
          .mockResolvedValueOnce([])
          .mockResolvedValueOnce([{ dados: { tunnelPort: 20000 } }]),
      },
    };

    await expect(service.allocate(tx as any)).resolves.toBe(20000);
    await expect(service.allocate(tx as any)).resolves.toBe(20001);
    expect(tx.$executeRaw).toHaveBeenCalledTimes(2);
  });
});

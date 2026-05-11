import { AutomationMetricsService } from '../automation-metrics.service';

describe('AutomationMetricsService', () => {
  it('agrega status, p95 e falhas sem N+1', async () => {
    const prisma = {
      $queryRaw: jest
        .fn()
        .mockResolvedValueOnce([
          { status_code: '-510', total: BigInt(2), last_seen: new Date('2026-05-11T10:00:00.000Z') },
          { status_code: '-511', total: BigInt(1), last_seen: new Date('2026-05-11T09:00:00.000Z') },
        ])
        .mockResolvedValueOnce([
          { status_code: '-518', total: BigInt(1) },
          { status_code: '-520', total: BigInt(2) },
        ])
        .mockResolvedValueOnce([{ queue_p95_ms: 1500, runtime_p95_ms: 45000 }])
        .mockResolvedValueOnce([{ agent_id: '30', total: BigInt(2) }]),
    };
    const service = new AutomationMetricsService(prisma as any);

    const result = await service.getOverview();

    expect(prisma.$queryRaw).toHaveBeenCalledTimes(4);
    expect(result.agentsOnline).toBe(2);
    expect(result.agentsOffline).toBe(1);
    expect(result.lastHeartbeatAt).toBe('2026-05-11T10:00:00.000Z');
    expect(result.executionsByStatus).toEqual({ '-518': 1, '-520': 2 });
    expect(result.queueP95Ms).toBe(1500);
    expect(result.runtimeP95Ms).toBe(45000);
    expect(result.failuresByAgent).toEqual({ '30': 2 });
  });
});

import { Logger } from '@nestjs/common';
import { buildBusyRetryJobId, ExecutionQueueService } from '../queues/execution-queue.service';
import { InMemoryQueueService } from '../queues/in-memory-queue.service';

beforeAll(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});
afterAll(() => jest.restoreAllMocks());

/**
 * ADR-V2-082 — re-enfileiramento do 409 PROJECT_BUSY.
 */
describe('ExecutionQueueService.enqueueRetry', () => {
  it('jobId único por tentativa (`<id>-busy-<n>`, sem `:`) + delay + busyAttempt no payload', async () => {
    const queue = { add: jest.fn().mockResolvedValue(undefined) };
    const service = new ExecutionQueueService(queue as never);

    const data = await service.enqueueRetry(
      { executionId: '123', projectId: '20', agentId: '30' },
      { attempt: 2, delayMs: 60000 },
    );

    expect(data.busyAttempt).toBe(2);
    expect(queue.add).toHaveBeenCalledWith(
      'run',
      expect.objectContaining({ executionId: '123', busyAttempt: 2 }),
      expect.objectContaining({ jobId: '123-busy-2', delay: 60000, attempts: 1 }),
    );
  });

  it('jobIds de tentativas diferentes não colidem com o jobId original nem entre si', () => {
    const ids = [1, 2, 3, 10].map((n) => buildBusyRetryJobId('123', n));
    expect(new Set([...ids, '123']).size).toBe(ids.length + 1);
    expect(ids.every((id) => !id.includes(':'))).toBe(true);
  });

  it('InMemoryQueueService.enqueueRetry é no-op com paridade de interface', async () => {
    const svc = new InMemoryQueueService();
    await expect(
      svc.enqueueRetry({ executionId: '1', projectId: '2', agentId: '3' }, { attempt: 1, delayMs: 1 }),
    ).resolves.toMatchObject({ executionId: '1', busyAttempt: 1 });
  });
});

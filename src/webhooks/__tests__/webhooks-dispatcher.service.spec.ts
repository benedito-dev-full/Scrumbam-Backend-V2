import { WebhooksDispatcherService } from '../services/webhooks-dispatcher.service';

describe('WebhooksDispatcherService', () => {
  it('enfileira job inicial com contrato serializado e deliveryId gerado', async () => {
    const queue = { add: jest.fn().mockResolvedValue({}) };
    const service = new WebhooksDispatcherService(queue as never);

    const result = await service.enqueueDispatch({
      webhookId: '90071992547409931234',
      eventType: 'task.created',
      eventId: '90071992547409931235',
      payload: { taskId: '1' },
    });

    expect(result.webhookId).toBe('90071992547409931234');
    expect(result.eventId).toBe('90071992547409931235');
    expect(result.attempt).toBe(1);
    expect(result.deliveryId).toEqual(expect.any(String));
    expect(queue.add).toHaveBeenCalledWith(
      'dispatch',
      result,
      expect.objectContaining({
        attempts: 1,
        jobId: `${result.deliveryId}:1`,
      }),
    );
  });
});

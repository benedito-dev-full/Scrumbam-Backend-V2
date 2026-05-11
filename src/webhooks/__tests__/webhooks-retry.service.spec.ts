import { WebhooksRetryService } from '../services/webhooks-retry.service';

describe('WebhooksRetryService', () => {
  it('calcula delays manuais exatos por tentativa', () => {
    const config = { get: jest.fn().mockReturnValue('10') };
    const service = new WebhooksRetryService(config as never);

    expect(service.calcDelay(1)).toBe(60_000);
    expect(service.calcDelay(2)).toBe(300_000);
    expect(service.calcDelay(3)).toBe(1_800_000);
    expect(service.calcDelay(99)).toBe(1_800_000);
  });

  it('avalia threshold de auto-disable sem parseInt em IDs', () => {
    const config = { get: jest.fn().mockReturnValue('10') };
    const service = new WebhooksRetryService(config as never);

    expect(service.shouldAutoDisable(9)).toBe(false);
    expect(service.shouldAutoDisable(10)).toBe(true);
  });
});

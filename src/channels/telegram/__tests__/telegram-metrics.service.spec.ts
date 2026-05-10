import { TelegramMetricsService } from '../telegram-metrics.service';

describe('TelegramMetricsService', () => {
  let service: TelegramMetricsService;

  beforeEach(() => {
    service = new TelegramMetricsService();
  });

  it('deve contar eventos por tipo', () => {
    service.recordEvent('text', 'corr-1');
    service.recordEvent('text', 'corr-2');
    service.recordEvent('voice', 'corr-3');

    expect(service.getCount('text')).toBe(2);
    expect(service.getCount('voice')).toBe(1);
  });

  it('deve calcular P95 de latencia de transcricao', () => {
    [10, 20, 30, 40, 50].forEach((duration, index) => {
      service.recordTranscriptionLatency(duration, `corr-${index}`);
    });

    expect(service.getTranscriptionP95()).toBe(50);
  });
});

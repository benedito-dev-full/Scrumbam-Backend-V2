import { Test, TestingModule } from '@nestjs/testing';
import { TimezoneService } from './timezone.service';

describe('TimezoneService', () => {
  let service: TimezoneService;

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      providers: [TimezoneService],
    }).compile();

    service = module.get<TimezoneService>(TimezoneService);
  });

  describe('applyDateFilters', () => {
    it('deve retornar gte/lte corretos em America/Sao_Paulo', () => {
      const result = service.applyDateFilters('2026-01-15', '2026-01-31');

      expect(result.gte).toBeInstanceOf(Date);
      expect(result.lte).toBeInstanceOf(Date);
      // gte deve ser 00:00:00 Brasília = 03:00:00 UTC
      expect(result.gte.toISOString()).toBe('2026-01-15T03:00:00.000Z');
      // lte deve ser 23:59:59.999 Brasília = 02:59:59.999 UTC do dia seguinte
      expect(result.lte.toISOString()).toBe('2026-02-01T02:59:59.999Z');
    });
  });

  describe('toStartOfDayBrazil', () => {
    it('deve retornar 00:00:00.000 no timezone de Brasília (em UTC)', () => {
      const date = new Date('2026-05-09T18:00:00Z'); // 15:00 Brasília
      const result = service.toStartOfDayBrazil(date);

      // 00:00:00 de 2026-05-09 em Brasília = 03:00:00 UTC
      expect(result.toISOString()).toBe('2026-05-09T03:00:00.000Z');
    });
  });

  describe('toEndOfDayBrazil', () => {
    it('deve retornar 23:59:59.999 no timezone de Brasília (em UTC)', () => {
      const date = new Date('2026-05-09T18:00:00Z'); // 15:00 Brasília
      const result = service.toEndOfDayBrazil(date);

      // 23:59:59.999 de 2026-05-09 em Brasília = 03:00:00 UTC do dia seguinte menos 1ms
      // ou seja 2026-05-10T02:59:59.999Z
      expect(result.toISOString()).toBe('2026-05-10T02:59:59.999Z');
    });
  });

  describe('getPeriodDates', () => {
    it("deve retornar o dia atual para 'today'", () => {
      const result = service.getPeriodDates('today');

      expect(result.gte).toBeInstanceOf(Date);
      expect(result.lte).toBeInstanceOf(Date);
      expect(result.gte.getTime()).toBeLessThan(result.lte.getTime());

      // gte deve ser start of day (horas 0 UTC do dia)
      const gteHours = result.gte.getUTCHours();
      expect([0, 1, 2, 3]).toContain(gteHours); // UTC-3 offset
    });

    it("deve retornar a semana atual para 'week'", () => {
      const result = service.getPeriodDates('week');

      expect(result.gte).toBeInstanceOf(Date);
      expect(result.lte).toBeInstanceOf(Date);
      // A semana deve ter pelo menos 6 dias (pode variar se estamos na segunda ou domingo)
      const diffMs = result.lte.getTime() - result.gte.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThanOrEqual(6);
      expect(diffDays).toBeLessThanOrEqual(7);
    });

    it("deve retornar o mês atual para 'month'", () => {
      const result = service.getPeriodDates('month');

      expect(result.gte).toBeInstanceOf(Date);
      expect(result.lte).toBeInstanceOf(Date);
      // O mês deve ter entre 27 e 31 dias
      const diffMs = result.lte.getTime() - result.gte.getTime();
      const diffDays = diffMs / (1000 * 60 * 60 * 24);
      expect(diffDays).toBeGreaterThanOrEqual(27);
      expect(diffDays).toBeLessThanOrEqual(31);
    });

    it("deve retornar o mês anterior para 'lastMonth'", () => {
      const result = service.getPeriodDates('lastMonth');
      const today = new Date();

      expect(result.gte).toBeInstanceOf(Date);
      expect(result.lte).toBeInstanceOf(Date);
      // lte deve ser antes de hoje
      expect(result.lte.getTime()).toBeLessThan(today.getTime());
    });
  });
});

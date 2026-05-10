import { calculatePercentiles, percentile, mean } from '../percentile';

describe('percentile helpers', () => {
  describe('percentile()', () => {
    it('deve retornar null para array vazio', () => {
      expect(percentile([], 50)).toBeNull();
    });

    it('deve retornar o único elemento para array de 1 item', () => {
      expect(percentile([42], 50)).toBe(42);
      expect(percentile([42], 95)).toBe(42);
    });

    it('deve calcular mediana corretamente (N ímpar)', () => {
      expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    });

    it('deve calcular mediana com interpolação (N par)', () => {
      const result = percentile([1, 2, 3, 4], 50);
      expect(result).toBeCloseTo(2.5, 5);
    });

    it('deve calcular p90 corretamente', () => {
      const arr = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const result = percentile(arr, 90);
      expect(result).toBeCloseTo(9.1, 5);
    });

    it('deve retornar o mínimo para p0', () => {
      expect(percentile([10, 20, 30], 0)).toBe(10);
    });

    it('deve retornar o máximo para p100', () => {
      expect(percentile([10, 20, 30], 100)).toBe(30);
    });

    it('deve lidar com valores repetidos', () => {
      expect(percentile([5, 5, 5, 5, 5], 50)).toBe(5);
    });
  });

  describe('mean()', () => {
    it('deve retornar null para array vazio', () => {
      expect(mean([])).toBeNull();
    });

    it('deve calcular média simples', () => {
      expect(mean([1, 2, 3, 4, 5])).toBe(3);
    });

    it('deve calcular média com decimais', () => {
      expect(mean([1, 2])).toBeCloseTo(1.5, 5);
    });
  });

  describe('calculatePercentiles()', () => {
    it('deve retornar null para array vazio', () => {
      expect(calculatePercentiles([])).toBeNull();
    });

    it('deve calcular todos os percentis para array de 1 elemento', () => {
      const result = calculatePercentiles([10]);
      expect(result).not.toBeNull();
      expect(result!.p50).toBe(10);
      expect(result!.p75).toBe(10);
      expect(result!.p90).toBe(10);
      expect(result!.p95).toBe(10);
      expect(result!.avg).toBe(10);
      expect(result!.samples).toBe(1);
    });

    it('deve calcular percentis para N elementos', () => {
      const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10];
      const result = calculatePercentiles(values);
      expect(result).not.toBeNull();
      expect(result!.p50).toBeCloseTo(5.5, 1);
      expect(result!.avg).toBe(5.5);
      expect(result!.samples).toBe(10);
    });

    it('deve ordenar internamente (não mutante)', () => {
      const values = [10, 1, 5, 3];
      const copy = [...values];
      calculatePercentiles(values);
      // Original não foi mutado
      expect(values).toEqual(copy);
    });

    it('deve garantir p50 <= p75 <= p90 <= p95', () => {
      const values = [1, 2, 3, 5, 8, 13, 21, 34, 55, 89];
      const result = calculatePercentiles(values);
      expect(result!.p50).toBeLessThanOrEqual(result!.p75);
      expect(result!.p75).toBeLessThanOrEqual(result!.p90);
      expect(result!.p90).toBeLessThanOrEqual(result!.p95);
    });

    it('deve arredondar a 2 casas decimais', () => {
      const values = [1, 3, 7];
      const result = calculatePercentiles(values);
      expect(result).not.toBeNull();
      // Verificar que o valor tem no máximo 2 casas decimais
      // (checando que toFixed(2) não muda o valor significativamente)
      const rounded = Math.round(result!.p50 * 100) / 100;
      expect(result!.p50).toBeCloseTo(rounded, 5);
    });
  });
});

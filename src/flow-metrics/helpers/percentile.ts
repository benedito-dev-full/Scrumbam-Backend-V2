/**
 * Cálculo de percentis sobre arrays numéricos ordenados.
 *
 * Funções puras sem dependências externas — reutilizáveis em qualquer
 * contexto Devari-Core (flow-metrics, forecast, reports).
 *
 * Algoritmo: interpolação linear NIST (C=1, D=0) — padrão estatístico
 * adequado para amostras pequenas (N≥1) sem viés em extremos.
 *
 * @module percentile
 */

/**
 * Resultado completo de estatísticas de percentil.
 */
export interface PercentileResult {
  /** Mediana (50º percentil) */
  p50: number;
  /** 75º percentil */
  p75: number;
  /** 90º percentil */
  p90: number;
  /** 95º percentil */
  p95: number;
  /** Média aritmética */
  avg: number;
  /** Número de amostras */
  samples: number;
}

/**
 * Calcula um percentil usando interpolação linear NIST sobre array.
 *
 * O array de entrada DEVE estar ordenado em ordem crescente.
 * Para N=0 retorna null (sem dados). Para N=1 retorna o único valor.
 *
 * @param sorted - Array de números em ordem crescente (não vazio)
 * @param p - Percentil desejado [0..100]
 * @returns Valor interpolado do percentil, ou null se array vazio
 *
 * @example
 * ```typescript
 * const arr = [1, 2, 3, 4, 5];
 * percentile(arr, 50); // 3 (mediana)
 * percentile(arr, 90); // 4.6
 * percentile([], 50);  // null
 * ```
 */
export function percentile(sorted: number[], p: number): number | null {
  if (sorted.length === 0) return null;
  if (sorted.length === 1) return sorted[0];

  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  const fraction = index - lower;

  if (lower === upper) return sorted[lower];
  return sorted[lower] * (1 - fraction) + sorted[upper] * fraction;
}

/**
 * Calcula média aritmética de um array de números.
 *
 * @param values - Array de números (não vazio)
 * @returns Média aritmética ou null se array vazio
 *
 * @example
 * ```typescript
 * mean([1, 2, 3, 4, 5]); // 3
 * mean([]);               // null
 * ```
 */
export function mean(values: number[]): number | null {
  if (values.length === 0) return null;
  return values.reduce((acc, v) => acc + v, 0) / values.length;
}

/**
 * Calcula p50/p75/p90/p95/avg/samples sobre um array de números.
 *
 * Faz sort interno (não mutante — cria cópia) e aplica interpolação
 * linear. Retorna null para arrays vazios.
 *
 * Uso típico: cycle time, lead time em horas.
 * A unidade dos valores é preservada (não converte internamente).
 *
 * @param values - Array de números (qualquer ordem)
 * @returns PercentileResult ou null se sem dados
 *
 * @example
 * ```typescript
 * const result = calculatePercentiles([10, 20, 30, 40, 50]);
 * // { p50: 30, p75: 40, p90: 46, p95: 48, avg: 30, samples: 5 }
 *
 * const empty = calculatePercentiles([]);
 * // null
 * ```
 *
 * @see PercentileResult — estrutura de retorno
 */
export function calculatePercentiles(values: number[]): PercentileResult | null {
  if (values.length === 0) return null;

  const sorted = [...values].sort((a, b) => a - b);
  const n = sorted.length;

  const p50v = percentile(sorted, 50) ?? sorted[0];
  const p75v = percentile(sorted, 75) ?? sorted[0];
  const p90v = percentile(sorted, 90) ?? sorted[0];
  const p95v = percentile(sorted, 95) ?? sorted[0];
  const avgV = mean(sorted) ?? sorted[0];

  return {
    p50: Math.round(p50v * 100) / 100,
    p75: Math.round(p75v * 100) / 100,
    p90: Math.round(p90v * 100) / 100,
    p95: Math.round(p95v * 100) / 100,
    avg: Math.round(avgV * 100) / 100,
    samples: n,
  };
}

/**
 * Engine Monte Carlo para forecast de conclusão de projetos.
 *
 * Implementa bootstrap resample (Decisão D3, plano §5) para simular
 * distribuição de dias até conclusão das tasks restantes.
 *
 * Bootstrap resample (não Normal N(μ,σ)) — padrão da indústria Agile:
 * - Não assume normalidade da distribuição de throughput
 * - Robusto para amostras pequenas (4-6 sprints)
 * - Preserva caudas reais (sprints com feriados, velocidade atípica)
 * - Referência: "When Will It Be Done?" (Vacanti, 2017)
 *
 * Parâmetro `seed?` aceito para determinismo em testes (Mulberry32).
 * Em runtime sem seed, usa Math.random puro.
 *
 * @module monte-carlo.engine
 */

/**
 * Parâmetros de entrada do Monte Carlo.
 */
export interface MonteCarloParams {
  /** Tasks restantes a completar */
  tasksRemaining: number;
  /** Array de throughput histórico por período (ex: [3, 5, 7, 4, 6]) */
  throughputHistorical: number[];
  /** Número de iterações (default: 10.000) */
  iterations?: number;
  /** Seed para determinismo em testes (opcional) */
  seed?: number;
}

/**
 * Resultado do Monte Carlo.
 */
export interface MonteCarloResult {
  /** Dias até conclusão — 50% de confiança */
  p50: number;
  /** Dias até conclusão — 75% de confiança */
  p75: number;
  /** Dias até conclusão — 85% de confiança */
  p85: number;
  /** Dias até conclusão — 95% de confiança */
  p95: number;
  /** Iterações realizadas */
  iterations: number;
  /** Throughput médio histórico */
  avgThroughput: number;
}

/**
 * Cria um gerador de números pseudo-aleatórios Mulberry32 determinístico.
 *
 * Usado em testes para garantir resultados reproduzíveis.
 * Em produção (sem seed), Math.random é preferido.
 *
 * @param seed - Semente inteira positiva
 * @returns Função que retorna float em [0, 1)
 *
 * @example
 * ```typescript
 * const rng = mulberry32(42);
 * rng(); // 0.17694034682586789 (determinístico)
 * ```
 */
function mulberry32(seed: number): () => number {
  let s = seed >>> 0;
  return function () {
    s += 0x6d2b79f5;
    let z = s;
    z = Math.imul(z ^ (z >>> 15), z | 1);
    z ^= z + Math.imul(z ^ (z >>> 7), z | 61);
    return ((z ^ (z >>> 14)) >>> 0) / 0x100000000;
  };
}

/**
 * Calcula um percentil via interpolação linear sobre array ordenado.
 *
 * @param sorted - Array em ordem crescente
 * @param p - Percentil [0..100]
 */
function calcPercentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];

  const index = (p / 100) * (sorted.length - 1);
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];

  return sorted[lower] * (1 - (index - lower)) + sorted[upper] * (index - lower);
}

/**
 * Simula distribuição de dias até conclusão via bootstrap resample.
 *
 * Algoritmo por iteração:
 * 1. Sortear (com reposição) valores do throughputHistorical
 * 2. Acumular até atingir tasksRemaining
 * 3. Contar períodos usados = estimativa de duração em períodos
 *
 * Os "períodos" correspondem à granularidade do throughput histórico
 * (dias ou semanas). O resultado é em "períodos", mas o ForecastService
 * converte para dias antes de retornar ao controller.
 *
 * @param params - Parâmetros de simulação
 * @returns MonteCarloResult com p50/p75/p85/p95
 *
 * @throws {Error} Se throughputHistorical.length < 2 (validar antes de chamar)
 * @throws {Error} Se tasksRemaining <= 0
 *
 * @example
 * ```typescript
 * const result = simulate({
 *   tasksRemaining: 30,
 *   throughputHistorical: [3, 5, 7, 4, 6, 5],
 *   iterations: 10000,
 *   seed: 42, // para determinismo
 * });
 * // { p50: 6, p75: 8, p85: 9, p95: 12, iterations: 10000, avgThroughput: 5 }
 * ```
 *
 * @see MonteCarloParams — parâmetros de entrada
 * @see MonteCarloResult — estrutura de retorno
 */
export function simulate(params: MonteCarloParams): MonteCarloResult {
  const { tasksRemaining, throughputHistorical, iterations = 10000, seed } = params;

  if (throughputHistorical.length < 2) {
    throw new Error(
      'Histórico insuficiente — precisa de pelo menos 2 pontos de throughput para bootstrap resample',
    );
  }

  if (tasksRemaining <= 0) {
    throw new Error('tasksRemaining deve ser maior que zero');
  }

  // Filtrar throughput <= 0 para evitar loop infinito
  const validHistory = throughputHistorical.filter((v) => v > 0);
  if (validHistory.length === 0) {
    throw new Error('Todos os valores de throughput histórico são zero — impossível calcular forecast');
  }

  const n = validHistory.length;
  const rng = seed !== undefined ? mulberry32(seed) : Math.random.bind(Math);

  const durations: number[] = [];

  for (let i = 0; i < iterations; i++) {
    let remaining = tasksRemaining;
    let periods = 0;
    const maxPeriods = tasksRemaining * 100; // guard contra loop infinito

    while (remaining > 0 && periods < maxPeriods) {
      // Sortear (com reposição) throughput de um período histórico
      const idx = Math.floor(rng() * n);
      const tp = validHistory[idx];
      remaining -= tp;
      periods++;
    }

    durations.push(periods);
  }

  durations.sort((a, b) => a - b);

  const avgThroughput = validHistory.reduce((acc, v) => acc + v, 0) / validHistory.length;

  return {
    p50: Math.ceil(calcPercentile(durations, 50)),
    p75: Math.ceil(calcPercentile(durations, 75)),
    p85: Math.ceil(calcPercentile(durations, 85)),
    p95: Math.ceil(calcPercentile(durations, 95)),
    iterations,
    avgThroughput: Math.round(avgThroughput * 100) / 100,
  };
}

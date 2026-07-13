import { Injectable, Logger, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'crypto';

import { MetricsService } from '../../common/observability/metrics.service';

/** Default do horizonte de idempotência (s) — casado com a janela de grace. */
const DEFAULT_IDEMPOTENCY_SECONDS = 60;

/** Teto de tokens em voo/cacheados (proteção de memória). */
const MAX_ENTRIES = 5_000;

interface Entry<T> {
  /** Promise da execução em voo (nunca `undefined` — é a chave da serialização). */
  inFlight: Promise<T>;
  /** Instante em que a entrada deixa de ser reaproveitável. */
  expiresAt: number;
  /** `true` quando a execução terminou com sucesso (resultado reaproveitável). */
  settled: boolean;
}

/**
 * Idempotência do `POST /auth/refresh` (F1 — item 1.2 do plano).
 *
 * **O problema:** duas abas do mesmo navegador disparam refresh com o MESMO
 * token no mesmo instante. Sem coordenação, ambas rotacionam: uma das duas fica
 * com um token que já não é o corrente e, ao voltar, é classificada como replay
 * — e a sessão inteira do usuário é revogada. É o incidente.
 *
 * **A solução:** chave = `sha256(refreshToken)`. O primeiro request executa a
 * rotação de verdade; os concorrentes com a MESMA chave **aguardam a mesma
 * promise** e recebem **exatamente o mesmo par de tokens**. Duas abas → uma
 * rotação → uma única cadeia de tokens. O resultado fica cacheado pelo mesmo
 * horizonte da janela de grace (default 60 s), cobrindo também o retry que
 * chega logo depois da resposta.
 *
 * ## Por que NÃO Redis (decisão registrada)
 *
 * O plano sugeria Redis (`lock:refresh:<hash>` + `refresh:result:<hash>`), e o
 * projeto tem client reaproveitável (`McpRateLimitService`). **Não usamos**, por
 * três razões:
 *
 * 1. **SPOF (o próprio risco §7 do plano).** Redis no caminho do refresh
 *    significa que um Redis lento/fora derruba o login de todo mundo. Aqui o
 *    mecanismo é in-process: **não existe dependência de rede para falhar**.
 *    Fail-open não é uma branch de código que pode ter bug — é a arquitetura.
 * 2. **O fallback já é suficiente.** Se dois requests caírem em réplicas
 *    diferentes (único cenário que o cache in-process não cobre), a **janela de
 *    grace + o compare-and-swap** do `RefreshTokenService` garantem o que
 *    realmente importa: **ninguém é revogado**. Idempotência é otimização de
 *    consistência, não requisito de segurança — exatamente como o plano diz.
 * 3. **Guardar par de tokens em Redis é aumentar a superfície.** O resultado
 *    cacheado contém refresh token em plaintext; mantê-lo apenas na memória do
 *    processo, por 60 s, é estritamente menos exposto do que replicá-lo num
 *    serviço externo compartilhado.
 *
 * A cobertura multi-réplica correta é a **F3** (sessões em `DTabela`), onde o
 * estado compartilhado mora no banco — que já é a fonte de verdade — e não num
 * side-channel. Até lá, esta classe é a defesa primária e a grace é a rede.
 *
 * @see RefreshTokenService.getGraceMs — mesmo horizonte
 * @see AuthService.refresh — único consumidor
 */
@Injectable()
export class RefreshIdempotencyService {
  private readonly logger = new Logger(RefreshIdempotencyService.name);

  /** key = sha256(refreshToken) → execução em voo / resultado recente. */
  private readonly entries = new Map<string, Entry<unknown>>();

  constructor(
    private readonly config: ConfigService,
    @Optional() private readonly metrics?: MetricsService,
  ) {}

  /**
   * Executa `fn` **uma única vez** por token dentro da janela de idempotência.
   *
   * Chamadas concorrentes (ou repetidas dentro da janela) com o mesmo token
   * recebem o resultado da primeira execução — o MESMO par de tokens.
   *
   * Semântica de erro: se `fn` rejeita, o resultado **não** é cacheado (a
   * entrada é descartada). Um erro transitório não pode ficar "grudado" no
   * token por 60 s; e um replay real precisa ser reavaliado a cada tentativa.
   *
   * @typeParam T - Tipo do resultado (na prática, `AuthResponseDto`)
   * @param refreshTokenPlaintext - Token apresentado (nunca logado)
   * @param fn - A rotação de verdade
   * @returns Resultado da (única) execução
   *
   * @example
   * ```typescript
   * return this.idempotency.run(refreshToken, () => this.doRefresh(refreshToken, userGroupId));
   * ```
   */
  async run<T>(refreshTokenPlaintext: string, fn: () => Promise<T>): Promise<T> {
    const key = createHash('sha256').update(refreshTokenPlaintext).digest('hex');
    const agora = Date.now();

    const existente = this.entries.get(key);
    if (existente && existente.expiresAt > agora) {
      this.metrics?.increment('auth.refresh.idempotent_hit', {
        stage: existente.settled ? 'cached_result' : 'in_flight',
      });
      return existente.inFlight as Promise<T>;
    }

    this.evictExpired(agora);

    const inFlight = fn();
    const entry: Entry<unknown> = {
      inFlight: inFlight as Promise<unknown>,
      expiresAt: agora + this.getWindowMs(),
      settled: false,
    };
    this.entries.set(key, entry);

    try {
      const resultado = await inFlight;
      entry.settled = true;
      // Reancora a validade no FIM da execução (não no início).
      entry.expiresAt = Date.now() + this.getWindowMs();
      return resultado;
    } catch (err) {
      // Erro não é cacheado — a próxima tentativa reavalia do zero.
      this.entries.delete(key);
      throw err;
    }
  }

  /** Horizonte de idempotência em ms (casado com `AUTH_REFRESH_GRACE_SECONDS`). */
  private getWindowMs(): number {
    const raw = this.config.get<string>('AUTH_REFRESH_GRACE_SECONDS');
    const value = String(raw ?? '').trim();
    const segundos = /^\d+$/.test(value) ? parseInt(value, 10) : DEFAULT_IDEMPOTENCY_SECONDS;
    return (segundos > 0 ? segundos : DEFAULT_IDEMPOTENCY_SECONDS) * 1000;
  }

  /**
   * Remove entradas vencidas e aplica o teto de memória.
   *
   * O cache é pequeno por natureza (só tokens usados nos últimos 60 s), mas o
   * teto existe para que uma rajada anômala não vire pressão de memória.
   */
  private evictExpired(agora: number): void {
    for (const [key, entry] of this.entries) {
      if (entry.expiresAt <= agora) {
        this.entries.delete(key);
      }
    }

    if (this.entries.size >= MAX_ENTRIES) {
      const excedente = this.entries.size - MAX_ENTRIES + 1;
      let removidos = 0;
      for (const key of this.entries.keys()) {
        this.entries.delete(key);
        if (++removidos >= excedente) break;
      }
      this.logger.warn(
        `Cache de idempotência atingiu o teto (${MAX_ENTRIES}) — ${removidos} entrada(s) descartada(s)`,
      );
    }
  }
}

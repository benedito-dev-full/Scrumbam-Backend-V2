/**
 * Redação de segredos antes de qualquer saída para o backend ou para log
 * (ADR-V2-083 — Ciclo 2 / M3).
 *
 * O `claude` (e os hooks/gh da esteira) rodam com o `GITHUB_TOKEN` no ambiente.
 * Um `env`, `gh auth token` ou erro verboso no transcript iria parar em
 * `stdoutTruncated`/`stderrTruncated`/`summary` e seria gravado no DPedido.
 * Toda string que sai do agente passa por aqui: VALORES de segredos conhecidos
 * viram `[REDACTED]`.
 *
 * Fontes de segredo:
 *  - variáveis de ambiente conhecidas (`GITHUB_TOKEN`, `GH_TOKEN`,
 *    `ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`, …);
 *  - qualquer variável cujo NOME termine em TOKEN/SECRET/KEY/PASSWORD/PASS;
 *  - segredos da config do agente (`agentApiKey`, `agentCommandSecret`).
 * Valores com menos de {@link MIN_SECRET_LENGTH} caracteres são ignorados
 * (evita apagar palavras comuns como "true"/"1").
 */

/** Marcador que substitui o valor do segredo. */
export const REDACTED = '[REDACTED]';

/** Tamanho mínimo para um valor ser tratado como segredo. */
export const MIN_SECRET_LENGTH = 8;

/** Nomes de variável sempre tratados como segredo. */
export const KNOWN_SECRET_ENV_KEYS = [
  'GITHUB_TOKEN',
  'GH_TOKEN',
  'GH_ENTERPRISE_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'CLAUDE_CODE_OAUTH_TOKEN',
] as const;

const SECRET_NAME_RE = /(TOKEN|SECRET|_KEY|APIKEY|PASSWORD|PASSWD|_PASS)$/i;

/** Função que troca segredos por {@link REDACTED}. */
export type Redactor = (s: string) => string;

/**
 * Monta o redator a partir do ambiente e de segredos extras (config).
 *
 * @param env - Ambiente do processo
 * @param extraSecrets - Segredos adicionais (ex.: `agentApiKey`, `agentCommandSecret`)
 * @returns Redator puro (ordem: segredo mais longo primeiro)
 *
 * @example
 *   const redact = buildRedactor(process.env, [config.agentApiKey]);
 *   redact(`token=${process.env.GITHUB_TOKEN}`); // "token=[REDACTED]"
 */
export function buildRedactor(
  env: NodeJS.ProcessEnv,
  extraSecrets: Array<string | undefined | null> = [],
): Redactor {
  const values = new Set<string>();
  const add = (v: string | undefined | null): void => {
    if (typeof v === 'string' && v.trim().length >= MIN_SECRET_LENGTH) values.add(v.trim());
  };
  for (const k of KNOWN_SECRET_ENV_KEYS) add(env[k]);
  for (const [k, v] of Object.entries(env)) if (SECRET_NAME_RE.test(k)) add(v);
  for (const v of extraSecrets) add(v);
  const secrets = [...values].sort((a, b) => b.length - a.length);
  if (secrets.length === 0) return (s) => s;
  return (s: string): string => {
    if (typeof s !== 'string' || s.length === 0) return s;
    let out = s;
    for (const secret of secrets) {
      if (out.includes(secret)) out = out.split(secret).join(REDACTED);
    }
    return out;
  };
}

/**
 * Aplica o redator a TODAS as strings de um objeto JSON-serializável (cópia).
 *
 * @param value - Payload (ex.: `ExecutionResultPayload`)
 * @param redact - Redator
 * @returns Cópia com strings redigidas
 */
export function redactDeep<T>(value: T, redact: Redactor): T {
  if (typeof value === 'string') return redact(value) as unknown as T;
  if (Array.isArray(value)) return value.map((v) => redactDeep(v, redact)) as unknown as T;
  if (value !== null && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) out[k] = redactDeep(v, redact);
    return out as T;
  }
  return value;
}

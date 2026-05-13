/**
 * Escrita atômica do arquivo de environment do scrumban-agent
 * (`/etc/scrumban-agent/environment`).
 *
 * **Contrato (plan 2026-05-13 §4 — `SET_ENV`):**
 *
 *  - O arquivo é uma sequência de pares `CHAVE=valor`, uma por linha.
 *  - Linhas começando com `#` são comentários, preservadas no merge.
 *  - O update é **idempotente** e **por chave**: apenas as chaves vindas
 *    na chamada são adicionadas/atualizadas. Demais chaves e comentários
 *    são preservados byte-a-byte.
 *  - Apenas chaves da `ALLOWED_KEYS` são aceitas — qualquer outra dispara
 *    {@link EnvWriterError} com `code='DISALLOWED_KEY'`. Defesa contra
 *    o backend (ou um atacante de man-in-the-middle dentro do tunnel HMAC)
 *    tentar injetar `LD_PRELOAD`, `PATH`, etc.
 *  - Escrita **atômica**: grava em `<path>.tmp.<pid>.<rand>`, `fs.renameSync`
 *    para o destino. Evita arquivo half-written se o processo for morto
 *    pelo restart imediatamente após o ACK.
 *  - Permissões finais: **0600 owner=scrumban-agent**. O `chown` só é
 *    invocado se o processo tem privilégio (em produção o serviço roda
 *    como `scrumban-agent`, então o arquivo já nasce com o owner certo
 *    e o `chown` é redundante; em testes rodamos como o usuário corrente
 *    e pulamos o chown).
 *
 * @see plan-2026-05-13-vps-project-config-via-frontend §4 — Estrutura
 *      Técnica, §5 Fase 2.1, §10 Considerações de Segurança item 2 e 5.
 */
import { randomBytes } from 'crypto';
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  openSync,
  readFileSync,
  renameSync,
  unlinkSync,
  writeSync,
} from 'fs';
import { dirname } from 'path';

/**
 * Allowlist de chaves aceitas em `SET_ENV`. Qualquer chave fora desta
 * lista é rejeitada com `DISALLOWED_KEY` (422 no handler).
 *
 * **Por que allowlist e não blocklist:** o blast radius de um atacante
 * que controlar o backend é proporcional ao que conseguir setar no env
 * do processo Node (e portanto do `claude -p`). Allowlist explícita
 * elimina a categoria de ataque "set `LD_PRELOAD` / `NODE_OPTIONS` /
 * `PATH` via env injection".
 */
export const ALLOWED_KEYS = Object.freeze([
  'GITHUB_TOKEN',
  'ANTHROPIC_API_KEY',
  'ANTHROPIC_AUTH_TOKEN',
  'GIT_BOT_NAME',
  'GIT_BOT_EMAIL',
] as const);

export type AllowedEnvKey = (typeof ALLOWED_KEYS)[number];

/**
 * Códigos de erro do writer. Mapeados pelo handler para HTTP status:
 *  - `DISALLOWED_KEY` → 422 (chave fora da allowlist)
 *  - `INVALID_VALUE` → 422 (newline / null byte no valor)
 *  - `EMPTY_PAYLOAD` → 422 (objeto `vars` sem nenhuma chave)
 *  - `IO_ERROR` → 500 (filesystem error: permission denied, ENOSPC etc.)
 */
export type EnvWriterErrorCode = 'DISALLOWED_KEY' | 'INVALID_VALUE' | 'EMPTY_PAYLOAD' | 'IO_ERROR';

export class EnvWriterError extends Error {
  constructor(
    public readonly code: EnvWriterErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'EnvWriterError';
  }
}

export interface WriteEnvVarsResult {
  /** Caminho do arquivo escrito (sempre o `path` recebido). */
  path: string;
  /** Chaves que foram efetivamente persistidas (ordem do input). */
  varsWritten: AllowedEnvKey[];
  /** `true` se o arquivo não existia antes — relevante para auditoria. */
  createdNew: boolean;
}

export interface WriteEnvVarsOptions {
  /** Caminho absoluto do env file. Default: `/etc/scrumban-agent/environment`. */
  path?: string;
  /**
   * Modo final do arquivo. Default: `0o600`. Em testes pode-se relaxar
   * (mas as specs validam 0600 por padrão).
   */
  mode?: number;
}

/**
 * Faz merge idempotente de `vars` no arquivo de env, preservando linhas
 * pré-existentes (incluindo comentários e ordem) que não foram tocadas.
 *
 * **Atomicidade:** escreve em `<path>.tmp.<pid>.<random>` e faz `renameSync`
 * — operação atômica no mesmo filesystem. Se o processo for terminado
 * entre o write e o rename, o env file original permanece intacto.
 *
 * @throws {@link EnvWriterError} com código apropriado em falhas de
 *   validação ou I/O.
 *
 * @example
 *   const result = writeEnvVars(
 *     { GITHUB_TOKEN: 'ghp_x', ANTHROPIC_API_KEY: 'sk-ant-...' },
 *     { path: '/etc/scrumban-agent/environment' },
 *   );
 *   // result.varsWritten === ['GITHUB_TOKEN', 'ANTHROPIC_API_KEY']
 */
export function writeEnvVars(
  vars: Record<string, string>,
  options: WriteEnvVarsOptions = {},
): WriteEnvVarsResult {
  const path = options.path ?? '/etc/scrumban-agent/environment';
  const mode = options.mode ?? 0o600;

  // Validação 1: payload não-vazio
  const keys = Object.keys(vars);
  if (keys.length === 0) {
    throw new EnvWriterError('EMPTY_PAYLOAD', 'objeto vars vazio (nenhuma chave para escrever)');
  }

  // Validação 2: allowlist + valor sem caracteres perigosos (newline/null)
  // Itera mantendo ordem do input — `varsWritten` preserva essa ordem.
  const validated: Array<{ key: AllowedEnvKey; value: string }> = [];
  for (const key of keys) {
    if (!ALLOWED_KEYS.includes(key as AllowedEnvKey)) {
      throw new EnvWriterError(
        'DISALLOWED_KEY',
        `chave "${key}" nao permitida (allowlist: ${ALLOWED_KEYS.join(', ')})`,
      );
    }
    const value = vars[key];
    if (typeof value !== 'string') {
      throw new EnvWriterError('INVALID_VALUE', `valor de "${key}" deve ser string`);
    }
    if (value.includes('\n') || value.includes('\r') || value.includes('\0')) {
      throw new EnvWriterError(
        'INVALID_VALUE',
        `valor de "${key}" contem caractere proibido (newline/null)`,
      );
    }
    validated.push({ key: key as AllowedEnvKey, value });
  }

  // 1. Lê conteúdo atual (se existir) preservando comentários e linhas
  //    de chaves não tocadas. Idempotência byte-a-byte.
  const existed = existsSync(path);
  const original = existed ? readFileSync(path, 'utf8') : '';
  const merged = mergeEnvContent(original, validated);

  // 2. Escrita atômica: temp file no MESMO diretório (rename só é atômico
  //    intra-filesystem) e fsync antes do rename.
  const tmpPath = `${path}.tmp.${process.pid}.${randomBytes(4).toString('hex')}`;
  let fd: number | null = null;
  try {
    fd = openSync(tmpPath, 'w', mode);
    writeSync(fd, merged, 0, 'utf8');
    fsyncSync(fd);
    closeSync(fd);
    fd = null;
    // chmod explícito porque `openSync(... mode)` respeita umask; queremos
    // 0o600 final independente de umask.
    chmodSync(tmpPath, mode);
    renameSync(tmpPath, path);
  } catch (err) {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* já fechado */
      }
    }
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath);
    } catch {
      /* cleanup best-effort */
    }
    throw new EnvWriterError(
      'IO_ERROR',
      `falha ao escrever env file em ${path}: ${(err as Error).message}`,
      err,
    );
  }

  // Diretório destino exige permissão para escrever. Se path/diretório
  // não existir, openSync(...) acima já teria lançado ENOENT — mas
  // mantemos defesa explícita pra mensagem clara:
  if (!existsSync(dirname(path))) {
    throw new EnvWriterError(
      'IO_ERROR',
      `diretorio destino ausente: ${dirname(path)} (instalador deve cria-lo)`,
    );
  }

  return {
    path,
    varsWritten: validated.map((v) => v.key),
    createdNew: !existed,
  };
}

/**
 * Merge das chaves novas no conteúdo original, linha-a-linha. Regras:
 *
 *  - Linhas que começam com `#` ou são vazias: copiadas como estão.
 *  - Linhas no formato `CHAVE=...`: se `CHAVE` está em `validated`, troca
 *    pelo novo valor; senão preserva. Chave aparece UMA vez (a última
 *    no arquivo vence se houver duplicata pré-existente).
 *  - Chaves de `validated` que não existiam ainda: append no final, na
 *    ordem do input.
 *
 * Não exportado — detalhe de implementação. Testado indiretamente via
 * `writeEnvVars`.
 */
function mergeEnvContent(
  original: string,
  validated: Array<{ key: AllowedEnvKey; value: string }>,
): string {
  const updates = new Map(validated.map((v) => [v.key, v.value]));
  const updatedKeys = new Set<AllowedEnvKey>();
  const lines = original.length > 0 ? original.split('\n') : [];
  const outLines: string[] = [];

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) {
      outLines.push(line);
      continue;
    }
    const eqIdx = line.indexOf('=');
    if (eqIdx <= 0) {
      // Linha não-conforme (sem `=` ou só com `=` no início): preserva.
      outLines.push(line);
      continue;
    }
    const key = line.slice(0, eqIdx).trim();
    if (updates.has(key as AllowedEnvKey)) {
      const newValue = updates.get(key as AllowedEnvKey) as string;
      outLines.push(`${key}=${newValue}`);
      updatedKeys.add(key as AllowedEnvKey);
    } else {
      outLines.push(line);
    }
  }

  // Append chaves que ainda não foram escritas (novas).
  for (const { key, value } of validated) {
    if (!updatedKeys.has(key)) {
      // Garante newline antes do append se a última linha não terminava em \n.
      if (outLines.length > 0 && outLines[outLines.length - 1] !== '') {
        // No-op: o join com '\n' vai inserir o separador. Mas precisamos
        // garantir que o arquivo termine com newline depois. Tratado abaixo.
      }
      outLines.push(`${key}=${value}`);
    }
  }

  let result = outLines.join('\n');
  // Garantia: arquivo sempre termina com newline (POSIX).
  if (!result.endsWith('\n')) {
    result += '\n';
  }
  return result;
}

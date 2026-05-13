/**
 * Geração idempotente de deploy keys SSH per-projectSlug.
 *
 * **Contrato (plan 2026-05-13 §4 — `GENERATE_DEPLOY_KEY`):**
 *
 *  - Recebe `projectSlug` validado (regex `^[a-z0-9-]{1,64}$`).
 *  - Persiste em `<baseDir>/<slug>` (privada, 0600) e `<baseDir>/<slug>.pub`
 *    (pública, 0644). Base default: `/etc/scrumban-agent/ssh-keys/`.
 *  - **Idempotente**: se ambos os arquivos já existem, NÃO regenera — lê
 *    a pubkey existente, computa o fingerprint e retorna `alreadyExisted=true`.
 *  - Algoritmo: **ed25519** (decisão CEO, plan §10 item 10 + ADR-V2-042).
 *  - **Privada NUNCA sai daqui.** O retorno só contém pubkey + fingerprint.
 *  - **Defesa anti path-injection (R3 do plan):** o slug é re-validado aqui
 *    contra o regex; após construir o path, fazemos realpath e checamos
 *    que está sob `<baseDir>`. Mesmo padrão de `claude-code/allowlist.ts`.
 *
 * @see plan-2026-05-13-vps-project-config-via-frontend §4, §5 Fase 2.4,
 *      §7 R3 (path injection), §10 item 6.
 */
import { execFileSync } from 'child_process';
import { chmodSync, existsSync, mkdirSync, readFileSync, realpathSync, statSync } from 'fs';
import { dirname, resolve as resolvePath } from 'path';

/** Regex idêntica ao DTO do backend (defesa em profundidade). */
export const PROJECT_SLUG_REGEX = /^[a-z0-9-]{1,64}$/;

export type DeployKeyErrorCode =
  | 'INVALID_SLUG'
  | 'PATH_ESCAPE'
  | 'IO_ERROR'
  | 'SSH_KEYGEN_FAILED'
  | 'SSH_KEYGEN_MISSING';

export class DeployKeyError extends Error {
  constructor(
    public readonly code: DeployKeyErrorCode,
    message: string,
    public readonly cause?: unknown,
  ) {
    super(message);
    this.name = 'DeployKeyError';
  }
}

export interface GenerateDeployKeyResult {
  /** Conteúdo da pubkey (uma linha, formato `ssh-ed25519 AAAA... comment`). */
  publicKey: string;
  /** Fingerprint SHA256 (formato `SHA256:base64`). */
  fingerprint: string;
  /** Caminho absoluto da pubkey persistida (apenas referência — não para o frontend). */
  publicKeyPath: string;
  /** `true` se a chave já existia e foi reutilizada (idempotência). */
  alreadyExisted: boolean;
}

export interface GenerateDeployKeyOptions {
  /** Base dir (default: `/etc/scrumban-agent/ssh-keys`). */
  baseDir?: string;
  /** Comentário para a chave. Default: `scrumban-agent@<slug>`. */
  comment?: string;
  /**
   * Override de `execFileSync` para testes. Por padrão usa o binário
   * `ssh-keygen` real. Em CI a spec injeta um fake que escreve no FS
   * o conteúdo esperado.
   */
  execFile?: typeof execFileSync;
}

/**
 * Gera (ou recupera) um par de chaves ed25519 SSH para o `projectSlug`.
 *
 * Retorna pubkey + fingerprint. Privada permanece em
 * `<baseDir>/<slug>` (modo 0600, lida apenas pelo processo Node como
 * o user `scrumban-agent`).
 *
 * @throws {@link DeployKeyError}
 *  - `INVALID_SLUG`: slug não bate na regex.
 *  - `PATH_ESCAPE`: slug resolve para path fora de `baseDir` (symlink
 *    attack ou tentativa de escape semântico — embora a regex já
 *    bloqueie `..` e `/`, o realpath check é defesa adicional).
 *  - `SSH_KEYGEN_MISSING`: `ssh-keygen` não está no PATH.
 *  - `SSH_KEYGEN_FAILED`: comando retornou erro.
 *  - `IO_ERROR`: falha de filesystem.
 *
 * @example
 *   const r = generateDeployKey('dinpayz-backend');
 *   console.log(r.publicKey);     // 'ssh-ed25519 AAAA... scrumban-agent@dinpayz-backend'
 *   console.log(r.fingerprint);   // 'SHA256:abcd...'
 *   console.log(r.alreadyExisted); // false na 1ª chamada, true nas seguintes
 */
export function generateDeployKey(
  projectSlug: string,
  options: GenerateDeployKeyOptions = {},
): GenerateDeployKeyResult {
  if (!PROJECT_SLUG_REGEX.test(projectSlug)) {
    throw new DeployKeyError(
      'INVALID_SLUG',
      `projectSlug invalido: deve bater ${PROJECT_SLUG_REGEX}`,
    );
  }

  const baseDir = options.baseDir ?? '/etc/scrumban-agent/ssh-keys';
  const comment = options.comment ?? `scrumban-agent@${projectSlug}`;
  const execFile = options.execFile ?? execFileSync;

  // 1. Garante baseDir (não cria recursivo em produção — o install.sh
  //    cria; em testes criamos sob /tmp/...).
  if (!existsSync(baseDir)) {
    try {
      mkdirSync(baseDir, { recursive: true, mode: 0o700 });
    } catch (err) {
      throw new DeployKeyError(
        'IO_ERROR',
        `nao consegui criar baseDir ${baseDir}: ${(err as Error).message}`,
        err,
      );
    }
  }

  // 2. Anti path-escape: trabalha com o baseDir CANONICALIZADO (resolve
  //    symlinks). No macOS, `/tmp` é symlink para `/private/tmp` — sem
  //    `realpath` o prefix-check abaixo daria falso positivo de escape.
  //    Como a regex já bloqueia '/', '..' e caracteres especiais, isso
  //    é defesa redundante — mas barata.
  const baseReal = realpathSync(baseDir);
  const privPath = resolvePath(baseReal, projectSlug);
  const pubPath = `${privPath}.pub`;

  if (dirname(privPath) !== baseReal) {
    throw new DeployKeyError(
      'PATH_ESCAPE',
      `path resolvido (${privPath}) escapa de baseDir (${baseReal})`,
    );
  }

  // 3. Idempotência: se ambos arquivos existem, reusa.
  if (existsSync(privPath) && existsSync(pubPath)) {
    const publicKey = readFileSync(pubPath, 'utf8').trim();
    const fingerprint = computeFingerprint(pubPath, execFile);
    return {
      publicKey,
      fingerprint,
      publicKeyPath: pubPath,
      alreadyExisted: true,
    };
  }

  // 4. Geração: ssh-keygen -t ed25519 -f <privPath> -N '' -C <comment>
  //    Args como array (NÃO string shell) — nenhum shell envolvido,
  //    nenhum risco de injection mesmo com comment hostil.
  try {
    execFile('ssh-keygen', ['-t', 'ed25519', '-f', privPath, '-N', '', '-C', comment, '-q'], {
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new DeployKeyError(
        'SSH_KEYGEN_MISSING',
        'comando ssh-keygen nao encontrado no PATH (install.sh deve garantir openssh-client)',
      );
    }
    throw new DeployKeyError(
      'SSH_KEYGEN_FAILED',
      `ssh-keygen falhou: ${(err as Error).message}`,
      err,
    );
  }

  // 5. Confere que os arquivos foram criados.
  if (!existsSync(privPath) || !existsSync(pubPath)) {
    throw new DeployKeyError(
      'SSH_KEYGEN_FAILED',
      `ssh-keygen completou sem erro mas arquivos ausentes (${privPath}, ${pubPath})`,
    );
  }

  // 6. Garante permissões (ssh-keygen já cria 0600/0644, mas reaplicamos
  //    defensivamente — umask pode alterar).
  try {
    chmodSync(privPath, 0o600);
    chmodSync(pubPath, 0o644);
  } catch (err) {
    throw new DeployKeyError(
      'IO_ERROR',
      `falha ao ajustar permissoes: ${(err as Error).message}`,
      err,
    );
  }

  // 7. Sanity: privada 0600 confirmado via stat.
  const stat = statSync(privPath);
  const mode = stat.mode & 0o777;
  if (mode !== 0o600) {
    throw new DeployKeyError(
      'IO_ERROR',
      `permissao final da privada e ${mode.toString(8)} (esperado 600)`,
    );
  }

  const publicKey = readFileSync(pubPath, 'utf8').trim();
  const fingerprint = computeFingerprint(pubPath, execFile);

  return {
    publicKey,
    fingerprint,
    publicKeyPath: pubPath,
    alreadyExisted: false,
  };
}

/**
 * Computa fingerprint SHA256 da pubkey via `ssh-keygen -lf`.
 * Output esperado: `256 SHA256:abcd... comment (ED25519)`. Extrai o
 * token que começa com `SHA256:`.
 *
 * Não exportado (detalhe de implementação — testado via `generateDeployKey`).
 */
function computeFingerprint(pubPath: string, execFile: typeof execFileSync): string {
  let stdout: Buffer;
  try {
    stdout = execFile('ssh-keygen', ['-lf', pubPath], {
      stdio: ['ignore', 'pipe', 'pipe'],
    }) as Buffer;
  } catch (err) {
    throw new DeployKeyError(
      'SSH_KEYGEN_FAILED',
      `ssh-keygen -lf falhou: ${(err as Error).message}`,
      err,
    );
  }
  const out = stdout.toString('utf8').trim();
  const match = out.match(/(SHA256:[A-Za-z0-9+/=]+)/);
  if (!match) {
    throw new DeployKeyError(
      'SSH_KEYGEN_FAILED',
      `ssh-keygen -lf nao retornou fingerprint SHA256 (saida: ${out})`,
    );
  }
  return match[1];
}

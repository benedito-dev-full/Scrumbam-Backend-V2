/**
 * Validador de path contra `config.allowedProjectRoots`.
 *
 * **Defesa contra path injection** (risco #1 do plano-task1). Mesmo que o
 * CLAUDE.md tenha sido manipulado (intencionalmente ou não) para apontar
 * para `/etc`, `/root`, ou repositório malicioso fora das raízes permitidas,
 * o agente recusa executar.
 *
 * Algoritmo:
 *  1. Path DEVE ser absoluto (já garantido pelo `identity-resolver`, mas
 *     revalidamos — defesa em profundidade).
 *  2. Canonicaliza via `fs.realpathSync` → resolve symlinks e `..`.
 *  3. Path canonicalizado DEVE começar com uma das `allowedProjectRoots`
 *     normalizadas (também canonicalizadas e com `/` ao final para evitar
 *     `/home/dev/projetos-evil` matchar `/home/dev/projetos`).
 *
 * Erros lançados:
 *  - `WORKSPACE_OUTSIDE_ALLOWED_ROOT` (403): path validado mas fora das raízes
 *  - `WORKSPACE_REALPATH_FAILED` (403): path não existe ou erro de I/O
 *  - `WORKSPACE_NOT_ABSOLUTE` (403): path relativo passou pelo resolver
 *
 * @see ADR-V2-030 (modelo de ameaça)
 */
import { realpathSync } from 'node:fs';
import { isAbsolute } from 'node:path';

export class AllowlistError extends Error {
  public readonly code:
    | 'WORKSPACE_OUTSIDE_ALLOWED_ROOT'
    | 'WORKSPACE_REALPATH_FAILED'
    | 'WORKSPACE_NOT_ABSOLUTE';

  constructor(code: AllowlistError['code'], message: string) {
    super(message);
    this.name = 'AllowlistError';
    this.code = code;
  }
}

export interface AllowlistOptions {
  /** Override do realpathSync (testes). Default: `fs.realpathSync`. */
  realpath?: (path: string) => string;
}

/**
 * Valida que `path` está sob alguma das `allowedRoots`. Retorna o path
 * canonicalizado (útil para o caller usar no spawn — evita re-canonicalizar).
 *
 * @throws AllowlistError com `.code` para o handler mapear status (403).
 *
 * @example
 *   const cwd = validateWorkspace(
 *     '/home/dev/projetos/Scrumban-Backend-V2',
 *     ['/home/dev/projetos'],
 *   );
 *   spawn('claude', args, { cwd });
 */
export function validateWorkspace(
  path: string,
  allowedRoots: readonly string[],
  options: AllowlistOptions = {},
): string {
  if (typeof path !== 'string' || path.trim().length === 0) {
    throw new AllowlistError('WORKSPACE_NOT_ABSOLUTE', 'path vazio ou nao-string');
  }

  // Trim defensivo — espaços em volta de paths são sempre erro.
  const trimmed = path.trim();

  if (!isAbsolute(trimmed)) {
    throw new AllowlistError('WORKSPACE_NOT_ABSOLUTE', `path "${trimmed}" nao e absoluto`);
  }

  const realpath = options.realpath ?? realpathSync;

  let canonical: string;
  try {
    canonical = realpath(trimmed);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new AllowlistError(
      'WORKSPACE_REALPATH_FAILED',
      `realpath falhou para "${trimmed}": ${message}`,
    );
  }

  // Canonicaliza também os roots (resolve symlinks nas raízes — se o CEO
  // tem `/home` symlinkado para `/mnt/home`, queremos comparar realpath
  // contra realpath).
  for (const root of allowedRoots) {
    let canonicalRoot: string;
    try {
      canonicalRoot = realpath(root);
    } catch {
      // Root inexistente é config corrompida, mas não fail-fast aqui —
      // simplesmente pula. Se NENHUM root válido, cai no throw final.
      continue;
    }

    // Garante boundary com `/` no final para evitar prefix match espúrio:
    //   /home/dev/projetos    ← root
    //   /home/dev/projetos-evil ← path malicioso
    // Sem o `/`, startsWith pegaria. Com o `/`, não.
    const rootWithSep = canonicalRoot.endsWith('/') ? canonicalRoot : `${canonicalRoot}/`;
    const candidateWithSep = canonical.endsWith('/') ? canonical : `${canonical}/`;

    if (candidateWithSep === rootWithSep || candidateWithSep.startsWith(rootWithSep)) {
      return canonical;
    }
  }

  throw new AllowlistError(
    'WORKSPACE_OUTSIDE_ALLOWED_ROOT',
    `path "${canonical}" nao esta sob nenhum root permitido (${allowedRoots.join(', ')})`,
  );
}

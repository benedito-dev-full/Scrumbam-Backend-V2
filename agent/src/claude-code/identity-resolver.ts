/**
 * Resolver de identidade `projectSlug → path absoluto` via `~/.claude/CLAUDE.md`.
 *
 * **Por que via CLAUDE.md?** Ver ADR-V2-030. O backend NUNCA envia path
 * absoluto no payload — só envia `projectSlug`. O agente resolve localmente
 * lendo o arquivo CLAUDE.md mantido pelo CEO. Isso elimina trust-from-backend
 * em relação a paths de filesystem (defesa em profundidade contra path
 * injection).
 *
 * **Formato esperado em CLAUDE.md (case-sensitive):**
 *
 * ```markdown
 * ## scrumban-backend-v2
 * - Caminho: /home/dev/projetos/Scrumban-Backend-V2
 * - Descrição: backend principal
 *
 * ## frontend
 * - Caminho: /home/dev/projetos/Scrumbam-FrontEnd
 * ```
 *
 * Regras:
 *  - Heading `##` (h2) seguido do slug (case-sensitive).
 *  - Dentro da seção, linha começando com `- Caminho:` ou `- Path:` define o path.
 *  - Primeira ocorrência válida ganha (defensivo contra duplicatas — caller
 *    pode pré-validar unicidade no startup futuramente).
 *  - Path DEVE ser absoluto. Validação contra allowlist é responsabilidade
 *    do módulo `allowlist.ts` (este só extrai do arquivo).
 *
 * **Decisão: case-sensitive.** Slugs são kebab-case por convenção; ambiguidade
 * (`Scrumban-Backend-V2` vs `scrumban-backend-v2`) é risco maior que conveniência.
 *
 * Erros lançados (mapeados para HTTP status no handler):
 *  - `CLAUDE_MD_NOT_FOUND` (500): arquivo inexistente — config corrompida
 *  - `CLAUDE_MD_READ_ERROR` (500): erro de I/O ao ler
 *  - `UNKNOWN_PROJECT_SLUG` (422): slug ausente em CLAUDE.md
 *  - `INVALID_CLAUDE_MD_ENTRY` (422): seção existe mas sem Caminho válido
 *
 * @see ADR-V2-030 (eliminação de `cwd` no payload)
 * @see src/claude-code/allowlist.ts (validação subsequente)
 */
import { readFileSync } from 'node:fs';

/** Erros que o resolver pode lançar — sempre com `code` para o handler mapear. */
export class IdentityResolverError extends Error {
  public readonly code:
    | 'CLAUDE_MD_NOT_FOUND'
    | 'CLAUDE_MD_READ_ERROR'
    | 'UNKNOWN_PROJECT_SLUG'
    | 'INVALID_CLAUDE_MD_ENTRY';

  constructor(code: IdentityResolverError['code'], message: string) {
    super(message);
    this.name = 'IdentityResolverError';
    this.code = code;
  }
}

/** Tunáveis (injetáveis para testes — fs em memória etc). */
export interface IdentityResolverOptions {
  /** Override do readFileSync (testes). Default: `fs.readFileSync`. */
  readFile?: (path: string) => string;
}

/**
 * Resolve `projectSlug` → path absoluto lendo `claudeMdPath`.
 *
 * **Lê o arquivo a cada chamada por design** — o CEO pode atualizar
 * CLAUDE.md sem reiniciar o agente. Custo (~1KB de I/O por request) é
 * desprezível vs. a complexidade de cache invalidation.
 *
 * @throws IdentityResolverError com `.code` para o handler mapear status.
 *
 * @example
 *   const path = resolveProjectPath('scrumban-backend-v2', '/root/.claude/CLAUDE.md');
 *   // → '/home/dev/projetos/Scrumban-Backend-V2'
 */
export function resolveProjectPath(
  slug: string,
  claudeMdPath: string,
  options: IdentityResolverOptions = {},
): string {
  const readFile = options.readFile ?? ((p: string) => readFileSync(p, 'utf8'));

  let content: string;
  try {
    content = readFile(claudeMdPath);
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === 'ENOENT') {
      throw new IdentityResolverError(
        'CLAUDE_MD_NOT_FOUND',
        `CLAUDE.md nao encontrado em ${claudeMdPath}`,
      );
    }
    throw new IdentityResolverError(
      'CLAUDE_MD_READ_ERROR',
      `falha ao ler CLAUDE.md (${claudeMdPath}): ${e.message}`,
    );
  }

  const section = extractSection(content, slug);
  if (section === null) {
    throw new IdentityResolverError(
      'UNKNOWN_PROJECT_SLUG',
      `slug "${slug}" nao encontrado em CLAUDE.md`,
    );
  }

  const path = extractPath(section);
  if (path === null) {
    throw new IdentityResolverError(
      'INVALID_CLAUDE_MD_ENTRY',
      `secao "## ${slug}" existe mas nao contem linha "- Caminho: <path>"`,
    );
  }

  return path;
}

/**
 * Localiza a seção `## <slug>` (case-sensitive) e retorna o corpo até o
 * próximo heading `##` ou fim do arquivo.
 *
 * Implementação line-by-line ao invés de regex multiline para evitar
 * pitfalls de ReDoS e cross-line behavior em conteúdos grandes.
 */
function extractSection(content: string, slug: string): string | null {
  // Normaliza CRLF → LF para que o split funcione consistentemente
  // entre arquivos editados no macOS/Linux/Windows.
  const lines = content.replace(/\r\n/g, '\n').split('\n');

  let inside = false;
  const collected: string[] = [];

  for (const line of lines) {
    const headingMatch = /^##\s+(.+?)\s*$/.exec(line);
    if (headingMatch) {
      const headingSlug = headingMatch[1];
      if (inside) {
        // Encontramos próximo `##` — fim da seção.
        break;
      }
      if (headingSlug === slug) {
        inside = true;
        continue;
      }
    }

    if (inside) {
      collected.push(line);
    }
  }

  return inside ? collected.join('\n') : null;
}

/**
 * Extrai o path da seção. Aceita variações comuns:
 *  - `- Caminho: /path`
 *  - `- Path: /path`
 *  - `* Caminho: /path` (asterisco em vez de hífen)
 *
 * Retorna o PRIMEIRO match. Trim padrão; nunca quebra a linha.
 * Path deve começar com `/` (absoluto) — caso contrário, ignora e segue
 * procurando (forçar absoluto evita aceitar `Caminho: relativo/bla`).
 */
function extractPath(section: string): string | null {
  const lines = section.split('\n');

  // (?:Caminho|Path) — aceita os dois rótulos.
  // ^[\s]*[-*]\s+ — bullet com `-` ou `*`, qualquer indentação.
  const pathLineRegex = /^\s*[-*]\s+(?:Caminho|Path)\s*:\s*(.+?)\s*$/i;

  for (const line of lines) {
    const m = pathLineRegex.exec(line);
    if (!m) continue;

    const candidate = m[1].trim();
    if (candidate.length === 0) continue;
    if (!candidate.startsWith('/')) continue; // exige absoluto

    return candidate;
  }

  return null;
}

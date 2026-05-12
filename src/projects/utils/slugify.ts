/**
 * Slugify de nomes de projeto para `DProject.dados.slug` (ADR-V2-030).
 *
 * Converte um nome humano em um identificador URL-safe estável que vai trafegar
 * entre backend, agente client-side e Claude Code (seções `## <slug>` em
 * `~/.claude/CLAUDE.md`). Slug é IDENTIDADE TÉCNICA — não muda quando o nome
 * do projeto é editado.
 *
 * Regras aplicadas (em ordem):
 *  1. Normaliza NFD e remove diacríticos (`á` → `a`, `ñ` → `n`).
 *  2. Lowercase.
 *  3. Substitui qualquer não-alfanumérico por `-`.
 *  4. Colapsa múltiplos `-` consecutivos em um só.
 *  5. Remove `-` das pontas.
 *  6. Trunca em 50 caracteres e remove `-` final que possa ter surgido do trim.
 *
 * Idempotência: `slugify(slugify(x)) === slugify(x)` para qualquer entrada
 * que produza slug não-vazio.
 *
 * @param nome - Nome bruto do projeto.
 * @returns Slug normalizado ou string vazia se a entrada não produzir
 *   nenhum caractere alfanumérico utilizável. Callers DEVEM tratar o caso
 *   vazio (geralmente aplicando fallback `untitled-<timestamp>` ou lançando
 *   erro de validação).
 *
 * @example
 * ```typescript
 * slugify('Scrumban Backend V2');             // 'scrumban-backend-v2'
 * slugify('Sistema de Produção / Fintech');   // 'sistema-de-producao-fintech'
 * slugify('   espaços  múltiplos  ');         // 'espacos-multiplos'
 * slugify('!!!!!!');                          // ''  (caller decide fallback)
 * slugify('A'.repeat(100));                   // 'aaaaa...' (50 chars)
 * ```
 *
 * @see ADR-V2-030 — projectSlug + CLAUDE.md global
 */
export function slugify(nome: string): string {
  if (typeof nome !== 'string') {
    return '';
  }

  const normalized = nome
    .normalize('NFD')
    // eslint-disable-next-line no-misleading-character-class
    .replace(/[̀-ͯ]/g, '');

  let slug = normalized
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-+|-+$/g, '');

  if (slug.length > 50) {
    slug = slug.slice(0, 50).replace(/-+$/g, '');
  }

  return slug;
}

/**
 * Constante: tamanho máximo de slug persistido em `DProject.dados.slug`.
 * Usado por validações de DTO/teste para manter consistência.
 */
export const MAX_SLUG_LENGTH = 50;

/**
 * Fallback quando o nome não produz nenhum caractere alfanumérico
 * (ex: `'!!!!!'`). Gera slug determinístico-suficiente para não colidir em
 * uso normal e para deixar rastro de "nome inválido" no banco.
 *
 * Formato: `untitled-<timestamp-base36>`. Timestamp suficiente para evitar
 * colisão em criações concorrentes; sufixo numérico do `ProjectsService`
 * resolve o restante se houver colisão real.
 *
 * @returns Fallback slug seguro.
 */
export function fallbackSlug(): string {
  return `untitled-${Date.now().toString(36)}`;
}

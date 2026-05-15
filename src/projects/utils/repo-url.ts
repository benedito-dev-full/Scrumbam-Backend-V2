/**
 * Validação canônica de `DProject.repoUrl` (ADR-V2-043).
 *
 * Whitelist restritiva por design: o backend repassa este valor ao agente
 * VPS que executa `git clone` em shell. Qualquer abertura aqui vira RCE
 * direta. Portanto, regex é o ÚNICO ponto de confiança — service e
 * RemoteExecutionClient devem RE-VALIDAR antes de despachar.
 *
 * Hosts aceitos:
 *  - `github.com`
 *  - `gitlab.com`
 *  - `bitbucket.org`
 *
 * Protocolos aceitos:
 *  - SSH:   `git@<host>:<owner>/<repo>(.git)?`
 *  - HTTPS: `https://<host>/<owner>/<repo>(.git)?`
 *
 * Granularidade `owner`/`repo`: `[A-Za-z0-9_.\-]+` — proíbe `/` no segmento
 * (bloqueia `org/sub/repo`), proíbe segmento vazio (bloqueia `foo/..` que
 * tentaria fazer path-traversal no nome do repo). O ponto `.` é permitido
 * dentro do nome (válido em GitHub: `foo.bar-baz`), mas a regex força
 * exatamente DOIS segmentos não-vazios — qualquer caractere fora do range
 * (espaços, `;`, `$`, `\n`, `(`, `\``) quebra o match.
 *
 * @see ADR-V2-043 — Provisioning via clone com whitelist restritiva
 */
export const REPO_URL_REGEX =
  /^(git@(github\.com|gitlab\.com|bitbucket\.org):[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+(\.git)?|https:\/\/(github\.com|gitlab\.com|bitbucket\.org)\/[A-Za-z0-9_.\-]+\/[A-Za-z0-9_.\-]+(\.git)?)$/;

/**
 * Tamanho máximo da coluna `DProject.repoUrl` (VARCHAR(512)).
 *
 * Validado adicionalmente à regex porque `@MaxLength(512)` no DTO só
 * cobre a camada HTTP — chamadas internas (service-to-service, jobs)
 * precisam da mesma proteção.
 */
export const REPO_URL_MAX_LENGTH = 512;

/**
 * Valida URL de repositório git contra a whitelist canônica.
 *
 * Combina dois testes:
 *  1. Regex (`REPO_URL_REGEX`) — protocolo + host + estrutura owner/repo.
 *  2. Tamanho (`REPO_URL_MAX_LENGTH`) — limite da coluna VARCHAR(512).
 *
 * Retorna `true` somente quando ambas as condições passam.
 *
 * @param url - URL bruta vinda de usuário ou banco.
 * @returns `true` se passar regex E ≤ 512 chars; `false` caso contrário.
 *
 * @example
 * ```typescript
 * isValidRepoUrl('git@github.com:org/repo.git');           // true
 * isValidRepoUrl('https://github.com/org/repo');           // true
 * isValidRepoUrl('https://gitea.io/org/repo');             // false (host fora da whitelist)
 * isValidRepoUrl('git@github.com:foo/bar.git; rm -rf /');  // false (command injection)
 * isValidRepoUrl('git@github.com:foo/bar$(whoami).git');   // false ($ não permitido)
 * ```
 *
 * @see REPO_URL_REGEX para a whitelist completa
 * @see ADR-V2-043
 */
export function isValidRepoUrl(url: string): boolean {
  if (typeof url !== 'string') {
    return false;
  }
  if (url.length > REPO_URL_MAX_LENGTH) {
    return false;
  }
  return REPO_URL_REGEX.test(url);
}

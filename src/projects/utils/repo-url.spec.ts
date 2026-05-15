import { REPO_URL_REGEX, isValidRepoUrl } from './repo-url';

/**
 * Testes da whitelist canônica de `DProject.repoUrl` (ADR-V2-043).
 *
 * Cobertura:
 *  - 3 SSH OK (github, gitlab, bitbucket)
 *  - 3 HTTPS OK (github, gitlab, bitbucket)
 *  - 3 hosts fora da whitelist (gitea, codeberg, sourceforge)
 *  - 3 ataques (command injection, shell expansion, newline)
 */
describe('repo-url whitelist (ADR-V2-043)', () => {
  describe('SSH hosts permitidos', () => {
    it('aceita SSH github.com', () => {
      const url = 'git@github.com:org/repo.git';
      expect(isValidRepoUrl(url)).toBe(true);
      expect(REPO_URL_REGEX.test(url)).toBe(true);
    });

    it('aceita SSH gitlab.com', () => {
      const url = 'git@gitlab.com:org/repo.git';
      expect(isValidRepoUrl(url)).toBe(true);
      expect(REPO_URL_REGEX.test(url)).toBe(true);
    });

    it('aceita SSH bitbucket.org', () => {
      const url = 'git@bitbucket.org:org/repo.git';
      expect(isValidRepoUrl(url)).toBe(true);
      expect(REPO_URL_REGEX.test(url)).toBe(true);
    });
  });

  describe('HTTPS hosts permitidos', () => {
    it('aceita HTTPS github.com com .git', () => {
      const url = 'https://github.com/org/repo.git';
      expect(isValidRepoUrl(url)).toBe(true);
      expect(REPO_URL_REGEX.test(url)).toBe(true);
    });

    it('aceita HTTPS gitlab.com sem .git', () => {
      const url = 'https://gitlab.com/org/repo';
      expect(isValidRepoUrl(url)).toBe(true);
      expect(REPO_URL_REGEX.test(url)).toBe(true);
    });

    it('aceita HTTPS bitbucket.org com .git', () => {
      const url = 'https://bitbucket.org/org/repo.git';
      expect(isValidRepoUrl(url)).toBe(true);
      expect(REPO_URL_REGEX.test(url)).toBe(true);
    });
  });

  describe('hosts fora da whitelist', () => {
    it('rejeita gitea.io', () => {
      const url = 'https://gitea.io/x/y';
      expect(isValidRepoUrl(url)).toBe(false);
      expect(REPO_URL_REGEX.test(url)).toBe(false);
    });

    it('rejeita codeberg.org', () => {
      const url = 'https://codeberg.org/x/y';
      expect(isValidRepoUrl(url)).toBe(false);
      expect(REPO_URL_REGEX.test(url)).toBe(false);
    });

    it('rejeita sourceforge.net', () => {
      const url = 'https://sourceforge.net/x/y';
      expect(isValidRepoUrl(url)).toBe(false);
      expect(REPO_URL_REGEX.test(url)).toBe(false);
    });
  });

  describe('tentativas de injection (anti-RCE)', () => {
    it('rejeita command injection com ;', () => {
      const url = 'git@github.com:foo/bar.git; rm -rf /';
      expect(isValidRepoUrl(url)).toBe(false);
      expect(REPO_URL_REGEX.test(url)).toBe(false);
    });

    it('rejeita shell expansion com $(...)', () => {
      const url = 'git@github.com:foo/bar$(whoami).git';
      expect(isValidRepoUrl(url)).toBe(false);
      expect(REPO_URL_REGEX.test(url)).toBe(false);
    });

    it('rejeita newline injection', () => {
      const url = 'git@github.com:foo/bar.git\nrm -rf /';
      expect(isValidRepoUrl(url)).toBe(false);
      expect(REPO_URL_REGEX.test(url)).toBe(false);
    });
  });
});

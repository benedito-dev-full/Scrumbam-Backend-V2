/**
 * Specs unit do identity-resolver (Sub-tarefa 4).
 *
 * Cobre parsing de CLAUDE.md, edge cases de formato, erros mapeados.
 */
import { IdentityResolverError, resolveProjectPath } from '../src/claude-code/identity-resolver';

const VALID_CLAUDE_MD = `# CLAUDE.md global

Notes do CEO.

## scrumban-backend-v2
- Caminho: /home/dev/projetos/Scrumban-Backend-V2
- Descrição: backend principal

## frontend
- Caminho: /home/dev/projetos/Scrumbam-FrontEnd

## devari-core
* Path: /home/dev/projetos/Devari-Core
- Descrição: template framework
`;

describe('identity-resolver', () => {
  describe('resolveProjectPath', () => {
    it('extrai path absoluto com "- Caminho:"', () => {
      const path = resolveProjectPath('scrumban-backend-v2', '/dummy.md', {
        readFile: () => VALID_CLAUDE_MD,
      });
      expect(path).toBe('/home/dev/projetos/Scrumban-Backend-V2');
    });

    it('extrai path absoluto com bullet "*" e label "Path"', () => {
      const path = resolveProjectPath('devari-core', '/dummy.md', {
        readFile: () => VALID_CLAUDE_MD,
      });
      expect(path).toBe('/home/dev/projetos/Devari-Core');
    });

    it('case-sensitive: slug com case errado → UNKNOWN_PROJECT_SLUG', () => {
      expect(() =>
        resolveProjectPath('Scrumban-Backend-V2', '/dummy.md', {
          readFile: () => VALID_CLAUDE_MD,
        }),
      ).toThrow(IdentityResolverError);
      try {
        resolveProjectPath('Scrumban-Backend-V2', '/dummy.md', {
          readFile: () => VALID_CLAUDE_MD,
        });
      } catch (e) {
        expect((e as IdentityResolverError).code).toBe('UNKNOWN_PROJECT_SLUG');
      }
    });

    it('slug inexistente → UNKNOWN_PROJECT_SLUG', () => {
      try {
        resolveProjectPath('nao-existe', '/dummy.md', {
          readFile: () => VALID_CLAUDE_MD,
        });
        fail('deveria ter lançado');
      } catch (e) {
        expect(e).toBeInstanceOf(IdentityResolverError);
        expect((e as IdentityResolverError).code).toBe('UNKNOWN_PROJECT_SLUG');
      }
    });

    it('seção sem Caminho → INVALID_CLAUDE_MD_ENTRY', () => {
      const md = `## foo
- Descrição: sem caminho
- Owner: alguem
`;
      try {
        resolveProjectPath('foo', '/dummy.md', { readFile: () => md });
        fail('deveria ter lançado');
      } catch (e) {
        expect((e as IdentityResolverError).code).toBe('INVALID_CLAUDE_MD_ENTRY');
      }
    });

    it('Caminho relativo (não começa com /) → INVALID_CLAUDE_MD_ENTRY', () => {
      const md = `## foo
- Caminho: relativo/path
`;
      try {
        resolveProjectPath('foo', '/dummy.md', { readFile: () => md });
        fail('deveria ter lançado');
      } catch (e) {
        expect((e as IdentityResolverError).code).toBe('INVALID_CLAUDE_MD_ENTRY');
      }
    });

    it('CLAUDE.md inexistente (ENOENT) → CLAUDE_MD_NOT_FOUND', () => {
      try {
        resolveProjectPath('foo', '/inexistente.md', {
          readFile: () => {
            const err = new Error('no such file') as NodeJS.ErrnoException;
            err.code = 'ENOENT';
            throw err;
          },
        });
        fail('deveria ter lançado');
      } catch (e) {
        expect((e as IdentityResolverError).code).toBe('CLAUDE_MD_NOT_FOUND');
      }
    });

    it('erro de I/O genérico → CLAUDE_MD_READ_ERROR', () => {
      try {
        resolveProjectPath('foo', '/dummy.md', {
          readFile: () => {
            const err = new Error('permission denied') as NodeJS.ErrnoException;
            err.code = 'EACCES';
            throw err;
          },
        });
        fail('deveria ter lançado');
      } catch (e) {
        expect((e as IdentityResolverError).code).toBe('CLAUDE_MD_READ_ERROR');
      }
    });

    it('CRLF line endings (Windows) funciona', () => {
      const crlf = VALID_CLAUDE_MD.replace(/\n/g, '\r\n');
      const path = resolveProjectPath('frontend', '/dummy.md', {
        readFile: () => crlf,
      });
      expect(path).toBe('/home/dev/projetos/Scrumbam-FrontEnd');
    });

    it('múltiplas seções: para no próximo `##`', () => {
      // Garante que "frontend" não pega o Caminho de "scrumban-backend-v2".
      const path = resolveProjectPath('frontend', '/dummy.md', {
        readFile: () => VALID_CLAUDE_MD,
      });
      expect(path).toBe('/home/dev/projetos/Scrumbam-FrontEnd');
      expect(path).not.toBe('/home/dev/projetos/Scrumban-Backend-V2');
    });
  });
});

import { fromMcp, fromNexus } from '../tool-principal';

/**
 * Onda 0.2 — `ToolPrincipal.can()` polimorfico por superficie.
 *
 * Cobre:
 *  - MCP: `can()` = pertencimento aos scopes da chave.
 *  - Nexus: `can()` = pertencimento aos scopes efetivos do RBAC, DEFAULT NEGA.
 *  - `actorEntidadeId`/`organizationId`/`surface` corretos.
 */
describe('ToolPrincipal (camada neutra de Capabilities)', () => {
  describe('fromMcp — scopes da chave', () => {
    it('can() = true quando o scope esta na key', () => {
      const principal = fromMcp({
        actorEntidadeId: BigInt(7),
        scopes: ['tasks:read', 'tasks:write'],
      });

      expect(principal.surface).toBe('mcp');
      expect(principal.actorEntidadeId).toBe(BigInt(7));
      expect(principal.can('tasks:read')).toBe(true);
      expect(principal.can('tasks:write')).toBe(true);
    });

    it('can() = false quando o scope NAO esta na key', () => {
      const principal = fromMcp({ actorEntidadeId: BigInt(7), scopes: ['tasks:read'] });
      expect(principal.can('executions:create')).toBe(false);
    });

    it('scopes ausentes/nao-array => can() sempre false (fail-closed)', () => {
      const principal = fromMcp({
        actorEntidadeId: BigInt(7),
        scopes: undefined as unknown as string[],
      });
      expect(principal.can('tasks:read')).toBe(false);
    });

    it('propaga organizationId quando informado', () => {
      const principal = fromMcp({
        actorEntidadeId: BigInt(7),
        scopes: [],
        organizationId: BigInt(99),
      });
      expect(principal.organizationId).toBe(BigInt(99));
    });
  });

  describe('fromNexus — RBAC com default restritivo', () => {
    it('can() = true apenas para scopes concedidos pelo RBAC', () => {
      const principal = fromNexus({
        actorEntidadeId: BigInt(3),
        grantedScopes: ['tasks:read'],
      });

      expect(principal.surface).toBe('nexus');
      expect(principal.actorEntidadeId).toBe(BigInt(3));
      expect(principal.can('tasks:read')).toBe(true);
    });

    it('DEFAULT NEGA: scope nao mapeado => can() false', () => {
      const principal = fromNexus({ actorEntidadeId: BigInt(3), grantedScopes: ['tasks:read'] });
      expect(principal.can('tasks:write')).toBe(false);
      expect(principal.can('executions:create')).toBe(false);
    });

    it('grantedScopes vazio => nega tudo', () => {
      const principal = fromNexus({ actorEntidadeId: BigInt(3), grantedScopes: [] });
      expect(principal.can('tasks:read')).toBe(false);
    });

    it('propaga organizationId quando informado', () => {
      const principal = fromNexus({
        actorEntidadeId: BigInt(3),
        grantedScopes: [],
        organizationId: BigInt(42),
      });
      expect(principal.organizationId).toBe(BigInt(42));
    });
  });
});

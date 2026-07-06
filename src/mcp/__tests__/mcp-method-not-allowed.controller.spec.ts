import 'reflect-metadata';

import {
  GUARDS_METADATA,
  HEADERS_METADATA,
  HTTP_CODE_METADATA,
} from '@nestjs/common/constants';

import { McpController } from '../mcp.controller';

/**
 * F3/F5.1 — Transporte GET/DELETE do MCP.
 *   1. GET `/mcp` → abre stream SSE (F5.1, destrava Claude Web) — protegido
 *      pelos guards `McpEnabledGuard + McpOriginGuard + McpAuthGuard` (o Web
 *      manda o Bearer também no GET). NÃO é mais 405.
 *   2. DELETE `/mcp` → segue `405 Method Not Allowed` + `Allow: POST` (stateless,
 *      sem sessão a terminar — ADR-V2-071).
 *   3. DELETE não exige guard de credencial (405 é protocolo).
 *   4. `POST /mcp` permanece intocado (McpEnabledGuard + McpOriginGuard + McpAuthGuard).
 *
 * Asserts via metadata dos decorators — a mesma fonte de verdade que o Nest usa
 * em runtime.
 */
describe('MCP F3/F5.1 — transporte GET(SSE)/DELETE(405)', () => {
  /** Lê o status HTTP declarado por @HttpCode no método. */
  const httpCodeOf = (method: keyof McpController): number =>
    Reflect.getMetadata(HTTP_CODE_METADATA, McpController.prototype[method] as object);

  /** Lê os headers declarados por @Header no método (mapa nome→valor). */
  const headersOf = (method: keyof McpController): Record<string, string> => {
    const headers =
      (Reflect.getMetadata(HEADERS_METADATA, McpController.prototype[method] as object) as
        | Array<{ name: string; value: string }>
        | undefined) ?? [];
    return headers.reduce<Record<string, string>>((acc, h) => {
      acc[h.name] = h.value;
      return acc;
    }, {});
  };

  /** Lê os guards declarados por @UseGuards no método (array de classes). */
  const guardsOf = (method: keyof McpController): unknown[] =>
    (Reflect.getMetadata(GUARDS_METADATA, McpController.prototype[method] as object) as
      | unknown[]
      | undefined) ?? [];

  describe('GET /mcp → SSE (F5.1)', () => {
    it('DoD 1: GET é protegido pelos 3 guards (Bearer no GET do Claude Web)', () => {
      // O GET agora abre stream SSE e exige credencial (como o POST), pois o
      // Claude Web manda o Authorization: Bearer também no GET.
      const guards = guardsOf('openSseStream');
      expect(guards).toHaveLength(3);
      const names = guards.map((g) => (g as { name: string }).name);
      expect(names).toEqual(
        expect.arrayContaining(['McpEnabledGuard', 'McpOriginGuard', 'McpAuthGuard']),
      );
    });

    it('DoD 1b: GET não declara mais 405 (deixou de ser method-not-allowed)', () => {
      // Sem @HttpCode(405): o handler controla a Response manualmente (200 + SSE).
      expect(httpCodeOf('openSseStream')).toBeUndefined();
    });
  });

  describe('DELETE /mcp', () => {
    it('DoD 2: retorna 405 com Allow: POST e corpo informativo', () => {
      const controller = Object.create(McpController.prototype) as McpController;

      expect(httpCodeOf('methodNotAllowedDelete')).toBe(405);
      expect(headersOf('methodNotAllowedDelete')).toEqual({ Allow: 'POST' });
      expect(controller.methodNotAllowedDelete()).toEqual({
        error: 'Method Not Allowed. Use POST.',
      });
    });

    it('DoD 3: não exige McpKeyGuard (protocolo, não credencial)', () => {
      expect(guardsOf('methodNotAllowedDelete')).toHaveLength(0);
    });
  });

  describe('POST /mcp permanece protegido (regressão F3 + F4)', () => {
    it('DoD 4: handle() mantém McpEnabledGuard + McpOriginGuard + McpAuthGuard', () => {
      const guards = guardsOf('handle');
      // Três guards no POST (após OAuth F4): enabled + origin + auth (dual-auth,
      // que delega ao McpKeyGuard internamente). Os nomes confirmam que a
      // blindagem de credencial NÃO vazou para os handlers 405.
      expect(guards).toHaveLength(3);
      const names = guards.map((g) => (g as { name: string }).name);
      expect(names).toEqual(
        expect.arrayContaining(['McpEnabledGuard', 'McpOriginGuard', 'McpAuthGuard']),
      );
    });

    it('OAuth F4: McpOriginGuard vem ANTES de McpAuthGuard (barra cedo)', () => {
      const names = guardsOf('handle').map((g) => (g as { name: string }).name);
      expect(names.indexOf('McpOriginGuard')).toBeLessThan(names.indexOf('McpAuthGuard'));
    });
  });
});

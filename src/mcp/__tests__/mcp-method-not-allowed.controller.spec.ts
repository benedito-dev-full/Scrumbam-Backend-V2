import 'reflect-metadata';

import {
  GUARDS_METADATA,
  HEADERS_METADATA,
  HTTP_CODE_METADATA,
} from '@nestjs/common/constants';

import { McpController } from '../mcp.controller';

/**
 * F3 — `GET /mcp` e `DELETE /mcp` → `405 Method Not Allowed` (spec Streamable
 * HTTP 2025-03-26). Cobre o DoD:
 *   1. GET responde 405 + `Allow: POST`, corpo informativo
 *   2. DELETE responde 405 + `Allow: POST`, corpo informativo
 *   3. Handlers NÃO exigem `McpKeyGuard` (405 é protocolo, não credencial —
 *      o cliente MCP sonda o método antes de autenticar)
 *   4. `POST /mcp` permanece intocado (guards McpEnabledGuard + McpKeyGuard)
 *
 * Como os handlers são síncronos e sem dependências, os asserts de status/header
 * são feitos via metadata dos decorators (@HttpCode / @Header) — a mesma fonte
 * de verdade que o Nest usa em runtime para montar a resposta.
 */
describe('MCP F3 — GET/DELETE → 405 Method Not Allowed', () => {
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

  describe('GET /mcp', () => {
    it('DoD 1: retorna 405 com Allow: POST e corpo informativo', () => {
      const controller = Object.create(McpController.prototype) as McpController;

      expect(httpCodeOf('methodNotAllowedGet')).toBe(405);
      expect(headersOf('methodNotAllowedGet')).toEqual({ Allow: 'POST' });
      expect(controller.methodNotAllowedGet()).toEqual({
        error: 'Method Not Allowed. Use POST.',
      });
    });

    it('DoD 3: não exige McpKeyGuard (protocolo, não credencial)', () => {
      // Sonda de método precede a autenticação; o handler deve responder 405
      // sem nenhum guard de chave no seu nível.
      expect(guardsOf('methodNotAllowedGet')).toHaveLength(0);
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
    it('DoD 4: handle() mantém McpEnabledGuard + McpOriginGuard + McpKeyGuard', () => {
      const guards = guardsOf('handle');
      // Três guards no POST (após F4): enabled + origin + key. Os nomes
      // confirmam que a blindagem de credencial NÃO vazou para os handlers 405.
      expect(guards).toHaveLength(3);
      const names = guards.map((g) => (g as { name: string }).name);
      expect(names).toEqual(
        expect.arrayContaining(['McpEnabledGuard', 'McpOriginGuard', 'McpKeyGuard']),
      );
    });

    it('F4: McpOriginGuard vem ANTES de McpKeyGuard (barra cedo)', () => {
      const names = guardsOf('handle').map((g) => (g as { name: string }).name);
      expect(names.indexOf('McpOriginGuard')).toBeLessThan(names.indexOf('McpKeyGuard'));
    });
  });
});

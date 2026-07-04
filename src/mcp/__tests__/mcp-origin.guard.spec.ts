import { ExecutionContext, ForbiddenException, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import { MCP_ALLOWED_ORIGINS_ENV } from '../constants';
import { McpOriginGuard } from '../guards/mcp-origin.guard';

describe('McpOriginGuard (F4 — anti DNS-rebinding)', () => {
  function configFor(value: string | undefined): ConfigService {
    return {
      get: jest.fn((key: string) =>
        key === MCP_ALLOWED_ORIGINS_ENV ? value : undefined,
      ),
    } as unknown as ConfigService;
  }

  function contextFor(headers: Record<string, unknown>): ExecutionContext {
    return {
      switchToHttp: () => ({
        getRequest: () => ({ headers }),
      }),
    } as unknown as ExecutionContext;
  }

  it('(a) permite quando header Origin está AUSENTE [Claude Code]', () => {
    const guard = new McpOriginGuard(configFor('https://app.exemplo.com'));

    expect(guard.canActivate(contextFor({}))).toBe(true);
  });

  it('(b) permite quando Origin está na allow-list', () => {
    const guard = new McpOriginGuard(
      configFor('https://app.exemplo.com,http://localhost:3000'),
    );

    expect(
      guard.canActivate(contextFor({ origin: 'http://localhost:3000' })),
    ).toBe(true);
  });

  it('(b2) normaliza espaços da allow-list e do header (trim)', () => {
    const guard = new McpOriginGuard(
      configFor('  https://app.exemplo.com , http://localhost:3000 '),
    );

    expect(
      guard.canActivate(contextFor({ origin: ' https://app.exemplo.com ' })),
    ).toBe(true);
  });

  it('(c) rejeita com ForbiddenException (403) quando Origin fora da allow-list', () => {
    const guard = new McpOriginGuard(configFor('https://app.exemplo.com'));

    expect(() =>
      guard.canActivate(contextFor({ origin: 'https://evil.com' })),
    ).toThrow(ForbiddenException);
  });

  it('(d) allow-list vazia → permite e emite logger.warn (fail-open)', () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const guard = new McpOriginGuard(configFor(undefined));

    expect(
      guard.canActivate(contextFor({ origin: 'https://qualquer.com' })),
    ).toBe(true);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });

  it('(d2) allow-list só com vírgulas/espaços conta como vazia → fail-open', () => {
    const warnSpy = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);

    const guard = new McpOriginGuard(configFor('  ,  , '));

    expect(guard.canActivate(contextFor({ origin: 'https://x.com' }))).toBe(true);
    expect(warnSpy).toHaveBeenCalled();

    warnSpy.mockRestore();
  });
});

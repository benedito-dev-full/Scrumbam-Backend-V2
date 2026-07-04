import 'reflect-metadata';

import {
  GUARDS_METADATA,
  HEADERS_METADATA,
  HTTP_CODE_METADATA,
} from '@nestjs/common/constants';
import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Response } from 'express';

import {
  HTTP_STATUS_ACCEPTED,
  MCP_ALLOWED_ORIGINS_ENV,
  MCP_PROTOCOL_VERSION,
} from '../constants';
import { McpOriginGuard } from '../guards/mcp-origin.guard';
import { McpController } from '../mcp.controller';
import { McpJsonRpcService } from '../services/mcp-json-rpc.service';
import { McpRouterService } from '../services/mcp-router.service';
import { CreateTaskTool } from '../tools/create-task.tool';
import { ListProjectsTool } from '../tools/list-projects.tool';
import { ListTasksTool } from '../tools/list-tasks.tool';
import { UpdateStatusTool } from '../tools/update-status.tool';

/**
 * F5 — Suíte INTEGRADORA de conformidade do transporte MCP Streamable HTTP
 * (spec `2025-03-26`, ADR-V2-071).
 *
 * Duas responsabilidades:
 *
 *  1. REGRESSÃO DO CLIENTE LEGADO (nomeado, bloqueante): prova que o handshake
 *     completo do Claude Code atual — `initialize` (protocolVersion 2024-11-05)
 *     → `tools/list` → `tools/call` de uma read simples — permanece 200 + JSON,
 *     idêntico ao baseline, atravessando o MESMO fluxo do controller.
 *
 *  2. MATRIZ DE TRANSPORTE: reúne num só arquivo coeso os invariantes-chave já
 *     cobertos por specs de fase (protocolVersion echo, 202 vs 200, batch misto,
 *     405 GET/DELETE, Origin ausente/ok/proibida), aqui verificados de forma
 *     integrada — o caminho end-to-end, não fatias isoladas.
 *
 * Reusa os padrões de mock dos specs de fase (mcp-accept-202,
 * mcp-method-not-allowed, mcp-origin.guard) — NÃO reinventa.
 */
describe('MCP F5 — Conformance (Streamable HTTP transport, ADR-V2-071)', () => {
  let controller: McpController;

  const userCtx = {
    dEntidadeId: BigInt(1),
    scopes: ['tasks:read'],
    keyChave: BigInt(10),
    keyPrefix: 'scrumban_mcp',
    keyHash: 'hash',
  };

  /**
   * Mock mínimo do Response do express com `status` espião encadeável.
   * (mesmo shape usado em mcp-accept-202.controller.spec.ts)
   */
  const buildResMock = (): { res: Response; statusSpy: jest.Mock } => {
    const statusSpy = jest.fn();
    const res = { status: statusSpy } as unknown as Response;
    statusSpy.mockReturnValue(res);
    return { res, statusSpy };
  };

  beforeEach(() => {
    const tasksService = {
      findMany: jest
        .fn()
        .mockResolvedValue({ items: [], pagination: { hasMore: false, nextCursor: null } }),
      create: jest.fn(),
      findOne: jest.fn(),
      updateStatus: jest.fn(),
    };
    const projectsService = {
      findMany: jest
        .fn()
        .mockResolvedValue({ items: [], pagination: { hasMore: false, nextCursor: null } }),
      findAccessibleProjectIds: jest.fn().mockResolvedValue([]),
      findOne: jest.fn(),
    };

    controller = new McpController(
      new McpJsonRpcService(),
      new McpRouterService(
        new ListTasksTool(tasksService as never, projectsService as never),
        new CreateTaskTool(tasksService as never, projectsService as never),
        new UpdateStatusTool(tasksService as never, projectsService as never),
        new ListProjectsTool(projectsService as never),
      ),
    );
  });

  /**
   * Helper: envia uma request (com id) pelo fluxo real do controller e
   * devolve a JSON-RPC response única. `res` presente porém não elevado a 202
   * (é o caminho 200 esperado para requests).
   */
  const call = async (
    payload: Record<string, unknown>,
  ): Promise<{ id?: unknown; result?: unknown; error?: unknown }> => {
    const { res } = buildResMock();
    const out = await controller.handle(payload, { userCtx } as never, res);
    return out as { id?: unknown; result?: unknown; error?: unknown };
  };

  describe('REGRESSÃO DO CLIENTE LEGADO (Claude Code, X-MCP-Key, 2024-11-05)', () => {
    it('handshake completo initialize → tools/list → tools/call é idêntico ao baseline (200 + JSON)', async () => {
      // 1. initialize com a versão do Claude Code atual.
      const init = await call({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: { protocolVersion: '2024-11-05' },
      });

      // Result ecoa EXATAMENTE 2024-11-05 (back-compat bloqueante).
      expect(init.id).toBe(1);
      expect(init.result).toEqual(
        expect.objectContaining({
          protocolVersion: '2024-11-05',
          capabilities: { tools: {} },
          serverInfo: { name: 'scrumban-mcp', version: '1.0.0' },
        }),
      );

      // 2. tools/list → 200 + JSON com array de tools.
      const list = await call({ jsonrpc: '2.0', method: 'tools/list', id: 2 });
      expect(list.id).toBe(2);
      const tools = (list.result as { tools: unknown[] }).tools;
      expect(Array.isArray(tools)).toBe(true);
      expect(tools.length).toBeGreaterThan(0);
      expect(tools).toEqual(
        expect.arrayContaining([expect.objectContaining({ name: 'list_tasks' })]),
      );

      // 3. tools/call de uma read simples (list_tasks) → 200 + JSON, sem erro.
      const called = await call({
        jsonrpc: '2.0',
        method: 'tools/call',
        id: 3,
        params: { name: 'list_tasks', arguments: {} },
      });
      expect(called.id).toBe(3);
      expect(called.error).toBeUndefined();
      expect(called.result).toBeDefined();
    });

    it('notifications/initialized do Claude Code → 202 sem corpo (fire-and-forget)', async () => {
      const { res, statusSpy } = buildResMock();

      const out = await controller.handle(
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { userCtx } as never,
        res,
      );

      expect(out).toBeNull();
      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_ACCEPTED);
    });
  });

  describe('MATRIZ — negociação de protocolVersion', () => {
    it('ecoa 2025-03-26 quando pedido (Claude Web)', async () => {
      const res = await call({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: { protocolVersion: '2025-03-26' },
      });
      expect((res.result as { protocolVersion: string }).protocolVersion).toBe('2025-03-26');
    });

    it('ecoa 2024-11-05 quando pedido (Claude Code)', async () => {
      const res = await call({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 1,
        params: { protocolVersion: '2024-11-05' },
      });
      expect((res.result as { protocolVersion: string }).protocolVersion).toBe('2024-11-05');
    });

    it('devolve o default do servidor quando ausente ou fora da allow-list', async () => {
      // Default = MCP_PROTOCOL_VERSION (2024-11-05), preservado para não
      // surpreender o Claude Code caso o cliente não negocie versão.
      const ausente = await call({ jsonrpc: '2.0', method: 'initialize', id: 1, params: {} });
      const desconhecida = await call({
        jsonrpc: '2.0',
        method: 'initialize',
        id: 2,
        params: { protocolVersion: '9999-99-99' },
      });

      expect((ausente.result as { protocolVersion: string }).protocolVersion).toBe(
        MCP_PROTOCOL_VERSION,
      );
      expect((desconhecida.result as { protocolVersion: string }).protocolVersion).toBe(
        MCP_PROTOCOL_VERSION,
      );
    });
  });

  describe('MATRIZ — 202 (notifications-only) vs 200 (request)', () => {
    it('request com id (initialize) → 200 + JSON, status NÃO elevado a 202', async () => {
      const { res, statusSpy } = buildResMock();

      const out = await controller.handle(
        { jsonrpc: '2.0', method: 'initialize', id: 1, params: {} },
        { userCtx } as never,
        res,
      );

      expect(out).toEqual(expect.objectContaining({ id: 1 }));
      expect(statusSpy).not.toHaveBeenCalled();
    });

    it('notification-only → 202 sem corpo', async () => {
      const { res, statusSpy } = buildResMock();

      const out = await controller.handle(
        { jsonrpc: '2.0', method: 'notifications/initialized' },
        { userCtx } as never,
        res,
      );

      expect(out).toBeNull();
      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_ACCEPTED);
    });

    it('batch misto (request + notification) → 200 com SÓ a response da request', async () => {
      const { res, statusSpy } = buildResMock();

      const out = await controller.handle(
        [
          { jsonrpc: '2.0', method: 'tools/list', id: 7 },
          { jsonrpc: '2.0', method: 'notifications/initialized' },
        ],
        { userCtx } as never,
        res,
      );

      expect(out).toHaveLength(1);
      expect(out).toEqual([expect.objectContaining({ id: 7 })]);
      expect(statusSpy).not.toHaveBeenCalled();
    });

    it('batch só de notifications → 202 sem corpo', async () => {
      const { res, statusSpy } = buildResMock();

      const out = await controller.handle(
        [
          { jsonrpc: '2.0', method: 'notifications/initialized' },
          { jsonrpc: '2.0', method: 'notifications/initialized' },
        ],
        { userCtx } as never,
        res,
      );

      expect(out).toBeNull();
      expect(statusSpy).toHaveBeenCalledWith(HTTP_STATUS_ACCEPTED);
    });
  });

  describe('MATRIZ — GET/DELETE → 405 Method Not Allowed', () => {
    const httpCodeOf = (method: keyof McpController): number =>
      Reflect.getMetadata(HTTP_CODE_METADATA, McpController.prototype[method] as object);

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

    const guardsOf = (method: keyof McpController): unknown[] =>
      (Reflect.getMetadata(GUARDS_METADATA, McpController.prototype[method] as object) as
        | unknown[]
        | undefined) ?? [];

    it('GET → 405 + Allow: POST, sem guard de credencial', () => {
      expect(httpCodeOf('methodNotAllowedGet')).toBe(405);
      expect(headersOf('methodNotAllowedGet')).toEqual({ Allow: 'POST' });
      expect(guardsOf('methodNotAllowedGet')).toHaveLength(0);
      expect(controller.methodNotAllowedGet()).toEqual({
        error: 'Method Not Allowed. Use POST.',
      });
    });

    it('DELETE → 405 + Allow: POST, sem guard de credencial', () => {
      expect(httpCodeOf('methodNotAllowedDelete')).toBe(405);
      expect(headersOf('methodNotAllowedDelete')).toEqual({ Allow: 'POST' });
      expect(guardsOf('methodNotAllowedDelete')).toHaveLength(0);
      expect(controller.methodNotAllowedDelete()).toEqual({
        error: 'Method Not Allowed. Use POST.',
      });
    });

    it('POST mantém McpEnabledGuard + McpOriginGuard + McpKeyGuard (Origin antes de Key)', () => {
      const names = guardsOf('handle').map((g) => (g as { name: string }).name);
      expect(names).toEqual(
        expect.arrayContaining(['McpEnabledGuard', 'McpOriginGuard', 'McpKeyGuard']),
      );
      expect(names.indexOf('McpOriginGuard')).toBeLessThan(names.indexOf('McpKeyGuard'));
    });
  });

  describe('MATRIZ — validação de Origin (anti DNS-rebinding)', () => {
    const contextFor = (headers: Record<string, unknown>): ExecutionContext =>
      ({
        switchToHttp: () => ({ getRequest: () => ({ headers }) }),
      }) as unknown as ExecutionContext;

    const configFor = (value: string | undefined): ConfigService =>
      ({
        get: jest.fn((key: string) => (key === MCP_ALLOWED_ORIGINS_ENV ? value : undefined)),
      }) as unknown as ConfigService;

    it('Origin ausente → passa (Claude Code)', () => {
      const guard = new McpOriginGuard(configFor('https://app.exemplo.com'));
      expect(guard.canActivate(contextFor({}))).toBe(true);
    });

    it('Origin na allow-list → passa (Claude Web)', () => {
      const guard = new McpOriginGuard(configFor('https://app.exemplo.com'));
      expect(guard.canActivate(contextFor({ origin: 'https://app.exemplo.com' }))).toBe(true);
    });

    it('Origin fora da allow-list → 403 ForbiddenException', () => {
      const guard = new McpOriginGuard(configFor('https://app.exemplo.com'));
      expect(() => guard.canActivate(contextFor({ origin: 'https://evil.com' }))).toThrow(
        ForbiddenException,
      );
    });
  });
});

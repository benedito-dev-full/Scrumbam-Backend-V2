import { Body, Controller, HttpCode, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';

import { MCP_ERROR_CODES } from './constants';
import { JsonRpcRequestDto } from './dto/json-rpc-request.dto';
import { JsonRpcResponse } from './dto/json-rpc-response.dto';
import { McpEnabledGuard } from './guards/mcp-enabled.guard';
import { McpKeyGuard } from './guards/mcp-key.guard';
import { McpAuthenticatedRequest } from './interfaces/mcp.types';
import { McpAuditService } from './services/mcp-audit.service';
import { McpJsonRpcService } from './services/mcp-json-rpc.service';
import { McpRateLimitService } from './services/mcp-rate-limit.service';
import { McpRouterService } from './services/mcp-router.service';

@ApiTags('MCP')
@Controller('mcp')
export class McpController {
  constructor(
    private readonly jsonRpc: McpJsonRpcService,
    private readonly router: McpRouterService,
    private readonly rateLimit?: McpRateLimitService,
    private readonly audit?: McpAuditService,
  ) {}

  @Post()
  @HttpCode(200)
  @UseGuards(McpEnabledGuard, McpKeyGuard)
  @ApiOperation({ summary: 'Endpoint JSON-RPC 2.0 único do MCP' })
  @ApiHeader({ name: 'X-MCP-Key', required: true })
  @ApiBody({ type: Object })
  async handle(
    @Body() body: unknown,
    @Req() request: McpAuthenticatedRequest,
  ): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
    const startedAt = Date.now();
    const blockedResponse = await this.applyRateLimit(body, request, startedAt);
    if (blockedResponse !== undefined) {
      return blockedResponse;
    }

    if (Array.isArray(body)) {
      return this.handleBatch(body, request, startedAt);
    }

    return this.handleSingle(body, request, startedAt);
  }

  private async handleBatch(
    batch: unknown[],
    request: McpAuthenticatedRequest,
    startedAt: number,
  ): Promise<JsonRpcResponse[] | null> {
    if (batch.length === 0) {
      return [
        this.jsonRpc.error(null, MCP_ERROR_CODES.INVALID_REQUEST, 'Invalid Request'),
      ];
    }

    const responses: JsonRpcResponse[] = [];
    for (const item of batch) {
      const response = await this.handleSingle(item, request, startedAt);
      if (response) {
        responses.push(response);
      }
    }

    return responses.length > 0 ? responses : null;
  }

  private async handleSingle(
    payload: unknown,
    request: McpAuthenticatedRequest,
    startedAt: number,
  ): Promise<JsonRpcResponse | null> {
    const validation = await this.jsonRpc.validateRequest(payload);
    if (this.jsonRpc.isErrorResponse(validation)) {
      return validation;
    }

    if (request.mcpAuthError || !request.userCtx) {
      return this.jsonRpc.error(
        validation.id ?? null,
        request.mcpAuthError?.code ?? MCP_ERROR_CODES.UNAUTHORIZED,
        request.mcpAuthError?.message ?? 'Unauthorized',
        request.mcpAuthError?.data,
      );
    }

    const dispatched = await this.router.dispatch(
      validation.method,
      validation.params,
      request.userCtx,
    );

    if (dispatched.noResponse || validation.id === undefined) {
      this.scheduleAudit(validation, request, startedAt);
      return null;
    }

    if (dispatched.error) {
      const response = this.jsonRpc.error(
        validation.id ?? null,
        dispatched.error.code,
        dispatched.error.message,
        dispatched.error.data,
      );
      this.scheduleAudit(validation, request, startedAt);
      return response;
    }

    const response = this.jsonRpc.success(validation.id ?? null, dispatched.result ?? null);
    this.scheduleAudit(validation, request, startedAt);
    return response;
  }

  private async applyRateLimit(
    body: unknown,
    request: McpAuthenticatedRequest,
    startedAt: number,
  ): Promise<JsonRpcResponse | JsonRpcResponse[] | null | undefined> {
    if (request.mcpAuthError || !request.userCtx || !this.rateLimit) {
      return undefined;
    }

    const rateLimit = await this.rateLimit.check(request.userCtx.keyHash);
    if (rateLimit.allowed) {
      return undefined;
    }

    const buildResponse = (payload: unknown): JsonRpcResponse => {
      const raw = payload && typeof payload === 'object' && !Array.isArray(payload)
        ? (payload as Record<string, unknown>)
        : {};
      const id = this.jsonRpc.extractId(raw);
      const method = typeof raw.method === 'string' ? raw.method : 'unknown';
      const params = raw.params && typeof raw.params === 'object' && !Array.isArray(raw.params)
        ? (raw.params as Record<string, unknown>)
        : undefined;
      this.scheduleAudit(
        { method, params, id } as JsonRpcRequestDto,
        request,
        startedAt,
      );
      return this.jsonRpc.error(
        id,
        MCP_ERROR_CODES.RATE_LIMIT_EXCEEDED,
        'Rate limit exceeded',
        { retryAfterSeconds: rateLimit.retryAfterSeconds ?? 60 },
      );
    };

    if (Array.isArray(body)) {
      return body.length > 0 ? body.map((item) => buildResponse(item)) : [
        this.jsonRpc.error(
          null,
          MCP_ERROR_CODES.RATE_LIMIT_EXCEEDED,
          'Rate limit exceeded',
          { retryAfterSeconds: rateLimit.retryAfterSeconds ?? 60 },
        ),
      ];
    }

    return buildResponse(body);
  }

  private scheduleAudit(
    validation: Pick<JsonRpcRequestDto, 'method' | 'params' | 'id'>,
    request: McpAuthenticatedRequest,
    startedAt: number,
  ): void {
    const audit = this.audit;
    if (!request.userCtx || !audit) {
      return;
    }

    const durationMs = Math.max(1, Date.now() - startedAt);
    const correlationId = validation.id === undefined || validation.id === null
      ? randomUUID()
      : String(validation.id);

    setImmediate(() => {
      void audit.record({
        method: validation.method,
        params: validation.params,
        userCtx: request.userCtx!,
        httpCode: 200,
        durationMs,
        correlationId,
      });
    });
  }
}

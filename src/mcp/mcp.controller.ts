import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Post,
  Req,
  Res,
  UseGuards,
} from '@nestjs/common';
import { ApiBody, ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'crypto';
import { Response } from 'express';

import { HTTP_STATUS_ACCEPTED, HTTP_STATUS_OK, MCP_ERROR_CODES } from './constants';
import { JsonRpcRequestDto } from './dto/json-rpc-request.dto';
import { JsonRpcResponse } from './dto/json-rpc-response.dto';
import { McpEnabledGuard } from './guards/mcp-enabled.guard';
import { McpKeyGuard } from './guards/mcp-key.guard';
import { McpOriginGuard } from './guards/mcp-origin.guard';
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
  @UseGuards(McpEnabledGuard, McpOriginGuard, McpKeyGuard)
  @ApiOperation({ summary: 'Endpoint JSON-RPC 2.0 único do MCP' })
  @ApiHeader({ name: 'X-MCP-Key', required: true })
  @ApiBody({ type: Object })
  async handle(
    @Body() body: unknown,
    @Req() request: McpAuthenticatedRequest,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
    const startedAt = Date.now();

    // Classifica o input ANTES de despachar: um body sem nenhuma request
    // (só notifications/responses) deve responder 202 Accepted sem corpo,
    // conforme spec MCP Streamable HTTP (2025-03-26). Erro/rate-limit/body
    // inválido NUNCA viram 202 — continuam no fluxo de erro atual (200+JSON).
    const containsRequest = this.bodyContainsRequest(body);

    // httpCode que o cliente verá para ESTA resposta HTTP. Usado tanto no
    // envelope (res.status) quanto no audit (DEvento -495), mantendo os dois
    // coerentes. Só é 202 quando o body é exclusivamente notifications/responses.
    const httpCode = containsRequest ? HTTP_STATUS_OK : HTTP_STATUS_ACCEPTED;

    const blockedResponse = await this.applyRateLimit(body, request, startedAt);
    if (blockedResponse !== undefined) {
      // Rate limit devolve JSON-RPC error com HTTP 200 (padrão do módulo);
      // o audit dentro do applyRateLimit já registra 200.
      return blockedResponse;
    }

    const result = Array.isArray(body)
      ? await this.handleBatch(body, request, startedAt, httpCode)
      : await this.handleSingle(body, request, startedAt, httpCode);

    // Só elevamos para 202 quando (a) o processamento não produziu nenhuma
    // resposta (result === null) E (b) o input era exclusivamente
    // notifications/responses (zero requests). A dupla checagem blinda o
    // caminho: qualquer item com `id` de request mantém 200 + JSON.
    if (result === null && !containsRequest && res) {
      res.status(HTTP_STATUS_ACCEPTED);
    }

    return result;
  }

  /**
   * `GET /mcp` → 405 Method Not Allowed (spec Streamable HTTP 2025-03-26).
   *
   * Este servidor é STATELESS e NÃO oferece stream SSE server-push, logo o
   * método GET (usado por clientes para abrir um stream de eventos) não é
   * suportado. Conforme a spec, a resposta correta é 405 com header
   * `Allow: POST` — o cliente MCP sonda o método ANTES de autenticar, por
   * isso este handler NÃO exige `McpKeyGuard` (405 é sobre o método, não
   * sobre credencial). O único método servido é `POST`.
   *
   * @returns Corpo simples informando que apenas POST é aceito.
   *
   * @see ADR-V2-071 (transporte Streamable HTTP aditivo, stateless)
   */
  @Get()
  @HttpCode(405)
  @Header('Allow', 'POST')
  @ApiOperation({
    summary: 'Método não suportado (servidor stateless, sem SSE server-push)',
  })
  @ApiResponse({ status: 405, description: 'Method Not Allowed. Use POST.' })
  methodNotAllowedGet(): { error: string } {
    return { error: 'Method Not Allowed. Use POST.' };
  }

  /**
   * `DELETE /mcp` → 405 Method Not Allowed (spec Streamable HTTP 2025-03-26).
   *
   * DELETE serviria para terminar uma sessão (`Mcp-Session-Id`). Como o
   * transporte é STATELESS (sem sessão — ADR-V2-071), não há nada a
   * terminar, logo o método não é suportado: 405 + `Allow: POST`. Assim
   * como o GET, NÃO exige `McpKeyGuard` (é resposta de protocolo, não de
   * autenticação).
   *
   * @returns Corpo simples informando que apenas POST é aceito.
   *
   * @see ADR-V2-071 (transporte Streamable HTTP aditivo, stateless)
   */
  @Delete()
  @HttpCode(405)
  @Header('Allow', 'POST')
  @ApiOperation({ summary: 'Método não suportado (servidor stateless, sem sessão)' })
  @ApiResponse({ status: 405, description: 'Method Not Allowed. Use POST.' })
  methodNotAllowedDelete(): { error: string } {
    return { error: 'Method Not Allowed. Use POST.' };
  }

  /**
   * Determina se o body (single ou batch) contém ao menos uma request
   * JSON-RPC — item que tem `method` E `id` presente (não-undefined).
   *
   * Notification = tem `method` mas SEM `id`. Response = tem `id` mas sem
   * `method`. Nenhum dos dois espera resposta síncrona, logo um body só com
   * eles responde 202. Um único request (com `id`) força o fluxo 200+JSON.
   */
  private bodyContainsRequest(body: unknown): boolean {
    if (Array.isArray(body)) {
      return body.some((item) => this.itemIsRequest(item));
    }

    return this.itemIsRequest(body);
  }

  private itemIsRequest(item: unknown): boolean {
    if (!item || typeof item !== 'object' || Array.isArray(item)) {
      return false;
    }

    const raw = item as Record<string, unknown>;
    return typeof raw.method === 'string' && raw.id !== undefined;
  }

  private async handleBatch(
    batch: unknown[],
    request: McpAuthenticatedRequest,
    startedAt: number,
    httpCode: number,
  ): Promise<JsonRpcResponse[] | null> {
    if (batch.length === 0) {
      return [
        this.jsonRpc.error(null, MCP_ERROR_CODES.INVALID_REQUEST, 'Invalid Request'),
      ];
    }

    const responses: JsonRpcResponse[] = [];
    for (const item of batch) {
      const response = await this.handleSingle(item, request, startedAt, httpCode);
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
    httpCode: number,
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
      // Notification / response (sem id): não gera corpo. O httpCode reflete
      // a resposta HTTP agregada (202 se o body só tinha notifications; 200
      // se estava num batch misto com requests).
      this.scheduleAudit(validation, request, startedAt, httpCode);
      return null;
    }

    if (dispatched.error) {
      const response = this.jsonRpc.error(
        validation.id ?? null,
        dispatched.error.code,
        dispatched.error.message,
        dispatched.error.data,
      );
      // Request com id sempre responde 200 + JSON, mesmo em erro JSON-RPC.
      this.scheduleAudit(validation, request, startedAt, HTTP_STATUS_OK);
      return response;
    }

    const response = this.jsonRpc.success(validation.id ?? null, dispatched.result ?? null);
    this.scheduleAudit(validation, request, startedAt, HTTP_STATUS_OK);
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
        HTTP_STATUS_OK,
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
    httpCode: number,
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
        httpCode,
        durationMs,
        correlationId,
      });
    });
  }
}

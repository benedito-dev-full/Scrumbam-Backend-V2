import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Logger,
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
import { McpAuthGuard } from './guards/mcp-auth.guard';
import { McpEnabledGuard } from './guards/mcp-enabled.guard';
import { McpOriginGuard } from './guards/mcp-origin.guard';
import { McpAuthenticatedRequest } from './interfaces/mcp.types';
import { McpAuditService } from './services/mcp-audit.service';
import { McpJsonRpcService } from './services/mcp-json-rpc.service';
import { McpRateLimitService } from './services/mcp-rate-limit.service';
import { McpRouterService } from './services/mcp-router.service';

@ApiTags('MCP')
@Controller('mcp')
export class McpController {
  private readonly logger = new Logger(McpController.name);

  constructor(
    private readonly jsonRpc: McpJsonRpcService,
    private readonly router: McpRouterService,
    private readonly rateLimit?: McpRateLimitService,
    private readonly audit?: McpAuditService,
  ) {}

  /**
   * Log de diagnóstico temporário (F5.1) — registra a assinatura de cada
   * request que chega ao MCP (método, accept, presença de auth/session/proto),
   * SEM vazar o token. Serve para observar a sequência exata que o Claude Web
   * executa após o OAuth. Remover após fechar o handshake do Web.
   */
  private logInbound(method: string, request: McpAuthenticatedRequest): void {
    const h = request.headers ?? {};
    const has = (k: string): string => (h[k] ? 'yes' : 'no');
    const authKind = h.authorization
      ? String(h.authorization).slice(0, 7)
      : 'none';
    this.logger.log(
      `MCP_INBOUND ${method} accept=${String(h.accept ?? '')} ` +
        `auth=${authKind} x-mcp-key=${has('x-mcp-key')} ` +
        `mcp-session-id=${has('mcp-session-id')} ` +
        `mcp-protocol-version=${String(h['mcp-protocol-version'] ?? 'none')} ` +
        `origin=${String(h.origin ?? 'none')}`,
    );
  }

  @Post()
  @HttpCode(200)
  @UseGuards(McpEnabledGuard, McpOriginGuard, McpAuthGuard)
  @ApiOperation({ summary: 'Endpoint JSON-RPC 2.0 único do MCP' })
  @ApiHeader({ name: 'X-MCP-Key', required: true })
  @ApiBody({ type: Object })
  async handle(
    @Body() body: unknown,
    @Req() request: McpAuthenticatedRequest,
    @Res({ passthrough: true }) res?: Response,
  ): Promise<JsonRpcResponse | JsonRpcResponse[] | null> {
    const startedAt = Date.now();
    this.logInbound('POST', request);

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
   * `GET /mcp` → abre um stream SSE (`text/event-stream`) mínimo e stateless.
   *
   * A spec Streamable HTTP (2025-03-26) permite que o servidor responda 405 ao
   * GET quando não oferece SSE server-push. Porém, na prática, o **Claude Web**
   * NÃO tolera o 405: após completar o OAuth, ele abre `GET /mcp` esperando um
   * `200 text/event-stream` e, sem isso, entra em loop e nunca envia o `POST
   * initialize` — resultando em "authorization failed" (ver issues públicas
   * anthropics/claude-ai-mcp #291). O Claude Code, ao contrário, tolera o 405.
   *
   * Para destravar o Web sem virar servidor stateful, este handler abre um
   * stream SSE keep-alive que NÃO faz server-push (mantemos o stateless de
   * ADR-V2-071): apenas emite comentários `:keep-alive` periódicos para manter
   * a conexão viva. O trabalho real continua 100% no `POST /mcp` (JSON-RPC).
   *
   * Passa pelos guards `McpEnabledGuard, McpOriginGuard, McpAuthGuard` — o
   * Claude Web envia o `Authorization: Bearer` também no GET. Sem credencial
   * válida, o guard responde 401 (ou soft-fail) exatamente como no POST.
   *
   * @param request - Request autenticada (userCtx populado pelos guards).
   * @param res - Response do Express, usado em modo raw para o stream SSE.
   *
   * @see ADR-V2-071 (transporte Streamable HTTP aditivo)
   * @see ADR-V2-073 (GET SSE keep-alive aditivo p/ Claude Web — F5.1)
   */
  @Get()
  @UseGuards(McpEnabledGuard, McpOriginGuard, McpAuthGuard)
  @ApiOperation({ summary: 'Abre stream SSE keep-alive (Streamable HTTP)' })
  @ApiResponse({ status: 200, description: 'SSE stream (text/event-stream)' })
  openSseStream(
    @Req() request: McpAuthenticatedRequest,
    @Res() res: Response,
  ): void {
    this.logInbound('GET', request);
    // Credencial inválida no GET: espelha o POST (401 hard-fail já foi lançado
    // pelo McpAuthGuard para Bearer inválido; resta o soft-fail do X-MCP-Key).
    if (request.mcpAuthError || !request.userCtx) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }

    res.status(200);
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache, no-transform');
    res.setHeader('Connection', 'keep-alive');
    // Sessão sintética (stateless): ecoada para satisfazer clientes que
    // esperam um Mcp-Session-Id, sem que o servidor guarde estado algum.
    res.setHeader('Mcp-Session-Id', randomUUID());
    res.flushHeaders?.();

    // Evento inicial + keep-alive periódico. NÃO fazemos server-push de
    // mensagens JSON-RPC (stateless): o stream existe só para o cliente
    // considerar a conexão "aberta" e então prosseguir com o POST initialize.
    res.write(': connected\n\n');
    const keepAlive = setInterval(() => {
      res.write(': keep-alive\n\n');
    }, 15000);

    const close = (): void => {
      clearInterval(keepAlive);
      res.end();
    };
    request.on('close', close);
    request.on('aborted', close);
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

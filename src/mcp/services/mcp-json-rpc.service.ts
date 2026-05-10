import { Injectable } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';

import { MCP_ERROR_CODES, MCP_JSON_RPC_VERSION } from '../constants';
import { JsonRpcRequestDto } from '../dto/json-rpc-request.dto';
import { JsonRpcErrorResponse, JsonRpcResponse } from '../dto/json-rpc-response.dto';
import { McpJsonRpcError } from '../interfaces/mcp.types';

@Injectable()
export class McpJsonRpcService {
  error(
    id: string | number | null,
    code: number,
    message: string,
    data?: unknown,
  ): JsonRpcErrorResponse {
    const error: McpJsonRpcError = { code, message };
    if (data !== undefined) {
      error.data = data;
    }

    return {
      jsonrpc: MCP_JSON_RPC_VERSION,
      error,
      id,
    };
  }

  success(id: string | number | null, result: unknown): JsonRpcResponse {
    return {
      jsonrpc: MCP_JSON_RPC_VERSION,
      result,
      id,
    };
  }

  async validateRequest(payload: unknown): Promise<JsonRpcRequestDto | JsonRpcErrorResponse> {
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
      return this.error(null, MCP_ERROR_CODES.INVALID_REQUEST, 'Invalid Request');
    }

    const raw = payload as Record<string, unknown>;
    const id = this.extractId(raw);
    const dto = plainToInstance(JsonRpcRequestDto, raw);
    const errors = await validate(dto, {
      whitelist: true,
      forbidNonWhitelisted: true,
    });

    if (errors.length > 0) {
      return this.error(id, MCP_ERROR_CODES.INVALID_REQUEST, 'Invalid Request', {
        fields: errors.map((error) => error.property),
      });
    }

    return dto;
  }

  extractId(payload: Record<string, unknown>): string | number | null {
    const id = payload.id;
    if (typeof id === 'string' || typeof id === 'number' || id === null) {
      return id;
    }

    return null;
  }

  isErrorResponse(value: JsonRpcRequestDto | JsonRpcErrorResponse): value is JsonRpcErrorResponse {
    return 'error' in value;
  }
}

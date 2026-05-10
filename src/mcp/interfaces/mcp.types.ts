import { Request } from 'express';

export interface McpUserContext {
  dEntidadeId: bigint;
  scopes: string[];
  keyChave: bigint;
  keyPrefix: string;
  keyHash: string;
}

export interface McpAuthenticatedRequest extends Request {
  userCtx?: McpUserContext;
  mcpAuthError?: McpJsonRpcError;
}

export interface McpJsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export interface McpKeyCachePayload {
  chave: string;
  dEntidadeId: string;
  scopes: string[];
  prefix: string;
  hash: string;
}

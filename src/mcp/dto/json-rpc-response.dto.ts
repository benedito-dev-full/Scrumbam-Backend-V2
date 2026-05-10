import { MCP_JSON_RPC_VERSION } from '../constants';
import { McpJsonRpcError } from '../interfaces/mcp.types';

export interface JsonRpcSuccessResponse {
  jsonrpc: typeof MCP_JSON_RPC_VERSION;
  result: unknown;
  id: string | number | null;
}

export interface JsonRpcErrorResponse {
  jsonrpc: typeof MCP_JSON_RPC_VERSION;
  error: McpJsonRpcError;
  id: string | number | null;
}

export type JsonRpcResponse = JsonRpcSuccessResponse | JsonRpcErrorResponse;

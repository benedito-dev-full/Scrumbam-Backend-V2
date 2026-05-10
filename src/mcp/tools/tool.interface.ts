import { McpJsonRpcError, McpUserContext } from '../interfaces/mcp.types';

export interface McpToolResult {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler(params: unknown, ctx: McpUserContext): Promise<McpToolResult>;
}

export class McpToolError extends Error {
  constructor(
    public readonly code: number,
    message: string,
    public readonly data?: unknown,
  ) {
    super(message);
  }

  toJsonRpcError(): McpJsonRpcError {
    return {
      code: this.code,
      message: this.message,
      ...(this.data !== undefined ? { data: this.data } : {}),
    };
  }
}

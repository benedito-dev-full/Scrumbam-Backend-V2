import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  MCP_ERROR_CODES,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
} from '../constants';
import toolsSchema from '../schemas/tools.schema.json';
import { McpJsonRpcError, McpToolDefinition, McpUserContext } from '../interfaces/mcp.types';
import { CreateTaskTool } from '../tools/create-task.tool';
import { ListProjectsTool } from '../tools/list-projects.tool';
import { ListSprintsTool } from '../tools/list-sprints.tool';
import { ListTasksTool } from '../tools/list-tasks.tool';
import { McpTool, McpToolError } from '../tools/tool.interface';
import { UpdateStatusTool } from '../tools/update-status.tool';

export interface McpDispatchResult {
  result?: unknown;
  error?: McpJsonRpcError;
  noResponse?: boolean;
}

interface McpMetricCounter {
  total: number;
  errors: number;
  timeouts: number;
}

interface McpToolDurations {
  values: number[];
  cursor: number;
}

class McpTimeoutError extends Error {
  constructor(public readonly timeoutMs: number) {
    super('Request timeout');
  }
}

@Injectable()
export class McpRouterService {
  private readonly logger = new Logger(McpRouterService.name);
  private readonly tools: McpTool[];
  private readonly cachedToolDefinitions: McpToolDefinition[];
  private readonly timeoutMs: number;
  private readonly counters = new Map<string, McpMetricCounter>();
  private readonly toolDurations = new Map<string, McpToolDurations>();
  private readonly metricsInterval?: NodeJS.Timeout;

  constructor(
    listTasksTool?: ListTasksTool,
    createTaskTool?: CreateTaskTool,
    updateStatusTool?: UpdateStatusTool,
    listProjectsTool?: ListProjectsTool,
    listSprintsTool?: ListSprintsTool,
    configService?: ConfigService,
  ) {
    const tools: Array<McpTool | undefined> = [
      listTasksTool,
      createTaskTool,
      updateStatusTool,
      listProjectsTool,
      listSprintsTool,
    ];
    this.tools = tools.filter((tool): tool is McpTool => tool !== undefined);
    this.cachedToolDefinitions = (toolsSchema.tools as McpToolDefinition[]).map((tool) => ({
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
    }));
    this.timeoutMs = this.readTimeoutMs(configService);
    this.metricsInterval = setInterval(() => this.logMetricsSnapshot(), 5 * 60 * 1000);
    this.metricsInterval.unref?.();
  }

  async dispatch(
    method: string,
    params: Record<string, unknown> | undefined,
    userCtx: McpUserContext,
  ): Promise<McpDispatchResult> {
    const startedAt = Date.now();
    this.incrementTotal(method);

    switch (method) {
      case 'initialize':
        return {
          result: {
            protocolVersion: MCP_PROTOCOL_VERSION,
            capabilities: { tools: {} },
            serverInfo: {
              name: MCP_SERVER_NAME,
              version: MCP_SERVER_VERSION,
            },
          },
        };
      case 'tools/list':
        return {
          result: {
            tools: this.cachedToolDefinitions,
          },
        };
      case 'tools/call':
        return this.dispatchTool(params, userCtx, startedAt);
      case 'notifications/initialized':
        return { noResponse: true };
      default:
        this.incrementErrors(method);
        return {
          error: {
            code: MCP_ERROR_CODES.METHOD_NOT_FOUND,
            message: 'Method not found',
          },
        };
    }
  }

  private async dispatchTool(
    params: Record<string, unknown> | undefined,
    userCtx: McpUserContext,
    startedAt: number,
  ): Promise<McpDispatchResult> {
    const name = params?.name;
    if (typeof name !== 'string') {
      this.incrementErrors('tools/call');
      return {
        error: {
          code: MCP_ERROR_CODES.INVALID_PARAMS,
          message: 'Invalid params',
          data: { field: 'name', issue: 'required string' },
        },
      };
    }

    const tool = this.tools.find((item) => item.name === name);
    if (!tool) {
      this.incrementErrors('tools/call');
      return {
        error: {
          code: MCP_ERROR_CODES.METHOD_NOT_FOUND,
          message: 'Method not found',
          data: { tool: name },
        },
      };
    }

    try {
      const result = await this.withTimeout(tool.handler(params?.arguments, userCtx));
      this.recordToolDuration(name, Date.now() - startedAt);
      return { result };
    } catch (error) {
      this.incrementErrors('tools/call');
      if (error instanceof McpToolError) {
        return { error: error.toJsonRpcError() };
      }
      if (error instanceof McpTimeoutError) {
        this.incrementTimeouts('tools/call');
        return {
          error: {
            code: MCP_ERROR_CODES.REQUEST_TIMEOUT,
            message: 'Request timeout',
            data: { timeoutMs: error.timeoutMs },
          },
        };
      }

      throw error;
    }
  }

  getMetricsSnapshotForTesting(): Record<string, unknown> {
    return this.buildMetricsSnapshot();
  }

  private readTimeoutMs(configService?: ConfigService): number {
    const raw = configService?.get<string>('MCP_REQUEST_TIMEOUT_MS');
    if (!raw) {
      return 30000;
    }

    if (!/^[1-9]\d*$/.test(raw)) {
      return 30000;
    }

    const parsed = BigInt(raw);
    if (parsed > BigInt(9007199254740991)) {
      return 30000;
    }

    return +raw;
  }

  private async withTimeout<T>(promise: Promise<T>): Promise<T> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      return await Promise.race([
        promise,
        new Promise<never>((_, reject) => {
          timeout = setTimeout(() => reject(new McpTimeoutError(this.timeoutMs)), this.timeoutMs);
        }),
      ]);
    } finally {
      if (timeout) {
        clearTimeout(timeout);
      }
    }
  }

  private incrementTotal(key: string): void {
    this.getCounter(key).total += 1;
  }

  private incrementErrors(key: string): void {
    this.getCounter(key).errors += 1;
  }

  private incrementTimeouts(key: string): void {
    this.getCounter(key).timeouts += 1;
  }

  private getCounter(key: string): McpMetricCounter {
    const existing = this.counters.get(key);
    if (existing) {
      return existing;
    }

    const created = { total: 0, errors: 0, timeouts: 0 };
    this.counters.set(key, created);
    return created;
  }

  private recordToolDuration(toolName: string, durationMs: number): void {
    const existing = this.toolDurations.get(toolName) ?? { values: [], cursor: 0 };
    if (existing.values.length < 100) {
      existing.values.push(durationMs);
    } else {
      existing.values[existing.cursor] = durationMs;
      existing.cursor = (existing.cursor + 1) % 100;
    }

    this.toolDurations.set(toolName, existing);
  }

  private logMetricsSnapshot(): void {
    this.logger.log('mcp_metrics_snapshot', this.buildMetricsSnapshot());
  }

  private buildMetricsSnapshot(): Record<string, unknown> {
    return {
      counters: Object.fromEntries(this.counters.entries()),
      p95byTool: Object.fromEntries(
        Array.from(this.toolDurations.entries()).map(([toolName, durations]) => [
          toolName,
          this.calculateP95(durations.values),
        ]),
      ),
    };
  }

  private calculateP95(values: number[]): number {
    if (values.length === 0) {
      return 0;
    }

    const sorted = [...values].sort((left, right) => left - right);
    const index = Math.ceil(sorted.length * 0.95) - 1;
    return sorted[Math.max(0, index)];
  }
}

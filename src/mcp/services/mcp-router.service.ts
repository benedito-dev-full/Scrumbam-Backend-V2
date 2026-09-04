import { HttpException, HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

import {
  MCP_ERROR_CODES,
  MCP_PROTOCOL_VERSION,
  MCP_SERVER_NAME,
  MCP_SERVER_VERSION,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
} from '../constants';
import toolsSchema from '../schemas/tools.schema.json';
import { McpJsonRpcError, McpToolDefinition, McpUserContext } from '../interfaces/mcp.types';
import { CreateBlockTool } from '../tools/create-block.tool';
import { CreateFromTemplateTool } from '../tools/create-from-template.tool';
import { CreateProjectTool } from '../tools/create-project.tool';
import { CreateTaskTool } from '../tools/create-task.tool';
import { DeleteTaskTool } from '../tools/delete-task.tool';
import { ExecuteTaskTool } from '../tools/execute-task.tool';
import { GetProjectMetricsTool } from '../tools/get-project-metrics.tool';
import { GetProjectTool } from '../tools/get-project.tool';
import { GetTaskTreeTool } from '../tools/get-task-tree.tool';
import { GetTaskTool } from '../tools/get-task.tool';
import { GetUnreadCountTool } from '../tools/get-unread-count.tool';
import { ListMyTasksTool } from '../tools/list-my-tasks.tool';
import { ListBlockTasksTool } from '../tools/list-block-tasks.tool';
import { ListBlocksTool } from '../tools/list-blocks.tool';
import { ListMembersTool } from '../tools/list-members.tool';
import { ListNotificationsTool } from '../tools/list-notifications.tool';
import { ListProjectsTool } from '../tools/list-projects.tool';
import { ListTasksTool } from '../tools/list-tasks.tool';
import { McpCapabilityAdapter } from '../tools/mcp-capability.adapter';
import { McpTool, McpToolError } from '../tools/tool.interface';
import { SearchTasksTool } from '../tools/search-tasks.tool';
import { UpdateNotificationTool } from '../tools/update-notification.tool';
import { UpdateProjectTool } from '../tools/update-project.tool';
import { UpdateStatusTool } from '../tools/update-status.tool';
import { UpdateTaskTool } from '../tools/update-task.tool';
import { UpdateTimerTool } from '../tools/update-timer.tool';

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
    getTaskTool?: GetTaskTool,
    updateTaskTool?: UpdateTaskTool,
    listMembersTool?: ListMembersTool,
    getProjectTool?: GetProjectTool,
    updateProjectTool?: UpdateProjectTool,
    listNotificationsTool?: ListNotificationsTool,
    updateNotificationTool?: UpdateNotificationTool,
    getUnreadCountTool?: GetUnreadCountTool,
    searchTasksTool?: SearchTasksTool,
    listBlocksTool?: ListBlocksTool,
    listBlockTasksTool?: ListBlockTasksTool,
    executeTaskTool?: ExecuteTaskTool,
    updateTimerTool?: UpdateTimerTool,
    deleteTaskTool?: DeleteTaskTool,
    getTaskTreeTool?: GetTaskTreeTool,
    getProjectMetricsTool?: GetProjectMetricsTool,
    listMyTasksTool?: ListMyTasksTool,
    createBlockTool?: CreateBlockTool,
    createProjectTool?: CreateProjectTool,
    createFromTemplateTool?: CreateFromTemplateTool,
    configService?: ConfigService,
    capabilityAdapter?: McpCapabilityAdapter,
  ) {
    const tools: Array<McpTool | undefined> = [
      // list_tasks (Onda 3 — ADR-V2-079): mesma disciplina de fallback de
      // create_task — adapter GANHA quando disponivel E a capability esta
      // registrada; senao cai no wrapper legado (wire identico).
      this.resolveToolWithFallback('list_tasks', listTasksTool, capabilityAdapter),
      // create_task (Onda 1 — ADR-V2-079): quando o `McpCapabilityAdapter` esta
      // disponivel E a capability `create_task` esta registrada, o wire passa a
      // ser servido pelo adapter (Capability -> McpTool). Sem adapter/capability
      // (ex: golden test que instancia `CreateTaskTool` direto), cai no caminho
      // legado — wire byte-a-byte identico (mesmo schema/nome/description, ver
      // `tools.schema.json`).
      this.resolveCreateTaskTool(createTaskTool, capabilityAdapter),
      // update_status (Onda 4 — ADR-V2-079): mesma disciplina de fallback.
      this.resolveToolWithFallback('update_status', updateStatusTool, capabilityAdapter),
      this.resolveToolWithFallback('list_projects', listProjectsTool, capabilityAdapter),
      this.resolveToolWithFallback('get_task', getTaskTool, capabilityAdapter),
      // update_task (Onda 4)
      this.resolveToolWithFallback('update_task', updateTaskTool, capabilityAdapter),
      this.resolveToolWithFallback('list_members', listMembersTool, capabilityAdapter),
      this.resolveToolWithFallback('get_project', getProjectTool, capabilityAdapter),
      // update_project (Onda 4)
      this.resolveToolWithFallback('update_project', updateProjectTool, capabilityAdapter),
      this.resolveToolWithFallback('list_notifications', listNotificationsTool, capabilityAdapter),
      // update_notification (Onda 4)
      this.resolveToolWithFallback(
        'update_notification',
        updateNotificationTool,
        capabilityAdapter,
      ),
      this.resolveToolWithFallback('get_unread_count', getUnreadCountTool, capabilityAdapter),
      this.resolveToolWithFallback('search_tasks', searchTasksTool, capabilityAdapter),
      this.resolveToolWithFallback('list_blocks', listBlocksTool, capabilityAdapter),
      this.resolveToolWithFallback('list_block_tasks', listBlockTasksTool, capabilityAdapter),
      // execute_task: EXCLUIDA da unificacao (Pilar 1 — DPedido -300..-303).
      executeTaskTool,
      // update_timer (Onda 4)
      this.resolveToolWithFallback('update_timer', updateTimerTool, capabilityAdapter),
      // delete_task (Onda 4)
      this.resolveToolWithFallback('delete_task', deleteTaskTool, capabilityAdapter),
      this.resolveToolWithFallback('get_task_tree', getTaskTreeTool, capabilityAdapter),
      this.resolveToolWithFallback('get_project_metrics', getProjectMetricsTool, capabilityAdapter),
      this.resolveToolWithFallback('list_my_tasks', listMyTasksTool, capabilityAdapter),
      // create_block (Onda 4)
      this.resolveToolWithFallback('create_block', createBlockTool, capabilityAdapter),
      // create_project (Onda 4)
      this.resolveToolWithFallback('create_project', createProjectTool, capabilityAdapter),
      // create_from_template (Onda 4)
      this.resolveToolWithFallback(
        'create_from_template',
        createFromTemplateTool,
        capabilityAdapter,
      ),
      // create_comment / list_comments (Onda 2 — ADR-V2-079): NASCEM no MCP
      // aqui — nunca existiram como wrapper legado nesta superficie. Servidas
      // EXCLUSIVAMENTE via `McpCapabilityAdapter` (sem fallback legado, pois
      // nao ha wrapper anterior a preservar). `undefined` quando o adapter ou
      // a capability nao estao disponiveis (ex: specs que instanciam o router
      // com poucos argumentos).
      this.resolveCapabilityOnlyTool('create_comment', capabilityAdapter),
      this.resolveCapabilityOnlyTool('list_comments', capabilityAdapter),
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

  /**
   * Resolve o `McpTool` efetivo para `create_task` (Onda 1 — piloto ADR-V2-079).
   *
   * Preferencia: adapter (Capability -> McpTool) quando `capabilityAdapter` foi
   * injetado E a capability `create_task` esta registrada no `CapabilityRegistry`
   * subjacente. Caso contrario, cai no wrapper legado `CreateTaskTool` — path
   * usado hoje pelo golden test (`mcp-wire.golden.spec.ts`), que instancia
   * `CreateTaskTool` diretamente sem passar `capabilityAdapter`.
   *
   * O wire (`name`/`description`/`inputSchema`) e IDENTICO nos dois caminhos —
   * a capability espelha `tools.schema.json` byte-a-byte (ver
   * `create-task.capability.ts`).
   *
   * @param legacyTool - Wrapper `CreateTaskTool` legado (pode ser `undefined`).
   * @param capabilityAdapter - Adapter da camada neutra (pode ser `undefined`).
   * @returns O `McpTool` a usar para `create_task`, ou `undefined` se nenhum
   *   dos dois caminhos estiver disponivel.
   */
  private resolveCreateTaskTool(
    legacyTool: CreateTaskTool | undefined,
    capabilityAdapter: McpCapabilityAdapter | undefined,
  ): McpTool | undefined {
    if (capabilityAdapter) {
      const capability = capabilityAdapter.getCapability('create_task');
      if (capability) {
        return capabilityAdapter.toMcpTool(capability);
      }
    }
    return legacyTool;
  }

  /**
   * Resolve o `McpTool` efetivo para uma capability generica MIGRADA na
   * Onda 3 (reads so-MCP), com fallback ao wrapper legado — MESMA disciplina
   * de {@link resolveCreateTaskTool}, generalizada para qualquer nome de
   * capability. Preferencia: adapter (Capability -> McpTool) quando
   * `capabilityAdapter` esta disponivel E a capability esta registrada no
   * `CapabilityRegistry`. Caso contrario, cai no wrapper `*.tool.ts` legado —
   * path usado hoje pelo golden test e por specs pre-existentes que
   * instanciam `McpRouterService` com poucos argumentos posicionais.
   *
   * O wire (`name`/`description`/`inputSchema`) e IDENTICO nos dois caminhos
   * — cada capability desta onda espelha `tools.schema.json` byte-a-byte
   * (ver `*.capability.ts` em `src/common/tool-capabilities/capabilities/`).
   *
   * @param capabilityName - Nome canonico snake_case da capability.
   * @param legacyTool - Wrapper `*.tool.ts` legado (pode ser `undefined`).
   * @param capabilityAdapter - Adapter da camada neutra (pode ser `undefined`).
   * @returns O `McpTool` a usar, ou `undefined` se nenhum dos dois caminhos
   *   estiver disponivel.
   */
  private resolveToolWithFallback(
    capabilityName: string,
    legacyTool: McpTool | undefined,
    capabilityAdapter: McpCapabilityAdapter | undefined,
  ): McpTool | undefined {
    if (capabilityAdapter) {
      const capability = capabilityAdapter.getCapability(capabilityName);
      if (capability) {
        return capabilityAdapter.toMcpTool(capability);
      }
    }
    return legacyTool;
  }

  /**
   * Resolve um `McpTool` servido EXCLUSIVAMENTE pela camada de Capabilities —
   * sem wrapper legado a preservar (Onda 2 — `create_comment`/`list_comments`,
   * que NASCEM no MCP nesta onda; ADR-V2-079).
   *
   * Diferente de {@link resolveCreateTaskTool} (que tem fallback legado para
   * compatibilidade com specs pre-existentes), aqui a ausencia do adapter ou
   * da capability registrada resulta em `undefined` — a tool simplesmente nao
   * aparece no `tools/call` (o `tools/list` estatico e independente disso).
   *
   * @param capabilityName - Nome canonico snake_case da capability.
   * @param capabilityAdapter - Adapter da camada neutra (pode ser `undefined`).
   * @returns O `McpTool` traduzido, ou `undefined` se nao disponivel.
   */
  private resolveCapabilityOnlyTool(
    capabilityName: string,
    capabilityAdapter: McpCapabilityAdapter | undefined,
  ): McpTool | undefined {
    if (!capabilityAdapter) {
      return undefined;
    }
    const capability = capabilityAdapter.getCapability(capabilityName);
    if (!capability) {
      return undefined;
    }
    return capabilityAdapter.toMcpTool(capability);
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
            protocolVersion: this.negotiateProtocolVersion(params),
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

  /**
   * Negocia a `protocolVersion` a devolver no `initialize`.
   *
   * Ecoa exatamente a versao pedida pelo cliente quando ela pertence a
   * allow-list {@link MCP_SUPPORTED_PROTOCOL_VERSIONS}. Se a versao estiver
   * ausente, nao for string ou nao for suportada, devolve o default
   * {@link MCP_PROTOCOL_VERSION} — comportamento tolerante, sem erro.
   *
   * Regra de seguranca: NUNCA ecoa uma string arbitraria do cliente; apenas
   * valores da allow-list sao devolvidos.
   *
   * @param params - `params` do request `initialize` (pode conter `protocolVersion`).
   * @returns Versao de protocolo suportada a ecoar na resposta.
   */
  private negotiateProtocolVersion(params: Record<string, unknown> | undefined): string {
    const requested = params?.protocolVersion;
    if (
      typeof requested === 'string' &&
      (MCP_SUPPORTED_PROTOCOL_VERSIONS as readonly string[]).includes(requested)
    ) {
      return requested;
    }

    return MCP_PROTOCOL_VERSION;
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
      if (error instanceof HttpException) {
        // Tools lançam exceções NestJS (NotFoundException, ForbiddenException,
        // etc.) por conveniência de código, mas o transporte Streamable HTTP
        // NUNCA pode deixar uma HttpException escapar até o filtro global: um
        // request com `id` exige SEMPRE HTTP 200 + envelope JSON-RPC, mesmo em
        // erro. Um HTTP 404/403 cru quebra o parser do cliente MCP, que
        // interpreta a resposta malformada como sessão morta e reconecta —
        // essa é a causa raiz do MCP caindo em loop (investigado 2026-09-04).
        return { error: this.httpExceptionToJsonRpcError(error) };
      }

      throw error;
    }
  }

  getMetricsSnapshotForTesting(): Record<string, unknown> {
    return this.buildMetricsSnapshot();
  }

  /**
   * Traduz uma `HttpException` do NestJS (ex.: `NotFoundException` lançada
   * por tools que reutilizam services REST) para o formato JSON-RPC do MCP.
   *
   * Mapeamento por status HTTP → código JSON-RPC mais próximo do catálogo
   * {@link MCP_ERROR_CODES}. Qualquer status sem mapeamento específico cai em
   * `INTERNAL_ERROR` (-32603, código reservado da spec JSON-RPC 2.0).
   */
  private httpExceptionToJsonRpcError(error: HttpException): McpJsonRpcError {
    const status = error.getStatus();
    const codeByStatus: Partial<Record<number, number>> = {
      [HttpStatus.BAD_REQUEST]: MCP_ERROR_CODES.INVALID_PARAMS,
      [HttpStatus.UNAUTHORIZED]: MCP_ERROR_CODES.UNAUTHORIZED,
      [HttpStatus.FORBIDDEN]: MCP_ERROR_CODES.FORBIDDEN,
      [HttpStatus.NOT_FOUND]: MCP_ERROR_CODES.NOT_FOUND,
      [HttpStatus.TOO_MANY_REQUESTS]: MCP_ERROR_CODES.RATE_LIMIT_EXCEEDED,
      [HttpStatus.REQUEST_TIMEOUT]: MCP_ERROR_CODES.REQUEST_TIMEOUT,
    };

    return {
      code: codeByStatus[status] ?? MCP_ERROR_CODES.INTERNAL_ERROR,
      message: error.message,
    };
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

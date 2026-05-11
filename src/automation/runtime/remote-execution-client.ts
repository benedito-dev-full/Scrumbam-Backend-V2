import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { createHash, createHmac, randomUUID } from 'crypto';
import { AgentKeyService } from '../agents/agent-key.service';
import {
  ExecutionLogContext,
  ExecutionRuntimeLogService,
} from './execution-runtime-log.service';

export interface RemoteStructuredCommand {
  executable: string;
  args: string[];
  cwd: string;
  env?: Record<string, string>;
  timeoutMs: number;
  maxOutputBytes: number;
}

export interface RemoteAgentRuntime {
  agentId: string;
  tunnelPort: number;
  agentCommandSecretEncrypted: string;
}

export interface RemoteExecutionRequest {
  executionId: string;
  projectId: string;
  correlationId: string;
  agent: RemoteAgentRuntime;
  workspace: string;
  command: RemoteStructuredCommand;
}

export interface RemoteExecutionResult {
  exitCode: number;
  durationMs?: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  outputTruncated: boolean;
}

interface AgentStreamEvent {
  type?: string;
  line?: string;
  sequence?: number;
  code?: number;
  durationMs?: number;
  timedOut?: boolean;
}

interface OutputAccumulator {
  stdout: string[];
  stderr: string[];
  bytes: number;
  truncated: boolean;
  maxBytes: number;
}

@Injectable()
export class RemoteExecutionClient {
  private readonly logger = new Logger(RemoteExecutionClient.name);

  constructor(
    private readonly agentKeyService: AgentKeyService,
    private readonly logService: ExecutionRuntimeLogService,
  ) {}

  async execute(
    request: RemoteExecutionRequest,
    logContext: ExecutionLogContext,
  ): Promise<RemoteExecutionResult> {
    const body = JSON.stringify({
      protocolVersion: '2026-05-10',
      executionId: request.executionId,
      workspace: request.workspace,
      executable: request.command.executable,
      args: request.command.args,
      cwd: request.command.cwd,
      env: request.command.env ?? {},
      timeoutMs: request.command.timeoutMs,
      maxOutputBytes: request.command.maxOutputBytes,
    });

    const path = '/v1/execute';
    const url = `http://127.0.0.1:${request.agent.tunnelPort}${path}`;
    const headers = this.buildHeaders('POST', path, body, request);

    const controller = new AbortController();
    const timeout = setTimeout(
      () => controller.abort(),
      request.command.timeoutMs + 5000,
    );

    try {
      const response = await fetch(url, {
        method: 'POST',
        headers,
        body,
        signal: controller.signal,
      });

      if (!response.ok || !response.body) {
        throw new ServiceUnavailableException(
          `Agent retornou HTTP ${response.status} para execution ${request.executionId}`,
        );
      }

      return await this.consumeStream(response.body, request, logContext);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `remote_execute_failed executionId=${request.executionId} error=${message}`,
      );
      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }

  private buildHeaders(
    method: string,
    path: string,
    body: string,
    request: RemoteExecutionRequest,
  ): Record<string, string> {
    const timestamp = new Date().toISOString();
    const nonce = randomUUID();
    const secret = this.agentKeyService.decryptCommandSecret(
      request.agent.agentCommandSecretEncrypted,
    );
    const bodyHash = createHash('sha256').update(body, 'utf8').digest('hex');
    const canonical = [method, path, timestamp, nonce, bodyHash].join('\n');
    const signature = createHmac('sha256', secret)
      .update(canonical, 'utf8')
      .digest('hex');

    return {
      'content-type': 'application/json',
      'accept': 'application/x-ndjson, application/json',
      'x-scrumban-agent-id': request.agent.agentId,
      'x-scrumban-execution-id': request.executionId,
      'x-scrumban-timestamp': timestamp,
      'x-scrumban-nonce': nonce,
      'x-scrumban-signature': `hmac-sha256=${signature}`,
    };
  }

  private async consumeStream(
    stream: ReadableStream<Uint8Array>,
    request: RemoteExecutionRequest,
    logContext: ExecutionLogContext,
  ): Promise<RemoteExecutionResult> {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buffered = '';
    const output: OutputAccumulator = {
      stdout: [],
      stderr: [],
      bytes: 0,
      truncated: false,
      maxBytes: request.command.maxOutputBytes,
    };
    let exitCode = -1;
    let durationMs: number | undefined;
    let timedOut = false;

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffered += decoder.decode(value, { stream: true });
      const lines = buffered.split(/\r?\n/);
      buffered = lines.pop() ?? '';

      for (const line of lines) {
        if (!line.trim()) continue;
        const event = this.parseAgentEvent(line);
        if (event.type === 'stdout' || event.type === 'stderr') {
          const outputLine = event.line ?? '';
          this.appendOutput(output, event.type, outputLine);
          await this.logService.recordOutputLine(
            {
              executionId: request.executionId,
              projectId: request.projectId,
              agentId: request.agent.agentId,
              correlationId: request.correlationId,
              stream: event.type,
              line: outputLine,
            },
            logContext,
          );
        }

        if (event.type === 'exit') {
          exitCode = typeof event.code === 'number' ? event.code : -1;
          durationMs = event.durationMs;
          timedOut = event.timedOut === true;
        }
      }
    }

    if (buffered.trim()) {
      const event = this.parseAgentEvent(buffered);
      if (event.type === 'exit') {
        exitCode = typeof event.code === 'number' ? event.code : -1;
        durationMs = event.durationMs;
        timedOut = event.timedOut === true;
      }
    }

    return {
      exitCode,
      durationMs,
      stdout: output.stdout.join('\n'),
      stderr: output.stderr.join('\n'),
      timedOut,
      outputTruncated: output.truncated || logContext.truncated,
    };
  }

  private appendOutput(
    output: OutputAccumulator,
    stream: 'stdout' | 'stderr',
    line: string,
  ): void {
    if (output.truncated) {
      return;
    }

    const hasPreviousOutput = output.stdout.length + output.stderr.length > 0;
    const separatorBytes = hasPreviousOutput ? 1 : 0;
    const lineBytes = Buffer.byteLength(line, 'utf8');
    const remaining = output.maxBytes - output.bytes - separatorBytes;

    if (remaining <= 0) {
      output.truncated = true;
      return;
    }

    const storedLine =
      lineBytes > remaining
        ? Buffer.from(line, 'utf8').subarray(0, remaining).toString('utf8')
        : line;

    output[stream].push(storedLine);
    output.bytes += separatorBytes + Buffer.byteLength(storedLine, 'utf8');
    output.truncated = lineBytes > remaining;
  }

  private parseAgentEvent(line: string): AgentStreamEvent {
    try {
      return JSON.parse(line) as AgentStreamEvent;
    } catch {
      return { type: 'stderr', line: 'Invalid JSON line from agent' };
    }
  }
}

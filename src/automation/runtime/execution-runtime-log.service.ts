import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AUTOMATION_CLASS_IDS } from '../constants/automation-class-ids';

export interface ExecutionLogContext {
  nextSequence: number;
  bytesWritten: number;
  truncated: boolean;
}

export interface ExecutionLogInput {
  executionId: string;
  projectId: string;
  agentId: string;
  correlationId: string;
  stream: 'stdout' | 'stderr' | 'system';
  line: string;
  sequence?: number;
  truncated?: boolean;
  code?: string;
}

const MAX_OUTPUT_BYTES = 1024 * 1024;

@Injectable()
export class ExecutionRuntimeLogService {
  constructor(private readonly prisma: PrismaService) {}

  createContext(): ExecutionLogContext {
    return {
      nextSequence: 1,
      bytesWritten: 0,
      truncated: false,
    };
  }

  async recordOutputLine(
    input: Omit<ExecutionLogInput, 'sequence' | 'truncated'>,
    context: ExecutionLogContext,
  ): Promise<void> {
    if (context.truncated) {
      return;
    }

    const buffer = Buffer.from(input.line, 'utf8');
    const remaining = MAX_OUTPUT_BYTES - context.bytesWritten;
    if (remaining <= 0) {
      context.truncated = true;
      await this.record({
        ...input,
        line: '[output truncated at 1048576 bytes]',
        sequence: context.nextSequence++,
        truncated: true,
        code: 'OUTPUT_LIMIT_EXCEEDED',
      });
      return;
    }

    const truncated = buffer.length > remaining;
    const line = truncated
      ? buffer.subarray(0, remaining).toString('utf8')
      : input.line;

    context.bytesWritten += Buffer.byteLength(line, 'utf8');
    context.truncated = truncated;

    await this.record({
      ...input,
      line,
      sequence: context.nextSequence++,
      truncated,
      ...(truncated ? { code: 'OUTPUT_LIMIT_EXCEEDED' } : {}),
    });
  }

  async recordSystem(input: Omit<ExecutionLogInput, 'stream'>): Promise<void> {
    await this.record({
      ...input,
      stream: 'system',
      sequence: input.sequence ?? 0,
    });
  }

  private async record(input: ExecutionLogInput): Promise<void> {
    await this.prisma.dEvento.create({
      data: {
        idClasse: AUTOMATION_CLASS_IDS.EXECUTION_LOG_EVENT,
        identificadorExterno: input.correlationId,
        descricao: `execution.${input.stream}`,
        metaDados: {
          executionId: input.executionId,
          projectId: input.projectId,
          agentId: input.agentId,
          stream: input.stream,
          sequence: input.sequence ?? 0,
          line: input.line,
          truncated: input.truncated === true,
          ...(input.code ? { code: input.code } : {}),
        } as Prisma.InputJsonValue,
      },
    });
  }
}

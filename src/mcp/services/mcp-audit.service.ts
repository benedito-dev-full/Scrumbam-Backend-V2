import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { createHash } from 'crypto';

import { PrismaService } from '../../prisma.service';
import { MCP_CALL_EVENT_CLASS_ID } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';

export interface McpAuditRecordInput {
  method: string;
  params?: Record<string, unknown>;
  userCtx: McpUserContext;
  httpCode: number;
  durationMs: number;
  correlationId: string;
}

@Injectable()
export class McpAuditService {
  private readonly logger = new Logger(McpAuditService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: McpAuditRecordInput): Promise<void> {
    try {
      const paramsHash = McpAuditService.sha256Hex(
        JSON.stringify(input.params ?? {}),
      );

      await this.prisma.dEvento.create({
        data: {
          idClasse: MCP_CALL_EVENT_CLASS_ID,
          idEntidade: input.userCtx.dEntidadeId,
          identificadorExterno: input.correlationId,
          descricao: `MCP call ${input.method}`,
          metaDados: {
            method: input.method,
            paramsHash,
            httpCode: input.httpCode,
            durationMs: input.durationMs,
            keyPrefix: input.userCtx.keyPrefix,
            correlationId: input.correlationId,
          } as Prisma.JsonObject,
        },
      });
    } catch (err) {
      this.logger.warn(
        `mcp_audit_failed correlationId=${input.correlationId} error=${(err as Error).message}`,
      );
    }
  }

  static sha256Hex(value: string): string {
    return createHash('sha256').update(value).digest('hex');
  }
}

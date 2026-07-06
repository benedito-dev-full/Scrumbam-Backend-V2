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

      // Identidades OAuth (keyPrefix='oauth') têm `dEntidadeId` SINTÉTICO
      // (hash do `sub` do token) que NÃO corresponde a uma DEntidade real —
      // gravá-lo em `idEntidade` viola a FK DEvento_idEntidade_fkey e derruba
      // a auditoria (observado no handshake do Claude Web). Nesse caso gravamos
      // `idEntidade: null` e preservamos a identidade sintética em metaDados
      // (`syntheticEntidadeId`). O mapeamento rico OAuth↔DEntidade é follow-up
      // (ADR-V2-072). Identidades X-MCP-Key seguem com o FK real. (F5.1)
      const isOAuth = input.userCtx.keyPrefix === 'oauth';

      await this.prisma.dEvento.create({
        data: {
          idClasse: MCP_CALL_EVENT_CLASS_ID,
          idEntidade: isOAuth ? null : input.userCtx.dEntidadeId,
          identificadorExterno: input.correlationId,
          descricao: `MCP call ${input.method}`,
          metaDados: {
            method: input.method,
            paramsHash,
            httpCode: input.httpCode,
            durationMs: input.durationMs,
            keyPrefix: input.userCtx.keyPrefix,
            correlationId: input.correlationId,
            ...(isOAuth
              ? { syntheticEntidadeId: input.userCtx.dEntidadeId.toString() }
              : {}),
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

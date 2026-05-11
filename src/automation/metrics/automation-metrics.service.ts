import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { AUTOMATION_CLASS_IDS } from '../constants/automation-class-ids';
import { AutomationMetricsResponseDto } from './automation-metrics.dto';

interface AgentStatusRow {
  status_code: string | null;
  total: bigint;
  last_seen: Date | null;
}

interface StatusRow {
  status_code: string | null;
  total: bigint;
}

interface PercentileRow {
  queue_p95_ms: number | null;
  runtime_p95_ms: number | null;
}

interface FailureRow {
  agent_id: string | null;
  total: bigint;
}

@Injectable()
export class AutomationMetricsService {
  constructor(private readonly prisma: PrismaService) {}

  async getOverview(): Promise<AutomationMetricsResponseDto> {
    const [agentRows, statusRows, percentileRows, failureRows] = await Promise.all([
      this.getAgentStatusRows(),
      this.getExecutionStatusRows(),
      this.getPercentileRows(),
      this.getFailureRows(),
    ]);

    const executionsByStatus = this.statusMap(statusRows);

    return {
      agentsOnline: this.agentCount(agentRows, AUTOMATION_CLASS_IDS.AGENT_STATUS_ONLINE.toString()),
      agentsOffline: this.agentCount(agentRows, AUTOMATION_CLASS_IDS.AGENT_STATUS_OFFLINE.toString()),
      lastHeartbeatAt: this.lastHeartbeat(agentRows),
      executionsByStatus,
      queueP95Ms: percentileRows[0]?.queue_p95_ms ?? null,
      runtimeP95Ms: percentileRows[0]?.runtime_p95_ms ?? null,
      failuresByAgent: Object.fromEntries(
        failureRows
          .filter((row) => row.agent_id)
          .map((row) => [row.agent_id!, Number(row.total)]),
      ),
      calculatedAt: new Date().toISOString(),
    };
  }

  private getAgentStatusRows(): Promise<AgentStatusRow[]> {
    return this.prisma.$queryRaw<AgentStatusRow[]>`
      SELECT
        dados->>'statusCode' AS status_code,
        COUNT(*)::bigint AS total,
        MAX((dados->>'lastSeen')::timestamptz) AS last_seen
      FROM "DEntidade"
      WHERE "idClasse" = ${AUTOMATION_CLASS_IDS.AGENT}
        AND "excluido" = false
      GROUP BY dados->>'statusCode'
    `;
  }

  private getExecutionStatusRows(): Promise<StatusRow[]> {
    return this.prisma.$queryRaw<StatusRow[]>`
      SELECT
        COALESCE(dados->>'statusCode', dados->'approval'->>'status') AS status_code,
        COUNT(*)::bigint AS total
      FROM "DPedido"
      WHERE "idClasse" IN (
        ${AUTOMATION_CLASS_IDS.EXEC_LOW},
        ${AUTOMATION_CLASS_IDS.EXEC_MEDIUM},
        ${AUTOMATION_CLASS_IDS.EXEC_HIGH}
      )
        AND "excluido" = false
      GROUP BY COALESCE(dados->>'statusCode', dados->'approval'->>'status')
    `;
  }

  private getPercentileRows(): Promise<PercentileRow[]> {
    return this.prisma.$queryRaw<PercentileRow[]>`
      SELECT
        percentile_cont(0.95) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (
            (dados->'runtime'->>'startedAt')::timestamptz - "criadoEm"
          )) * 1000
        )::float AS queue_p95_ms,
        percentile_cont(0.95) WITHIN GROUP (
          ORDER BY EXTRACT(EPOCH FROM (
            (dados->'runtime'->>'finishedAt')::timestamptz -
            (dados->'runtime'->>'startedAt')::timestamptz
          )) * 1000
        )::float AS runtime_p95_ms
      FROM "DPedido"
      WHERE "idClasse" IN (
        ${AUTOMATION_CLASS_IDS.EXEC_LOW},
        ${AUTOMATION_CLASS_IDS.EXEC_MEDIUM},
        ${AUTOMATION_CLASS_IDS.EXEC_HIGH}
      )
        AND "excluido" = false
        AND dados->'runtime'->>'startedAt' IS NOT NULL
    `;
  }

  private getFailureRows(): Promise<FailureRow[]> {
    return this.prisma.$queryRaw<FailureRow[]>`
      SELECT
        COALESCE(dados->'audit'->>'agentId', dados->>'agentId') AS agent_id,
        COUNT(*)::bigint AS total
      FROM "DPedido"
      WHERE "idClasse" IN (
        ${AUTOMATION_CLASS_IDS.EXEC_LOW},
        ${AUTOMATION_CLASS_IDS.EXEC_MEDIUM},
        ${AUTOMATION_CLASS_IDS.EXEC_HIGH}
      )
        AND "excluido" = false
        AND dados->>'statusCode' = ${AUTOMATION_CLASS_IDS.EXEC_STATUS_FAILED.toString()}
      GROUP BY COALESCE(dados->'audit'->>'agentId', dados->>'agentId')
    `;
  }

  private agentCount(rows: AgentStatusRow[], statusCode: string): number {
    return Number(rows.find((row) => row.status_code === statusCode)?.total ?? 0);
  }

  private lastHeartbeat(rows: AgentStatusRow[]): string | null {
    const values = rows
      .map((row) => row.last_seen)
      .filter((value): value is Date => value instanceof Date);
    if (values.length === 0) return null;
    return new Date(Math.max(...values.map((value) => value.getTime()))).toISOString();
  }

  private statusMap(rows: StatusRow[]): Record<string, number> {
    return Object.fromEntries(
      rows.map((row) => [row.status_code ?? 'unknown', Number(row.total)]),
    );
  }
}

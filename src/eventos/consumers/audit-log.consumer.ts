import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import type { IEvent } from '../interfaces/event.interface';
import type { IEventConsumer } from '../interfaces/consumer.interface';

/**
 * Mapeamento canônico `event.type` → `DEvento.idClasse`.
 *
 * Alinhado com:
 *  - Plano Mestre §3.2 (faixa -489..-501).
 *  - ADR-V2-026 (`-489 AUDIT_GENERIC` para fallback sem categoria semântica).
 *  - ADR-V2-027 (`-499 PROJECT_LIFECYCLE`, `-500 ORG_LIFECYCLE` —
 *    action `created`/`updated`/`deleted` vai em `metaDados._meta.action`).
 *
 * **Reviewer rejeita** qualquer INSERT em `DEvento` em `src/eventos/`
 * fora deste mapa. Para adicionar novo tipo:
 *  1. Adicionar `EVENT_TYPES.X = 'dominio.entidade.acao'` em `event-types.ts`.
 *  2. Adicionar entrada aqui (ou deixar cair no `FALLBACK_CLASSE`).
 *
 * Decisão deliberada: lookup direto via `Record<string, bigint>` é
 * O(1) e legível. Não usar regex/prefix dinâmico aqui — torna o seed/audit
 * imprevisível.
 */
const TYPE_TO_CLASSE: Readonly<Record<string, bigint>> = Object.freeze({
  // Tasks
  'task.created': BigInt(-497), // TASK_CREATED
  'task.status.changed': BigInt(-498), // TASK_STATUS_CHANGED
  'task.assigned': BigInt(-498), // reusa via metaDados._meta.action
  'task.deleted': BigInt(-498), // reusa via metaDados._meta.action

  // Project lifecycle (ADR-V2-027)
  'project.created': BigInt(-499), // PROJECT_LIFECYCLE
  'project.updated': BigInt(-499),
  'project.deleted': BigInt(-499),

  // Org lifecycle (ADR-V2-027)
  'org.created': BigInt(-500), // ORG_LIFECYCLE
  'org.updated': BigInt(-500),
  'org.deleted': BigInt(-500),

  // Team (sem DClasse semântica dedicada — usa AUDIT_GENERIC com action)
  'team.created': BigInt(-489),
  'team.deleted': BigInt(-489),

  // Entidades (genérico — substitui audit inline em entidades.service)
  'entity.created': BigInt(-489),
  'entity.updated': BigInt(-489),
  'entity.deleted': BigInt(-489),

  // Executions (F6)
  'execution.low.created': BigInt(-496), // EXECUTION_LOG
  'execution.medium.created': BigInt(-496),
  'execution.high.created': BigInt(-496),
  'execution.awaiting_approval': BigInt(-496),
  'execution.approved': BigInt(-496),
  'execution.rejected': BigInt(-496),
  'execution.completed': BigInt(-496),
  'execution.succeeded': BigInt(-496),
  'execution.failed': BigInt(-496),
  'execution.low.skip': BigInt(-496),
  'execution.medium.skip': BigInt(-496),
  'execution.high.skip': BigInt(-496),

  // Auth
  'user.login.succeeded': BigInt(-501), // USER_LOGIN
  'user.login.failed': BigInt(-501),

  // Email — sem categoria semântica dedicada (ADR-V2-026 fallback)
  'email.sent': BigInt(-489), // AUDIT_GENERIC
  'email.failed': BigInt(-489),

  // Sistema
  'system.health.check': BigInt(-489),
  'system.audit.log': BigInt(-489),

  // Integrações (placeholders F10/F11/F12)
  'agent.heartbeat': BigInt(-492), // AGENT_HEARTBEAT
  'webhook.attempted': BigInt(-491), // WEBHOOK_ATTEMPT
  'webhook.auto_disabled': BigInt(-491), // WEBHOOK_ATTEMPT lifecycle/admin
  'mcp.call': BigInt(-495), // MCP_CALL
  'telegram.message.in': BigInt(-493), // TELEGRAM_MSG_IN
  'telegram.message.out': BigInt(-494), // TELEGRAM_MSG_OUT
});

/** Catch-all para tipos não mapeados (ADR-V2-026). */
const FALLBACK_CLASSE: bigint = BigInt(-489);

/**
 * Tenta extrair `idEntidade` (FK opcional para `DEntidade`) a partir do
 * payload. Aceita campos comuns: `entidadeId`, `idEntidade`, `userId`,
 * `agentId`. Retorna `undefined` se não encontrado ou se o valor não for
 * conversível para BigInt.
 */
function extractEntityId(payload: Record<string, unknown>): bigint | undefined {
  const candidates = ['entidadeId', 'idEntidade', 'userId', 'agentId'];
  for (const key of candidates) {
    const v = payload[key];
    if (v == null) continue;
    if (typeof v === 'bigint') return v;
    if (typeof v === 'number' && Number.isFinite(v)) return BigInt(v);
    if (typeof v === 'string' && /^-?\d+$/.test(v)) {
      try {
        return BigInt(v);
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

/**
 * Consumer canônico: persiste cada evento em `DEvento` com `idClasse`
 * derivado do mapa `TYPE_TO_CLASSE` (ou `FALLBACK_CLASSE`).
 *
 * Pilar 1 NÃO ATIVADO em F7 (DEvento é estrutural). Service usa Prisma
 * direto via `dEvento.create`. Reviewer rejeita uso de Engine aqui.
 *
 * Idempotência: o INSERT é simples (cada evento gera 1 registro). Eventos
 * relacionados compartilham `correlationId` mas têm `chave` próprio.
 * Notificações in-app (Task#2) usarão `identificadorExterno` para
 * deduplicação por destinatário.
 */
@Injectable()
export class AuditLogConsumer implements IEventConsumer {
  readonly name = 'audit-log';
  private readonly logger = new Logger(AuditLogConsumer.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Persiste o evento em `DEvento`.
   *
   * Workflow:
   *  1. Resolve `idClasse` via `TYPE_TO_CLASSE[event.type]` ou fallback `-489`.
   *  2. Extrai `idEntidade` (best-effort) do payload.
   *  3. Calcula `action` (sufixo após o último `.`) e injeta em
   *     `metaDados._meta.action`.
   *  4. INSERT atômico em `DEvento` com `descricao=event.type`,
   *     `identificadorExterno=correlationId`.
   *
   * @throws Re-lança qualquer erro do Prisma (CB conta + Retry agenda).
   */
  async handle(event: IEvent): Promise<void> {
    const idClasse = TYPE_TO_CLASSE[event.type] ?? FALLBACK_CLASSE;
    const idEntidade = extractEntityId(event.payload);
    const action = event.type.split('.').pop();

    const metaDados = {
      ...event.payload,
      _meta: {
        ...event.metadata,
        action,
      },
    } as Prisma.InputJsonValue;

    await this.prisma.dEvento.create({
      data: {
        idClasse,
        ...(idEntidade !== undefined && { idEntidade }),
        identificadorExterno: event.correlationId,
        descricao: event.type,
        metaDados,
      },
    });

    this.logger.debug(
      `audit-log persisted: type=${event.type} idClasse=${idClasse.toString()} ` +
        `correlationId=${event.correlationId}`,
    );
  }
}

/** Exposto para testes — permite verificar mapeamento canônico. */
export const __AUDIT_TYPE_TO_CLASSE = TYPE_TO_CLASSE;
export const __AUDIT_FALLBACK_CLASSE = FALLBACK_CLASSE;

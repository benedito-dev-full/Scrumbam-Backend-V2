import { Injectable, Logger } from '@nestjs/common';

// Services do projeto
import { PrismaService } from '../../prisma.service';

/**
 * Serviço de auditoria (stub MVP — Fase 4).
 *
 * Emite eventos canônicos em `DEvento` para rastreamento de ações do sistema.
 * Esta é a implementação MVP síncrona — será substituída pelo `EventProducerService`
 * com queue BullMQ na Fase 7, quando o módulo de eventos for implementado.
 *
 * Classes DEvento usadas:
 * - `-501` USER_LOGIN/AUDIT_GENERIC — eventos de auditoria genéricos
 *   (seed Fase 1, `prisma/seeds/classes.seed.ts`)
 *
 * Regra de ordem (devari-backend-patterns.md §7):
 * - AuditService.log() deve ser chamado SEMPRE após persistência bem-sucedida.
 *
 * @example
 * ```typescript
 * // Após enviar email
 * await this.auditService.log('email.sent', entityId, { to, subject }, userId);
 *
 * // Após criar entidade
 * await this.auditService.log('entity.created', newEntity.chave, { nome: dto.nome });
 *
 * // Falha — também auditar
 * await this.auditService.log('email.failed', entityId, { error: err.message });
 * ```
 */
@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  /** ID da classe DEvento de auditoria genérica (seed F1 — não mudar). */
  private readonly AUDIT_CLASS_ID = BigInt(-501);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Registra um evento de auditoria em DEvento.
   *
   * INSERT direto no banco (sem queue) — Fase 4 stub.
   * Fase 7 substituirá por EventProducerService com BullMQ.
   *
   * @param eventType - Tipo do evento (ex: 'email.sent', 'entity.created', 'email.failed')
   * @param entityId - Chave BigInt da entidade relacionada ao evento
   * @param metadata - Dados adicionais do evento (JSON livre)
   * @param userId - ID do usuário que disparou a ação (opcional — pode ser system)
   *
   * @throws Não lança exceção — falha de audit não deve derrubar o fluxo principal.
   *         Erros são logados no Logger NestJS.
   *
   * @example
   * ```typescript
   * // Auditoria de email enviado
   * await this.auditService.log(
   *   'email.sent',
   *   BigInt(userId),
   *   { to: 'user@email.com', subject: 'Bem-vindo!', provider: 'smtp' },
   *   BigInt(userId)
   * );
   *
   * // Auditoria de sistema (sem userId)
   * await this.auditService.log(
   *   'system.health.check',
   *   BigInt(0),
   *   { status: 'ok', db: 'ok', redis: 'degraded' }
   * );
   * ```
   */
  async log(
    eventType: string,
    entityId: bigint,
    metadata: Record<string, unknown>,
    userId?: bigint,
  ): Promise<void> {
    try {
      // DEvento não tem idUsuario — passamos userId em metaDados
      await this.prisma.dEvento.create({
        data: {
          idClasse: this.AUDIT_CLASS_ID,
          idEntidade: entityId,
          descricao: eventType,
          metaDados: {
            ...metadata,
            ...(userId ? { userId: userId.toString() } : {}),
          } as never,
        },
      });
    } catch (error) {
      // Falha de audit NÃO deve derrubar o fluxo principal
      this.logger.error(
        `Falha ao registrar evento de auditoria [${eventType}]`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }
}

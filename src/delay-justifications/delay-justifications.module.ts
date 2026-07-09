import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DelayJustificationsController } from './delay-justifications.controller';
import { DelayJustificationsService } from './delay-justifications.service';

/**
 * DelayJustificationsModule — Justificativa de Atraso de Tarefas (Fase 1 —
 * Captura, ADR-V2-070).
 *
 * **Storage:** `DEvento` idClasse=-503 (ADR-V2-008 — barramento de
 * eventos/auditoria). ZERO tabela nova (ADR-V2-001); Pilar 1 (Engine) NÃO se
 * aplica (não é transação financeira) — persistência via Prisma direto,
 * padrão idêntico ao TASK_COMMENT -507.
 *
 * **Dependências:**
 * - `AuthModule` (via forwardRef): `AuthCompositeGuard` (ADR-V2-042) +
 *   `RoleResolverService` (RBAC org ADMIN -161).
 * - `CommonModule` (`@Global`): `TimezoneService` + `CorrelationIdService`.
 * - `EventosModule` (`@Global`): `EventProducerService`.
 *   → globais não precisam de import explícito.
 *
 * @see DelayJustificationsService — persistência, supersede e RBAC.
 * @see README.md — idClasse, payload, RBAC, reuso de /classes.
 */
@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [DelayJustificationsController],
  providers: [DelayJustificationsService],
  exports: [DelayJustificationsService],
})
export class DelayJustificationsModule {}

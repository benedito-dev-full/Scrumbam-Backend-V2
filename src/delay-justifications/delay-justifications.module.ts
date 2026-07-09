import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DelayJustificationsController } from './delay-justifications.controller';
import { DelayJustificationsService } from './delay-justifications.service';
import { DelayReasonsController } from './delay-reasons.controller';
import { DelayReasonsService } from './delay-reasons.service';

/**
 * DelayJustificationsModule — Justificativa de Atraso de Tarefas (ADR-V2-070).
 *
 * **Fase 1 (Captura):** `DelayJustificationsController` +
 * `DelayJustificationsService` — POST/GET da vigente, badge de pendências.
 * **Fase 2 (Painel admin):** `DelayReasonsController` +
 * `DelayReasonsService` (`GET /reports/delay-reasons` — agregação, org ADMIN
 * SOMENTE) + `getHistory` (`GET /tasks/:taskId/delay-justification/history`).
 * O painel mora aqui (e não em `reports`) por coesão: o conhecimento do payload
 * de `DEvento -503` fica concentrado num único módulo.
 *
 * **Storage:** `DEvento` idClasse=-503 (ADR-V2-008 — barramento de
 * eventos/auditoria). ZERO tabela nova (ADR-V2-001); Pilar 1 (Engine) NÃO se
 * aplica (não é transação financeira) — persistência via Prisma direto,
 * padrão idêntico ao TASK_COMMENT -507. Agregação por `$queryRaw` (ZERO N+1).
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
  controllers: [DelayJustificationsController, DelayReasonsController],
  providers: [DelayJustificationsService, DelayReasonsService],
  exports: [DelayJustificationsService, DelayReasonsService],
})
export class DelayJustificationsModule {}

import { Module, forwardRef } from '@nestjs/common';

import { AuthModule } from '../../auth/auth.module';
import { TelemetryController } from './telemetry.controller';

/**
 * Módulo de observabilidade (F0 — plano `plan-sessao-auth-hardening.md`).
 *
 * Expõe apenas o `TelemetryController`. O `MetricsService` NÃO é registrado
 * aqui — ele vive no `CommonModule` (`@Global`), para poder ser injetado em
 * guards, services e controllers de qualquer módulo sem import explícito
 * (e sem criar dependência circular com `AuthModule`).
 *
 * `AuthModule` é importado (com `forwardRef` por precaução, já que ele importa
 * outros módulos de domínio) apenas para obter o `AuthCompositeGuard` usado em
 * `GET /telemetry/metrics`.
 */
@Module({
  imports: [forwardRef(() => AuthModule)],
  controllers: [TelemetryController],
})
export class ObservabilityModule {}

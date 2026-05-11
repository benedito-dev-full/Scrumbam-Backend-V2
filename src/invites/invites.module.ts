import { forwardRef, Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ThrottlerModule } from '@nestjs/throttler';

import { InvitesController } from './invites.controller';
import { InvitesService } from './invites.service';
import { AuthModule } from '../auth/auth.module';
import { EmailModule } from '../email/email.module';

/**
 * Modulo de convites por email (ADR-V2-028).
 *
 * Expoe 3 endpoints:
 *  - POST /organizations/:orgId/invites — auth + ADMIN + rate limit 3/min
 *  - GET  /invites/:token — publico (404 anti-enumeracao)
 *  - POST /invites/:token/accept — publico (auto-login pos-onboarding)
 *
 * Pilar 1 NAO aplica (cadastro estrutural, sem DPedido).
 * Tokens persistidos em DTabela idClasse=-476 com hash SHA-256.
 *
 * Dependencias:
 *  - `AuthModule` (forwardRef) — `AuthService.issueSessionForUser` para auto-login.
 *  - `EmailModule` — `EmailService.sendTemplate('invite', ...)`.
 *  - `ThrottlerModule` — guard de rate limit (3 reqs/min no POST create).
 *
 * `CommonModule` e `EventosModule` sao globais — providers de Prisma,
 * CorrelationId e EventProducer ficam disponiveis sem import explicito.
 */
@Module({
  imports: [
    ConfigModule,
    forwardRef(() => AuthModule),
    EmailModule,
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 3 }]),
  ],
  controllers: [InvitesController],
  providers: [InvitesService],
  exports: [InvitesService],
})
export class InvitesModule {}

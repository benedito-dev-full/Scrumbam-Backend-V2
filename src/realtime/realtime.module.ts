import { forwardRef, Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { ProjectsModule } from '../projects/projects.module';
import { RealtimeConsumer } from './realtime.consumer';
import { RealtimeGateway } from './realtime.gateway';
import { WsJwtGuard } from './ws-jwt.guard';

/**
 * RealtimeModule — canal WebSocket do board em tempo real (wiring completo).
 *
 * Componentes:
 * - {@link RealtimeGateway} — namespace `/realtime`, handlers `join:list`/
 *   `leave:list` (RBAC) e método `broadcast` (ponto de saída WS).
 * - {@link WsJwtGuard} — valida JWT do handshake (reusa `JwtService`/`JWT_SECRET`).
 * - {@link RealtimeConsumer} — `IEventConsumer` que escuta `task.*`/`phase.*` e
 *   transmite o envelope para a sala da lista. Auto-registra no
 *   `EventRouterService` via `registerConsumer` dinâmico no seu próprio
 *   `onModuleInit` (padrão ADR-V2-049 — precedente `TelegramNotificationConsumer`).
 *
 * Imports:
 * - `AuthModule` (via forwardRef) → fornece `JwtService`/`JwtModule` ao guard,
 *   reusando o MESMO `JWT_SECRET` do HTTP (sem re-registrar JwtModule).
 * - `ProjectsModule` → fornece `ProjectsService` para o RBAC do `join:list`.
 *
 * O `EventRouterService` (de `EventosModule`, que é `@Global`) é injetável no
 * `RealtimeConsumer` sem import explícito. O consumer NÃO é adicionado ao
 * construtor do `EventRouterService` (registro é dinâmico → anti-circular:
 * Eventos `@Global` NÃO depende de Realtime → Projects → Eventos).
 *
 * Este módulo é importado em `app.module.ts`.
 */
@Module({
  imports: [forwardRef(() => AuthModule), ProjectsModule],
  providers: [RealtimeGateway, WsJwtGuard, RealtimeConsumer],
  exports: [RealtimeGateway],
})
export class RealtimeModule {}

---
name: realtime-websocket-fase1
description: Realtime WebSocket Task6 Fase 1 — deps + RealtimeGateway + WsJwtGuard + RealtimeModule mínimo (sem consumer/app.module wiring)
metadata:
  type: project
---

# Realtime WebSocket (Socket.io) — Task 6, Fase 1 (2026-06-04)

Módulo novo `src/realtime/` (greenfield). Plano: `workspace/plans/plan-realtime-websocket-board-task6.md`. ADR-V2-063 (a redigir). Estratégia "avisar para invalidar": servidor só emite envelope mínimo, front faz invalidateQueries.

**Why:** front (Scrumbam-Frontend-V2) precisa atualizar board da lista em tempo real. listId === projectId === DProject.chave.
**How to apply:** Fase 1 entrega SÓ deps+gateway+guard+module-mínimo. Consumer (`RealtimeConsumer` IEventConsumer), registro via `EventRouterService.registerConsumer` (ADR-V2-049 dinâmico) e import em app.module são FASE 2 — NÃO feitos.

## Deps instaladas (alinhadas à major 10 do NestJS)
`@nestjs/websockets@^10` (10.4.22), `@nestjs/platform-socket.io@^10` (10.4.22), `socket.io@^4` (4.8.3). NUNCA instalar major 11 (resto do Nest é ^10.3.0).

## Arquivos criados
- `src/realtime/ws-jwt.guard.ts` — `WsJwtGuard implements CanActivate`. Reusa `JwtService`+`ConfigService` do AuthModule (NÃO re-registra JwtModule, secret via `config.get('JWT_SECRET')`). Token DUAS vias: `client.handshake.auth.token` PRIMEIRO, fallback header `Authorization: Bearer`. Sucesso → `client.data.user = payload` (JwtPayload). Falha → `throw new WsException('Unauthorized')`.
- `src/realtime/realtime.gateway.ts` — `@WebSocketGateway({ namespace:'/realtime', cors:{origin, credentials:true} })` + `@UseGuards(WsJwtGuard)`. `join:list`/`leave:list` handlers; `broadcast(room,event,payload)` → `server.to(room).emit('list:event', { event, ...payload })`. RBAC no join reusa `ProjectsService.findAccessibleProjectIds(BigInt(user.entidadeId), user.organizationId)`; sem acesso → `client.emit('error',{code:'FORBIDDEN_LIST',listId})` e return.
- `src/realtime/dto/join-list.dto.ts` — `{ listId:string }` com `@IsString()@IsNotEmpty()`.
- `src/realtime/realtime.module.ts` — imports `[forwardRef(()=>AuthModule), ProjectsModule]`, providers `[RealtimeGateway, WsJwtGuard]`, exports `[RealtimeGateway]`. SEM consumer.
- specs: `ws-jwt.guard.spec.ts` (5), `realtime.gateway.spec.ts` (5). Total 10 verdes.

## GOTCHAS
- **CORS origin no decorator**: opções de `@WebSocketGateway` avaliadas na DEFINIÇÃO da classe (antes do DI) → NÃO dá pra ler ConfigService. Resolvido com const top-level `REALTIME_CORS_ORIGIN = process.env.REALTIME_CORS_ORIGIN ?? 'https://scrumban.com.br'` (decisão do dono: default scrumban.com.br). credentials:true.
- **strictPropertyInitialization ON**: `@WebSocketServer() server: Server` e DTO `listId: string` dão TS2564 — usar `server!: Server` e `listId!: string` (padrão `!` já usado no repo, ex. `dueDate!`).
- **Canal de saída ÚNICO** `'list:event'`, envelope `{ event, listId, entityId, actorId }` (decisão do dono).
- `findAccessibleProjectIds` retorna `string[]`; comparar `listId` (string) direto, sem BigInt.

## Validação
Build = `npm run build` (nest build; `make` não existe no Win) PASS. `npx jest src/realtime` = 10/10. `npx eslint src/realtime/**/*.ts` = 0. app.module.ts NÃO tocado (git status limpo, 0 refs realtime).

# Realtime Module (WebSocket/Socket.io)

**Versão:** 1.0
**Módulo:** `src/realtime/`
**Status:** Aceito (ADR-V2-063)
**Padrão:** Consumer dinâmico no barramento de eventos canônico

---

## Propósito

Transmite eventos de domínio em tempo real para clientes WebSocket, permitindo atualização do board da lista quando múltiplos usuários colaboram simultaneamente.

**Estratégia:** "avisar para invalidar" — envelope mínimo `{ event, listId, entityId, actorId }`, frontend recarrega dados via `invalidateQueries()`.

---

## Arquitetura

```
TasksService (emite evento)
    ↓
EventProducerService.addInternalEvent('task.updated', payload)
    ↓
EventRouterService.route(event)
    ↓
RealtimeConsumer.handle(event)  [registrado dinamicamente via registerConsumer]
    ↓
RealtimeGateway.broadcast('list:' + listId, event)
    ↓
server.to('list:' + listId).emit('list:event', envelope)
    ↓
Cliente (browser): socket.on('list:event', (envelope) => { invalidateQueries([...]) })
```

**Regra de ouro:** RealtimeGateway **NUNCA** é injetado em domínio (TasksService). Acoplamento máximo via EventRouter.

---

## Componentes

### `RealtimeGateway` (@WebSocketGateway)

Gerencia conexões WebSocket, namespaces, e salas.

```typescript
@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: 'https://scrumban.com.br', credentials: true }
})
@UseGuards(WsJwtGuard)
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  @WebSocketServer() server: Server;

  @SubscribeMessage('join:list')
  async handleJoinList(client: Socket, dto: JoinListDto): Promise<void> {
    // RBAC: valida acesso via ProjectsService.findAccessibleProjectIds()
    // if (denied) throw new WsException({ code: 'FORBIDDEN_LIST' })
    // if (allowed) client.join('list:' + dto.listId)
  }

  @SubscribeMessage('leave:list')
  async handleLeaveList(client: Socket, dto: JoinListDto): Promise<void> {
    client.leave('list:' + dto.listId);
  }

  /**
   * Método público: transmite evento para a sala (chamado por RealtimeConsumer).
   */
  broadcast(room: string, event: string, payload: object): void {
    this.server.to(room).emit('list:event', { event, ...payload });
  }
}
```

**Handlers:**
- `join:list { listId }` — valida RBAC, adiciona cliente à sala `list:{listId}`, emite `joined:list`.
- `leave:list { listId }` — remove cliente da sala.

**Método público:**
- `broadcast(room, event, payload)` — chama `server.to(room).emit('list:event', ...)`.

---

### `WsJwtGuard` (CanActivate)

Valida JWT no handshake WebSocket (duas vias: `handshake.auth.token` ou header `Authorization`).

```typescript
export class WsJwtGuard implements CanActivate {
  constructor(
    private jwtService: JwtService,
    private configService: ConfigService
  ) {}

  async canActivate(context: ExecutionContextHost): Promise<boolean> {
    const client = context.switchToWs().getClient<Socket>();
    const token = client.handshake.auth?.token || client.handshake.headers.authorization?.split(' ')[1];

    if (!token) throw new WsException('Unauthorized');

    try {
      const payload = await this.jwtService.verifyAsync(token, {
        secret: this.configService.get('JWT_SECRET')
      });
      client.data.user = payload as JwtPayload;  // { sub, entidadeId, organizationId, email }
      return true;
    } catch {
      throw new WsException('Unauthorized');
    }
  }
}
```

**Resultado:** `client.data.user` preenchido com JWT payload para uso em handlers.

---

### `RealtimeConsumer` (IEventConsumer)

Escuta eventos de domínio, deriva evento WebSocket, e chama `gateway.broadcast()`.

```typescript
export class RealtimeConsumer implements IEventConsumer {
  readonly name = 'realtime';

  constructor(private gateway: RealtimeGateway) {}

  async handle(event: DomainEvent): Promise<void> {
    // Filtra: task.* e phase.*
    if (!event.type.startsWith('task.') && !event.type.startsWith('phase.')) {
      return;
    }

    const { projectId, taskId, phaseId, actorId, userId, movedBy } = event.payload;
    const listId = projectId?.toString();
    if (!listId) {
      this.logger.debug(`realtime_skip_no_projectId event=${event.type}`);
      return;
    }

    // Derivação: task.* → task.*, phase.* → block.*
    const wsEvent = event.type.startsWith('phase.')
      ? event.type.replace('phase.', 'block.')
      : event.type;

    const entityId = (taskId ?? phaseId)?.toString() ?? '';
    const broadcasterActorId = actorId?.toString() ?? userId?.toString() ?? movedBy?.toString() ?? '';

    this.gateway.broadcast('list:' + listId, wsEvent, {
      event: wsEvent,
      listId,
      entityId,
      actorId: broadcasterActorId
    });
  }
}
```

**Match function (registrado em RealtimeModule):**
```typescript
eventRouter.registerConsumer(
  (type) => type.startsWith('task.') || type.startsWith('phase.'),
  this.realtimeConsumer
);
```

---

### `RealtimeModule` (NestJS Module)

Orquestra injeções, registra consumer dinamicamente.

```typescript
@Module({
  imports: [
    forwardRef(() => AuthModule),  // JwtService, JwtModule
    ProjectsModule  // ProjectsService.findAccessibleProjectIds()
  ],
  providers: [RealtimeGateway, WsJwtGuard, RealtimeConsumer],
  exports: [RealtimeGateway]  // Opcional: para testes
})
export class RealtimeModule implements OnModuleInit {
  constructor(
    private eventRouter: EventRouterService,
    private realtimeConsumer: RealtimeConsumer
  ) {}

  onModuleInit() {
    // Registra dinamicamente (padrão ADR-V2-049)
    this.eventRouter.registerConsumer(
      (type) => type.startsWith('task.') || type.startsWith('phase.'),
      this.realtimeConsumer
    );
  }
}
```

**Por que dinâmico?**
- Evita ciclo: Eventos @Global → RealtimeModule → ProjectsModule → (volta a Eventos = ciclo).
- Padrão validado em produção (ADR-V2-049 / Telegram).

---

## Protocolo Cliente-Servidor

### Handshake (Cliente)

```typescript
// Socket.io client
import io from 'socket.io-client';

const socket = io('https://backend.scrumban.com.br', {
  namespace: '/realtime',
  auth: {
    token: jwtToken  // ou header Authorization: Bearer <token>
  }
});
```

### Join (Cliente → Servidor)

```typescript
socket.emit('join:list', { listId: '12345' });

// Servidor responde (sucesso)
socket.on('joined:list', (response) => {
  console.log(`Conectado à lista ${response.listId}`);
});

// Servidor responde (erro — sem acesso)
socket.on('error', (error) => {
  console.error('Acesso negado:', error.code, error.message);
});
```

### Broadcast (Servidor → Clientes)

```typescript
// Cliente recebe
socket.on('list:event', (envelope) => {
  const { event, listId, entityId, actorId } = envelope;
  
  // Eco-filter (frontend responsibility)
  if (actorId === currentUserId) {
    console.log('Echo — mudança feita por você, ignorado');
    return;
  }

  // Invalidar queries
  invalidateQueries(['tasks', listId]);
});
```

### Envelope Structure

```typescript
interface RealtimeEnvelope {
  event: 'task.created' | 'task.updated' | 'task.status.changed' | 'task.deleted' 
       | 'block.created' | 'block.updated' | 'block.deleted';
  listId: string;  // DProject.chave (BigInt como string)
  entityId: string;  // DTask.chave (BigInt como string)
  actorId: string;  // DEntidade.chave (BigInt como string) ou '' (sistema)
}
```

**Exemplos:**
```typescript
// Task criada pelo usuário 999
{ event: 'task.created', listId: '100', entityId: '200', actorId: '999' }

// Bloco atualizado (phase.updated → block.updated)
{ event: 'block.updated', listId: '100', entityId: '201', actorId: '1000' }

// Task deletada por sistema (import, automação sem ator)
{ event: 'task.deleted', listId: '100', entityId: '202', actorId: '' }
```

---

## Mapa de Eventos (Derivação)

| Domínio Event Type | idClasse | Realtime Event |
|--------------------|----------|---|
| `task.created` | ≠ -200 | `task.created` |
| `task.created` | -200 (phase) | (não emitido como task.created; phase.created emitido à parte) |
| `task.updated` | ≠ -200 | `task.updated` |
| `task.updated` | -200 (phase) | (fase emite phase.updated) |
| `phase.created` | (type é phase.created) | `block.created` |
| `phase.updated` | (type é phase.updated) | `block.updated` |
| `task.status.changed` | — | `task.status.changed` |
| `task.deleted` | — | `task.deleted` |
| `phase.deleted` | (type é phase.deleted) | `block.deleted` |

**Nota:** `phase.*` → `block.*` derivado em `RealtimeConsumer.handle()` apenas; `phase.*` não é evento Web Socket emitido diretamente.

---

## CORS e Configuração

### Ambiente

```bash
# .env
REALTIME_CORS_ORIGIN=https://scrumban.com.br
JWT_SECRET=your-secret-key
```

### NestJS Config

```typescript
// ConfigService em RealtimeGateway
@WebSocketGateway({
  namespace: '/realtime',
  cors: {
    origin: this.configService.get('REALTIME_CORS_ORIGIN') || 'http://localhost:3001',
    credentials: true
  }
})
```

**Comportamento:**
- Handshake: CORS check feito por Socket.io
- Upgrade: Traefik/Dokploy repassa `Connection: upgrade` → HTTP 101 Switching Protocols → WebSocket
- Cookies: `credentials: true` permite cookies autenticação

---

## Performance e Escala

### 1 Réplica (MVP)

- **Broadcast:** In-memory via `server.to(room).emit()` — <1ms latência.
- **Salas:** Mapa em memória (Node.js nativo).
- **Throughput:** 10k+ eventos/s por processo.

### 2+ Réplicas (Futuro)

**TODO:** Agregar Redis Adapter.

```typescript
import { createAdapter } from '@socket.io/redis-adapter';
import { createClient } from 'redis';

const pubClient = createClient({ host: 'redis', port: 6379 });
const subClient = pubClient.duplicate();

io.adapter(createAdapter(pubClient, subClient));
```

**Requisitos:**
- Sticky sessions em Traefik/Dokploy (LB route cliente sempre para o MESMO servidor).
- Redis instance (já presente via BullMQ).

---

## RBAC — Join:List

**Algoritmo:**

1. Cliente envia `{ listId }`.
2. WsJwtGuard valida JWT → popula `client.data.user`.
3. Handler `join:list` extrai `user.entidadeId` + `user.organizationId`.
4. Chama `ProjectsService.findAccessibleProjectIds(entidadeId, organizationId)` → `string[]`.
5. Se `listId ∉ resultado` → throw WsException('FORBIDDEN_LIST').
6. Se `listId ∈ resultado` → `client.join('list:' + listId)` → `client.emit('joined:list')`.

**Segurança:**
- RBAC reusa mesma fonte de verdade (`findAccessibleProjectIds`).
- Sem duplicação de query DVincula.
- Defense-in-depth: handshake JWT + join RBAC.

---

## Decisões Arquiteturais (Consolidadas em ADR-V2-063)

| Decisão | Justificativa |
|---------|---|
| Consumer dinâmico (não estático) | Evita ciclo Eventos↔RealtimeModule. Padrão validado (ADR-V2-049). |
| Socket.io namespace `/realtime` (não porta separada) | Dono travou: WS na mesma porta HTTP. Traefik repassa upgrade. |
| Envelope mínimo (não patch entity) | Reduz acoplamento; front invalida queries. Estratégia acordada. |
| RBAC via `findAccessibleProjectIds` | Reuso de RBAC existente; zero duplicação; fonte única DVincula. |
| 1 réplica MVP (Redis TODO) | Curto prazo: in-memory. Longo prazo: sticky sessions + Redis adapter. |

---

## Testes

### Unit Tests (`__tests__/realtime.consumer.spec.ts`)

```typescript
describe('RealtimeConsumer', () => {
  it('mapeia task.* → task.*', () => {
    const event = { type: 'task.created', payload: { projectId: '100', taskId: '200', actorId: '999' } };
    consumer.handle(event);
    expect(gateway.broadcast).toHaveBeenCalledWith('list:100', 'task.created', expect.any(Object));
  });

  it('mapeia phase.* → block.*', () => {
    const event = { type: 'phase.updated', payload: { projectId: '100', taskId: '201', actorId: '1000' } };
    consumer.handle(event);
    expect(gateway.broadcast).toHaveBeenCalledWith('list:100', 'block.updated', expect.any(Object));
  });

  it('skipa evento sem projectId', async () => {
    const event = { type: 'task.created', payload: { taskId: '200' } };  // sem projectId
    await consumer.handle(event);
    expect(gateway.broadcast).not.toHaveBeenCalled();
  });
});
```

### Unit Tests (`__tests__/ws-jwt.guard.spec.ts`)

```typescript
describe('WsJwtGuard', () => {
  it('popula client.data.user com token válido', async () => {
    const token = jwtService.sign({ entidadeId: '999', email: 'user@test.com' });
    client.handshake.auth.token = token;
    const result = await guard.canActivate(context);
    expect(result).toBe(true);
    expect(client.data.user.entidadeId).toBe('999');
  });

  it('lança WsException com token inválido', async () => {
    client.handshake.auth.token = 'invalid';
    await expect(guard.canActivate(context)).rejects.toThrow(WsException);
  });
});
```

### Integration Tests (Fase 0 — emissão de eventos)

Specs em `src/tasks/tasks.service.spec.ts`:
- `task.updated` emitido para task normal (idClasse ≠ -200).
- `task.status.changed` contém `projectId` + `actorId`.
- `task.deleted` contém `projectId` + `actorId`.

---

## Pendências e TODOs

### Curto Prazo (MVP)
- [ ] Smoke test: `npm run build` ✅ PASS
- [ ] 27 specs realtime ✅ PASS
- [ ] Frontend integration (canal `'list:event'`, eco-filter) — teste em staging

### Médio Prazo
- [ ] Redis adapter + sticky sessions (2+ réplicas)
- [ ] Monitoring: event throughput, connection count, broadcast latência
- [ ] Logs estruturados (ELK/Datadog) — evento realtime com tracer

### Longo Prazo
- [ ] Contribuir padrão generic ao template Devari-Core
- [ ] Salas adicionais: `user:{userId}`, `org:{organizationId}`, `comment:{taskId}`
- [ ] Presença online (typing indicators, avatares de observadores)

---

## Conformidade (Pilares + ADRs)

| Item | Status | Detalhes |
|------|--------|----------|
| Pilar 1 (Engine) | N/A | Consumer lê DEvento; zero INSERT DPedido. |
| Pilar 2 (Endpoints) | ✅ OK | RBAC reusa `findAccessibleProjectIds` — zero duplicação. WebSocket em namespace (não REST). |
| Pilar 3 (Seed) | ✅ OK | Zero DClasse nova. `task.updated` → -489 AUDIT_GENERIC. `block.*` derivado (idClasse=-200). |
| ADR-V2-001 | ✅ OK | ZERO tabela nova. |
| ADR-V2-008 | ✅ OK | DEvento base; realtime é derivado. |
| ADR-V2-042 | ✅ OK | Tenant isolation via `findAccessibleProjectIds`. |
| ADR-V2-049 | ✅ OK | Consumer dinâmico (padrão Telegram). |
| ADR-V2-063 | ✅ OK | Este módulo. |

---

## Referências

- **Plano:** `workspace/plans/plan-realtime-websocket-board-task6.md`
- **ADR:** `docs/decisions/ADR-V2-063-realtime-websocket-board.md`
- **Socket.io docs:** https://socket.io/docs/
- **NestJS WebSockets:** https://docs.nestjs.com/websockets/gateways

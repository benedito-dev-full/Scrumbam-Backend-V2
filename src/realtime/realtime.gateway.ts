import { Logger, UseGuards } from '@nestjs/common';
import {
  MessageBody,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { JwtPayload } from '../auth/decorators/current-user.decorator';
import { ProjectsService } from '../projects/projects.service';
import { JoinListDto } from './dto/join-list.dto';
import { WsJwtGuard } from './ws-jwt.guard';

/*
 * TODO (escala — decisão do dono, NÃO implementar agora):
 *   1 réplica  → adapter in-memory padrão do Socket.io (estado atual).
 *   2+ réplicas → @socket.io/redis-adapter (ioredis já presente via BullMQ)
 *                 + sticky sessions no Traefik para o upgrade WS.
 */

/**
 * Origin do CORS do canal WebSocket.
 *
 * As opções de `@WebSocketGateway` são avaliadas no momento da DEFINIÇÃO da
 * classe (decorator estático), ANTES de o DI container existir — logo não há
 * `ConfigService` disponível aqui. Por isso lemos `process.env` diretamente,
 * com `https://scrumban.com.br` como default (decisão do dono). Continua
 * configurável por env (`REALTIME_CORS_ORIGIN`), apenas resolvido em tempo de
 * import em vez de via DI. `credentials: true` para permitir cookies/headers.
 */
const REALTIME_CORS_ORIGIN = process.env.REALTIME_CORS_ORIGIN ?? 'https://scrumban.com.br';

/**
 * Gateway WebSocket do board em tempo real (namespace `/realtime`).
 *
 * Sobe na MESMA porta/host do HTTP NestJS (Traefik/Dokploy repassa o upgrade)
 * — sem porta extra. Todo handshake passa pelo {@link WsJwtGuard} (JWT do
 * AuthModule).
 *
 * Protocolo:
 * - `join:list { listId }` → valida RBAC via
 *   {@link ProjectsService.findAccessibleProjectIds} (NÃO duplica DVincula);
 *   entra na sala `list:{listId}` e emite `joined:list`. Sem acesso →
 *   `error { code: 'FORBIDDEN_LIST' }` e NÃO entra.
 * - `leave:list { listId }` → sai da sala.
 * - Saída (servidor → cliente): canal ÚNICO `list:event` com envelope
 *   `{ event, listId, entityId, actorId }`, emitido por {@link broadcast}.
 *
 * Regra de ouro: este gateway NUNCA é injetado em TasksService/ProjectsService.
 * O fluxo é `TasksService → EventProducer → RealtimeConsumer → broadcast`
 * (consumer/wiring são Fase 2). Aqui o gateway apenas USA ProjectsService.
 */
@WebSocketGateway({
  namespace: '/realtime',
  cors: { origin: REALTIME_CORS_ORIGIN, credentials: true },
})
@UseGuards(WsJwtGuard)
export class RealtimeGateway {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  server!: Server;

  constructor(private readonly projectsService: ProjectsService) {}

  /**
   * Assina o cliente à sala de uma lista (DProject) após validar RBAC.
   *
   * O JWT já foi validado pelo {@link WsJwtGuard} (`client.data.user`). O
   * acesso à lista reusa {@link ProjectsService.findAccessibleProjectIds}
   * (uma única query de RBAC — sem N+1).
   *
   * @param client - Socket conectado e autenticado.
   * @param payload - `{ listId }` (chave do DProject).
   */
  @SubscribeMessage('join:list')
  async handleJoinList(client: Socket, @MessageBody() payload: JoinListDto): Promise<void> {
    const listId = payload?.listId;
    if (typeof listId !== 'string' || listId.length === 0) {
      client.emit('error', { code: 'INVALID_PAYLOAD', message: 'listId obrigatório' });
      return;
    }

    const user = client.data.user as JwtPayload | undefined;
    if (!user?.entidadeId) {
      client.emit('error', { code: 'UNAUTHORIZED' });
      return;
    }

    const accessibleIds = await this.projectsService.findAccessibleProjectIds(
      BigInt(user.entidadeId),
      user.organizationId,
    );

    if (!accessibleIds.includes(listId)) {
      this.logger.debug(`join:list negado entidadeId=${user.entidadeId} listId=${listId}`);
      client.emit('error', { code: 'FORBIDDEN_LIST', listId });
      return;
    }

    await client.join(`list:${listId}`);
    client.emit('joined:list', { listId });
    this.logger.debug(`join:list OK entidadeId=${user.entidadeId} listId=${listId}`);
  }

  /**
   * Remove o cliente da sala de uma lista.
   *
   * @param client - Socket conectado.
   * @param payload - `{ listId }` (chave do DProject).
   */
  @SubscribeMessage('leave:list')
  async handleLeaveList(client: Socket, @MessageBody() payload: JoinListDto): Promise<void> {
    const listId = payload?.listId;
    if (typeof listId !== 'string' || listId.length === 0) {
      return;
    }
    await client.leave(`list:${listId}`);
    client.emit('left:list', { listId });
  }

  /**
   * Transmite um envelope mínimo para todos os clientes de uma sala.
   *
   * Estratégia "avisar para invalidar": o servidor NÃO envia o patch da
   * entidade — só o envelope `{ event, listId, entityId, actorId }` no canal
   * único `list:event`. O front dispara `invalidateQueries`.
   *
   * Chamado pelo `RealtimeConsumer` (Fase 2) após persistência.
   *
   * @param room - Sala destino (ex.: `list:12345`).
   * @param event - Tipo do evento WS (ex.: `task.updated`).
   * @param payload - `{ listId, entityId, actorId }`.
   */
  broadcast(
    room: string,
    event: string,
    payload: { listId: string; entityId: string; actorId: string },
  ): void {
    this.server.to(room).emit('list:event', { event, ...payload });
  }
}

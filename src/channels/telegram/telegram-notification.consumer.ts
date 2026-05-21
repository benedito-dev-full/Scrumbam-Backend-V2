import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { AccountLinkService } from '../core/account-link.service';
import { TelegramSendService } from './telegram-send.service';
import { EventRouterService } from '../../eventos/core/event-router.service';
import type { IEvent } from '../../eventos/interfaces/event.interface';
import type { IEventConsumer } from '../../eventos/interfaces/consumer.interface';

/**
 * idClasse `DEvento -494 TELEGRAM_MSG_OUT` (seed F1) — reutilizada para
 * idempotência de notificações Telegram outbound (ADR-V2-049, F9c).
 * Mesma DClasse usada por `audit-log.consumer` para `telegram.message.out`;
 * idempotência funciona via `identificadorExterno` único por destinatário+evento.
 */
const TELEGRAM_MSG_OUT_CLASSE = BigInt(-494);

/**
 * Channel name canônico do canal Telegram (key em `DVincula.metaDados.channelName`).
 */
const CHANNEL_NAME = 'telegram';

/**
 * Timeout máximo para chamada de `telegram.sendMessage` (ms).
 * Risco RISCO #4 do plano F9c: API Telegram lenta poderia travar o pipeline
 * `EventRouterService` (em-process síncrono). Usamos `Promise.race` com este
 * limite. ADR-V2-049 documenta a decisão.
 */
const SEND_TIMEOUT_MS = 3000;

/**
 * Idempotência: prefixo + sufixo do `identificadorExterno`. Mesmo destinatário
 * + mesmo evento (mesmo correlationId) → mesma chave → não envia duas vezes.
 */
function buildIdentifier(event: IEvent, recipientId: bigint): string {
  return `${event.correlationId}:${event.type}:${recipientId.toString()}`;
}

/**
 * Resultado da emissão por destinatário (gravado em `DEvento -494.metaDados`).
 */
interface SendOutcome {
  recipientId: bigint;
  identifier: string;
  chatId: bigint | null;
  success: boolean;
  error?: string;
}

/**
 * Consumer que reage a eventos de domínio (atualmente `phase.completed`)
 * notificando o canal Telegram dos destinatários elegíveis.
 *
 * ADR-V2-049 (F9c, ADR-V2-047) — pattern "um consumer por canal externo de
 * saída". Replicável para WhatsApp/Slack futuros sem refactor.
 *
 * **Trigger v1:** `phase.completed`. Lista governada por
 * `notification-triggers.const.ts` (F9c também adiciona `phase.completed`
 * ao NotificationConsumer in-app por simetria). Este consumer é invocado
 * em paralelo com `audit-log` e `webhook` via `EventProducerService`.
 *
 * **Destinatários v1:** `idCreator` da fase + assignees diretos das
 * tasks-folha descendentes (dedup, intersect com membros da org via
 * `DVincula` org-membership). Não inclui ADMINs da org (decisão consciente
 * para evitar spam — documentada no ADR-V2-049).
 *
 * **Idempotência:**
 *  - Antes de qualquer envio, query batch em `DEvento -494` por
 *    `identificadorExterno IN (...)`; skip dos já enviados.
 *  - Após cada tentativa (sucesso/falha/skip), persiste 1 `DEvento -494`
 *    por destinatário com `metaDados.success` + opcional `metaDados.error`.
 *
 * **Token ausente** (`TELEGRAM_BOT_TOKEN` undefined): consumer NÃO chama
 * `sendMessage` — segue o pattern `telegram-send.service.ts:49-52` e faz
 * skip silencioso (log warn). Persiste DEvento com `error='token_missing'`
 * para auditoria (operador pode rastrear notificações perdidas).
 *
 * **Timeout 3s no sendMessage:** Promise.race contra timer. Timeout = log
 * warn + DEvento com `error='timeout'`. NÃO propaga para o router (consumers
 * não devem matar o pipeline).
 *
 * **Tenant scope:** `idEstab` da fase é resolvido junto com idCreator no
 * findUnique; recipients fora da mesma org são filtrados via query
 * `DVincula` de org-membership (`idLocEscritu=idEstab AND idEntidade IN ...`).
 *
 * F9c é puramente reativo — NÃO emite eventos novos (evita loop).
 *
 * @see TelegramSendService — envio HTTP nativo via fetch
 * @see AccountLinkService.findChatByUser — query inversa para resolver chatId
 * @see EventRouterService — invoca este consumer quando type === 'phase.completed'
 */
@Injectable()
export class TelegramNotificationConsumer implements IEventConsumer, OnModuleInit {
  readonly name = 'telegram-notification';
  private readonly logger = new Logger(TelegramNotificationConsumer.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly accountLink: AccountLinkService,
    private readonly telegramSend: TelegramSendService,
    private readonly configService: ConfigService,
    private readonly eventRouter: EventRouterService,
  ) {}

  /**
   * Auto-registra este consumer no `EventRouterService` para os eventos
   * elegíveis. Usar OnModuleInit ao invés de injetá-lo direto no router
   * mantém o `EventosModule` desacoplado do `ChannelsModule` (ADR-V2-049).
   */
  onModuleInit(): void {
    this.eventRouter.registerConsumer((type) => type === 'phase.completed', this);
    this.logger.log('TelegramNotificationConsumer registered for phase.completed');
  }

  /**
   * Processa um evento. Despacha por tipo (v1: só `phase.completed`).
   *
   * Falha aqui NÃO derruba os demais consumers (regra do `EventProducerService` —
   * Promise.allSettled). Mesmo assim, todo o fluxo é envolvido em try/catch
   * defensivo: erros internos viram log + DEvento -494 com `error`.
   *
   * @param event - Evento canônico V2.
   */
  async handle(event: IEvent): Promise<void> {
    if (event.type !== 'phase.completed') {
      this.logger.debug(
        `telegram-notification skip: type=${event.type} correlationId=${event.correlationId}`,
      );
      return;
    }

    try {
      await this.handlePhaseCompleted(event);
    } catch (err) {
      // Defensivo — não relança para preservar o pipeline.
      this.logger.error(
        `telegram-notification erro inesperado correlationId=${event.correlationId}: ` +
          (err instanceof Error ? err.message : String(err)),
      );
    }
  }

  // ─── Handlers por tipo ───────────────────────────────────────────────────

  /**
   * Pipeline para `phase.completed`:
   *  1. Resolver destinatários (creator + assignees diretos das folhas).
   *  2. Filtrar por org (tenant scope).
   *  3. Checar idempotência (DEvento -494 prévios).
   *  4. Resolver chatId batch (Promise.all em findChatByUser).
   *  5. Enviar com timeout 3s.
   *  6. Persistir DEvento -494 por destinatário.
   */
  private async handlePhaseCompleted(event: IEvent): Promise<void> {
    const phaseIdStr = event.payload.phaseId;
    if (typeof phaseIdStr !== 'string' || !/^-?\d+$/.test(phaseIdStr)) {
      this.logger.warn(`phase.completed sem phaseId válido correlationId=${event.correlationId}`);
      return;
    }
    const phaseId = BigInt(phaseIdStr);

    // 1. Resolver fase + criador + projeto (1 query)
    const phase = await this.prisma.dTask.findUnique({
      where: { chave: phaseId },
      select: {
        chave: true,
        nome: true,
        idCreator: true,
        idProject: true,
        project: { select: { chave: true, idEstab: true, nome: true } },
      },
    });

    if (!phase || !phase.project) {
      this.logger.warn(
        `phase.completed: fase ${phaseIdStr} não encontrada correlationId=${event.correlationId}`,
      );
      return;
    }

    // 2. Resolver assignees das tasks-folha filhas DIRETAS (1 query — sem N+1).
    //    Cobertura v1: apenas filhos diretos (não recursivo), conforme
    //    decisão Strategist (limita escopo e custo). Recursivo via descendentes
    //    fica como follow-up.
    const directChildren = await this.prisma.dTask.findMany({
      where: {
        idPai: phaseId,
        idProject: phase.idProject,
        excluido: false,
      },
      select: { idAssignee: true },
    });

    const recipients = new Set<bigint>();
    if (phase.idCreator) recipients.add(phase.idCreator);
    for (const t of directChildren) {
      if (t.idAssignee) recipients.add(t.idAssignee);
    }

    if (recipients.size === 0) {
      this.logger.debug(
        `phase.completed sem destinatários phaseId=${phaseIdStr} correlationId=${event.correlationId}`,
      );
      return;
    }

    // 3. Tenant filter — intersect com membros da org via DVincula (1 query).
    //    Aceita qualquer DVincula idLocEscritu=idEstab que aponte para
    //    o destinatário (qualquer role: ADMIN/MEMBER). Defense-in-depth.
    let inOrgRecipients: bigint[];
    if (phase.project.idEstab) {
      const memberships = await this.prisma.dVincula.findMany({
        where: {
          idLocEscritu: phase.project.idEstab,
          idEntidade: { in: [...recipients] },
          excluido: false,
        },
        select: { idEntidade: true },
      });
      const allowedSet = new Set(memberships.map((m) => m.idEntidade?.toString()).filter(Boolean));
      inOrgRecipients = [...recipients].filter((r) => allowedSet.has(r.toString()));
    } else {
      inOrgRecipients = [...recipients];
    }

    if (inOrgRecipients.length === 0) {
      this.logger.debug(
        `phase.completed nenhum destinatário na org correlationId=${event.correlationId}`,
      );
      return;
    }

    // 4. Idempotência batch — 1 query (DEvento -494 existing)
    const identifiers = inOrgRecipients.map((r) => buildIdentifier(event, r));
    const existing = await this.prisma.dEvento.findMany({
      where: {
        idClasse: TELEGRAM_MSG_OUT_CLASSE,
        excluido: false,
        identificadorExterno: { in: identifiers },
      },
      select: { identificadorExterno: true },
    });
    const sent = new Set(
      existing.map((e) => e.identificadorExterno).filter((s): s is string => typeof s === 'string'),
    );

    const pending = inOrgRecipients.filter((r) => !sent.has(buildIdentifier(event, r)));

    if (pending.length === 0) {
      this.logger.debug(
        `phase.completed idempotent skip phaseId=${phaseIdStr} correlationId=${event.correlationId}`,
      );
      return;
    }

    // 5. Resolver chatIds em paralelo (Promise.all — N queries simples,
    //    sem N+1 do ponto de vista do pipeline; cada uma é findFirst).
    const chatPairs = await Promise.all(
      pending.map(async (recipientId) => {
        const chatId = await this.accountLink.findChatByUser(CHANNEL_NAME, recipientId);
        return { recipientId, chatId };
      }),
    );

    // 6. Token check — se ausente, skip + DEvento com error='token_missing'
    const token = this.configService.get<string>('TELEGRAM_BOT_TOKEN');
    if (!token) {
      this.logger.warn(
        `phase.completed: TELEGRAM_BOT_TOKEN ausente — skip envio ` +
          `(correlationId=${event.correlationId}, recipients=${pending.length})`,
      );
      const outcomes: SendOutcome[] = chatPairs.map(({ recipientId, chatId }) => ({
        recipientId,
        identifier: buildIdentifier(event, recipientId),
        chatId,
        success: false,
        error: 'token_missing',
      }));
      await this.persistOutcomes(event, phase.nome, phase.project.nome, outcomes);
      return;
    }

    // 7. Enviar com timeout — montagem da mensagem markdown
    const message = this.buildMessage(
      phase.nome ?? `Fase ${phaseId}`,
      phase.project.nome ?? `Projeto ${phase.idProject?.toString()}`,
      Number(event.payload.total ?? 0),
      phase.idProject?.toString() ?? null,
      phaseIdStr,
    );

    const outcomes: SendOutcome[] = await Promise.all(
      chatPairs.map(async ({ recipientId, chatId }) => {
        const identifier = buildIdentifier(event, recipientId);
        if (!chatId) {
          return { recipientId, identifier, chatId: null, success: false, error: 'no_chat_link' };
        }

        try {
          await this.sendWithTimeout(chatId, message);
          return { recipientId, identifier, chatId, success: true };
        } catch (err) {
          const errMsg = err instanceof Error ? err.message : String(err);
          // log warn (NÃO error) — falha de canal externo não derruba pipeline
          this.logger.warn(
            `phase.completed sendMessage falhou chatId=${chatId} recipient=${recipientId}: ${errMsg}`,
          );
          // Marcar timeout especificamente para auditoria
          const isTimeout = errMsg.startsWith('timeout');
          return {
            recipientId,
            identifier,
            chatId,
            success: false,
            error: isTimeout ? 'timeout' : errMsg.slice(0, 200),
          };
        }
      }),
    );

    // 8. Persistir DEvento -494 por destinatário (1 createMany)
    await this.persistOutcomes(event, phase.nome, phase.project.nome, outcomes);

    const successCount = outcomes.filter((o) => o.success).length;
    this.logger.log(
      `phase.completed telegram enviado: ${successCount}/${outcomes.length} ` +
        `phaseId=${phaseIdStr} correlationId=${event.correlationId}`,
    );
  }

  // ─── Helpers ─────────────────────────────────────────────────────────────

  /**
   * Envia mensagem com timeout via `Promise.race`. Timeout NÃO propaga —
   * caller (`handlePhaseCompleted`) captura e converte em DEvento com
   * `metaDados.error='timeout'`.
   */
  private async sendWithTimeout(chatId: bigint, text: string): Promise<void> {
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      setTimeout(() => reject(new Error(`timeout after ${SEND_TIMEOUT_MS}ms`)), SEND_TIMEOUT_MS);
    });
    await Promise.race([this.telegramSend.sendMessage(chatId, text), timeoutPromise]);
  }

  /**
   * Monta mensagem markdown da notificação.
   * Link opcional via `FRONTEND_BASE_URL` env. Se ausente, omite link.
   */
  private buildMessage(
    phaseName: string,
    projectName: string,
    total: number,
    projectId: string | null,
    phaseId: string,
  ): string {
    const baseUrl = this.configService.get<string>('FRONTEND_BASE_URL');
    const link =
      baseUrl && projectId
        ? `\n\n[ver fase no Scrumban](${baseUrl}/projects/${projectId}/phases/${phaseId})`
        : '';

    return (
      `*Fase concluida*\n\n` +
      `"${phaseName}" — 100% das tasks concluidas\n` +
      `Projeto: ${projectName}\n` +
      `Total: ${total} task(s)` +
      link
    );
  }

  /**
   * Persiste 1 `DEvento -494` por destinatário (sucesso/falha/skip).
   * Usa `createMany` (1 query) — sem N+1 mesmo com 100 destinatários.
   */
  private async persistOutcomes(
    event: IEvent,
    phaseName: string | null,
    projectName: string | null,
    outcomes: SendOutcome[],
  ): Promise<void> {
    if (outcomes.length === 0) return;

    const data: Prisma.DEventoCreateManyInput[] = outcomes.map((o) => ({
      idClasse: TELEGRAM_MSG_OUT_CLASSE,
      idEntidade: o.recipientId,
      identificadorExterno: o.identifier,
      descricao: `Notificacao phase.completed (chat=${o.chatId?.toString() ?? 'none'})`,
      metaDados: {
        eventType: event.type,
        channelName: CHANNEL_NAME,
        success: o.success,
        ...(o.error && { error: o.error }),
        ...(o.chatId !== null && { chatId: o.chatId.toString() }),
        ...(phaseName && { phaseName }),
        ...(projectName && { projectName }),
        _meta: {
          sourceEventCorrelationId: event.correlationId,
          createdBy: 'TelegramNotificationConsumer',
        },
      } as Prisma.InputJsonValue,
    }));

    await this.prisma.dEvento.createMany({ data });
  }
}

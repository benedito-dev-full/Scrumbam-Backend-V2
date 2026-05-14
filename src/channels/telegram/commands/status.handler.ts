import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import { CommandHandler, CommandRegistryService } from '../../core/command-registry.service';
import { TasksService } from '../../../tasks/tasks.service';
import { ProjectsService } from '../../../projects/projects.service';

/**
 * Handler do comando `/status` do Telegram.
 *
 * Exibe informações de saúde do pareamento e uma contagem útil de tarefas.
 *
 * Informações exibidas:
 * - Confirmação de que o canal está pareado (se chegou aqui, está)
 * - Contagem de tarefas ativas (INBOX + READY) do usuário
 * - Contagem de tarefas em execução (EXECUTING)
 *
 * **ADR-V2-042**: cross-org by design — resolve `accessibleProjectIds` SEM
 * `organizationId` (Telegram nao tem orgId ativo).
 *
 * `userId` é `DEntidade.chave` — garantido pelo router antes de chegar aqui.
 *
 * @see TasksService — contagem de tarefas sem duplicar lógica
 * @see PrismaService — busca de informações de vínculo
 */
@Injectable()
export class StatusHandler implements OnModuleInit, CommandHandler {
  private readonly logger = new Logger(StatusHandler.name);

  /** Nome do comando sem barra — usado pelo `CommandRegistryService`. */
  readonly commandName = 'status';

  /** idClasse do DVincula para vínculo canal↔usuário. */
  private static readonly CHANNEL_LINK_CLASS = BigInt(-483);

  constructor(
    private readonly commandRegistry: CommandRegistryService,
    private readonly tasksService: TasksService,
    private readonly projectsService: ProjectsService,
    private readonly prisma: PrismaService,
  ) {}

  /** Autorregistra este handler no registry ao inicializar o módulo. */
  onModuleInit(): void {
    this.commandRegistry.register(this);
    this.logger.log('StatusHandler registrado');
  }

  /**
   * Retorna status de saúde do pareamento e contagem de tarefas.
   *
   * Executa queries em paralelo (Promise.all) — sem N+1.
   *
   * @param chatId - ID do chat Telegram (BigInt)
   * @param userId - DEntidade.chave do usuário (BigInt) — já resolvido pelo router
   * @param _args - Argumentos ignorados
   * @returns Texto com status do pareamento e contagem de tarefas
   */
  async handle(chatId: bigint, userId: bigint, _args: string[]): Promise<string> {
    this.logger.debug(`/status recebido de chatId=${chatId} userId=${userId}`);

    try {
      // ADR-V2-042: Telegram cross-org — sem orgId, retorna todos os projetos.
      const accessibleProjectIds = await this.projectsService.findAccessibleProjectIds(userId);

      // 2 queries em paralelo — sem N+1
      const [inboxResult, executingResult] = await Promise.all([
        this.tasksService.findMany(
          {
            assigneeId: userId.toString(),
            status: 'INBOX',
            limit: 1,
          },
          accessibleProjectIds,
        ),
        this.tasksService.findMany(
          {
            assigneeId: userId.toString(),
            status: 'EXECUTING',
            limit: 1,
          },
          accessibleProjectIds,
        ),
      ]);

      // Buscar vínculo de canal para mostrar data de vinculação
      const link = await this.prisma.dVincula.findFirst({
        where: {
          idClasse: StatusHandler.CHANNEL_LINK_CLASS,
          idLocEscritu: userId,
          excluido: false,
        },
        select: { metaDados: true },
      });

      const meta = link?.metaDados as Record<string, unknown> | null;
      const linkedAt = meta?.linkedAt as string | undefined;
      const linkedAtStr = linkedAt
        ? new Date(linkedAt).toLocaleDateString('pt-BR')
        : 'data desconhecida';

      const inboxCount = inboxResult.pagination.hasMore ? '100+' : String(inboxResult.items.length);
      const executingCount = executingResult.pagination.hasMore
        ? '100+'
        : String(executingResult.items.length);

      return (
        `✅ *Canal Telegram pareado*\n` +
        `📅 Vinculado em: ${linkedAtStr}\n\n` +
        `*Suas tarefas:*\n` +
        `📥 Backlog (INBOX): ${inboxCount}\n` +
        `⚡ Em execução: ${executingCount}\n\n` +
        `Use \`/tasks\` para ver a lista completa ou \`/create <título>\` para criar uma nova tarefa.`
      );
    } catch (error) {
      this.logger.error(
        `Erro ao buscar status para userId=${userId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return `❌ Não foi possível carregar o status. Tente novamente em instantes.`;
    }
  }
}

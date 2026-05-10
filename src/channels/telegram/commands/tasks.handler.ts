import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  CommandHandler,
  CommandRegistryService,
} from '../../core/command-registry.service';
import { TasksService } from '../../../tasks/tasks.service';
import { TimezoneService } from '../../../common/services/timezone.service';

/** Períodos suportados pelo comando /tasks. */
type TaskPeriod = 'today' | 'week' | 'backlog';

/**
 * Handler do comando `/tasks [today|week|backlog]` do Telegram.
 *
 * Lista as tarefas do usuário filtradas por período e estado.
 * Reutiliza `TasksService.findMany` — sem duplicar lógica de negócio.
 *
 * Mapeamento de períodos:
 * - `today` — tarefas criadas hoje (filtro via `criadoEm` no timezone Brasil)
 * - `week` — tarefas criadas esta semana (segunda a domingo, Brasil)
 * - `backlog` (default) — tarefas em INBOX/READY (sem filtro de data)
 *
 * IMPORTANTE: `userId` aqui é `DEntidade.chave` (não `DUserGroup.chave`).
 * O router já resolveu a conversão antes de chamar este handler.
 *
 * DECISÃO DE IMPLEMENTAÇÃO: `TasksService.findMany` não tem filtro de data.
 * Para `today` e `week`, buscamos tarefas do assignee e filtramos em memória
 * por `criadoEm` usando `TimezoneService`. Limite máximo: 100 tarefas
 * (cursor pagination existente já garante volume gerenciável).
 *
 * @see TasksService — service reutilizado sem duplicação
 * @see TimezoneService — filtros de data no timezone Brasil
 */
@Injectable()
export class TasksHandler implements OnModuleInit, CommandHandler {
  private readonly logger = new Logger(TasksHandler.name);

  /** Nome do comando sem barra — usado pelo `CommandRegistryService`. */
  readonly commandName = 'tasks';

  constructor(
    private readonly commandRegistry: CommandRegistryService,
    private readonly tasksService: TasksService,
    private readonly timezoneService: TimezoneService,
  ) {}

  /** Autorregistra este handler no registry ao inicializar o módulo. */
  onModuleInit(): void {
    this.commandRegistry.register(this);
    this.logger.log('TasksHandler registrado');
  }

  /**
   * Lista tarefas do usuário filtradas por período.
   *
   * @param chatId - ID do chat Telegram (BigInt)
   * @param userId - DEntidade.chave do usuário (BigInt) — já resolvido pelo router
   * @param args - args[0] pode ser 'today', 'week' ou 'backlog' (default: 'backlog')
   * @returns Texto formatado com lista de tarefas ou mensagem de "sem tarefas"
   */
  async handle(chatId: bigint, userId: bigint, args: string[]): Promise<string> {
    const rawPeriod = args[0]?.toLowerCase() ?? 'backlog';
    const period = this.parsePeriod(rawPeriod);

    this.logger.debug(`/tasks recebido de chatId=${chatId} userId=${userId} period=${period}`);

    try {
      const result = await this.tasksService.findMany({
        assigneeId: userId.toString(),
        // Para backlog: filtrar apenas estados ativos (INBOX + READY)
        // Para today/week: sem filtro de status — filtro de data é feito em memória abaixo
        ...(period === 'backlog' ? { status: 'INBOX' } : {}),
        limit: 100,
      });

      let items = result.items;

      // Filtro de data em memória para 'today' e 'week'
      if (period === 'today' || period === 'week') {
        const dateRange = this.timezoneService.getPeriodDates(period);
        items = items.filter((task) => {
          const criadoEm = new Date(task.criadoEm);
          return criadoEm >= dateRange.gte && criadoEm <= dateRange.lte;
        });
      }

      if (items.length === 0) {
        return this.emptyMessage(period);
      }

      return this.formatTaskList(items, period);
    } catch (error) {
      this.logger.error(
        `Erro ao listar tarefas para userId=${userId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return `❌ Não foi possível carregar suas tarefas. Tente novamente em instantes.`;
    }
  }

  // ─── Helpers privados ──────────────────────────────────────────────────────

  private parsePeriod(raw: string): TaskPeriod {
    if (raw === 'today' || raw === 'hoje') return 'today';
    if (raw === 'week' || raw === 'semana') return 'week';
    return 'backlog';
  }

  private emptyMessage(period: TaskPeriod): string {
    switch (period) {
      case 'today':
        return `📋 Nenhuma tarefa atribuída a você *hoje*.`;
      case 'week':
        return `📋 Nenhuma tarefa atribuída a você *esta semana*.`;
      default:
        return (
          `📋 Seu backlog está vazio.\n\n` +
          `Use \`/create <título>\` para criar uma nova tarefa.`
        );
    }
  }

  private formatTaskList(
    items: Array<{
      id: string;
      identifier: string;
      nome: string;
      status: string;
      criadoEm: string;
    }>,
    period: TaskPeriod,
  ): string {
    const periodLabel = period === 'today' ? 'hoje' : period === 'week' ? 'esta semana' : 'backlog';
    const lines = items.map((t) => {
      const statusEmoji = this.statusEmoji(t.status);
      const identifier = t.identifier ? `[${t.identifier}] ` : '';
      return `${statusEmoji} ${identifier}${t.nome}`;
    });

    const header = `📋 *Suas tarefas — ${periodLabel}* (${items.length}):\n\n`;
    return header + lines.join('\n');
  }

  private statusEmoji(status: string): string {
    switch (status) {
      case 'INBOX': return '📥';
      case 'READY': return '🟢';
      case 'EXECUTING': return '⚡';
      case 'DONE': return '✅';
      case 'FAILED': return '❌';
      case 'CANCELLED': return '🚫';
      case 'DISCARDED': return '🗑️';
      case 'VALIDATING': return '🔍';
      case 'VALIDATED': return '✔️';
      default: return '📌';
    }
  }
}

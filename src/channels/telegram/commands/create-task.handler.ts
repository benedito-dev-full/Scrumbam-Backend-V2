import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../../prisma.service';
import {
  CommandHandler,
  CommandRegistryService,
} from '../../core/command-registry.service';
import { TasksService } from '../../../tasks/tasks.service';

/**
 * Handler do comando `/create <título>` do Telegram.
 *
 * Cria uma nova task no projeto padrão do usuário via `TasksService.create`.
 * Não duplica lógica de negócio — delega inteiramente ao TasksService.
 *
 * DECISÃO DE PROJETO: `TasksService.create` exige `projectId`. Este handler
 * busca o projeto mais recente associado ao usuário (como assignee ou criador)
 * via DProject para determinar o projeto padrão. Se nenhum projeto encontrado,
 * orienta o usuário a criar um projeto no painel web primeiro.
 *
 * `userId` é `DEntidade.chave` — garantido pelo router antes de chegar aqui.
 *
 * @see TasksService — criação de task com identifier atômico DEV-N
 * @see PrismaService — busca do projeto padrão (1 query)
 */
@Injectable()
export class CreateTaskHandler implements OnModuleInit, CommandHandler {
  private readonly logger = new Logger(CreateTaskHandler.name);

  /** Nome do comando sem barra — usado pelo `CommandRegistryService`. */
  readonly commandName = 'create';

  constructor(
    private readonly commandRegistry: CommandRegistryService,
    private readonly tasksService: TasksService,
    private readonly prisma: PrismaService,
  ) {}

  /** Autorregistra este handler no registry ao inicializar o módulo. */
  onModuleInit(): void {
    this.commandRegistry.register(this);
    this.logger.log('CreateTaskHandler registrado');
  }

  /**
   * Cria uma nova task com o título fornecido no projeto padrão do usuário.
   *
   * @param chatId - ID do chat Telegram (BigInt)
   * @param userId - DEntidade.chave do usuário (BigInt) — já resolvido pelo router
   * @param args - args join forma o título da task
   * @returns Confirmação de criação com identifier DEV-N ou mensagem de erro
   */
  async handle(chatId: bigint, userId: bigint, args: string[]): Promise<string> {
    this.logger.debug(`/create recebido de chatId=${chatId} userId=${userId}`);

    const titulo = args.join(' ').trim();

    if (!titulo || titulo.length < 3) {
      return (
        `❌ *Título muito curto.*\n\n` +
        `Uso: \`/create <título da tarefa>\`\n` +
        `Exemplo: \`/create Revisar documentação da API\``
      );
    }

    if (titulo.length > 512) {
      return `❌ Título muito longo (máximo: 512 caracteres). Encurte e tente novamente.`;
    }

    // Buscar o projeto mais recente onde o usuário é criador ou assignee
    const projectId = await this.resolveDefaultProjectId(userId);

    if (!projectId) {
      return (
        `❌ *Nenhum projeto encontrado.*\n\n` +
        `Para criar tarefas via Telegram, você precisa ter um projeto no Scrumban.\n` +
        `Acesse o painel web para criar um projeto primeiro.`
      );
    }

    try {
      const task = await this.tasksService.create(
        {
          nome: titulo,
          projectId: projectId.toString(),
          source: 'telegram',
          rawText: titulo,
          assigneeId: userId.toString(),
        },
        userId,
      );

      this.logger.log(
        `Task criada via Telegram: id=${task.id} identifier=${task.identifier} userId=${userId}`,
      );

      const identifier = task.identifier ? `[${task.identifier}] ` : '';
      return (
        `✅ *Tarefa criada!*\n\n` +
        `${identifier}${task.nome}\n` +
        `Status: 📥 INBOX`
      );
    } catch (error) {
      this.logger.error(
        `Erro ao criar task para userId=${userId}: ${(error as Error).message}`,
        (error as Error).stack,
      );
      return `❌ Não foi possível criar a tarefa. Tente novamente em instantes.`;
    }
  }

  // ─── Helpers privados ──────────────────────────────────────────────────────

  /**
   * Resolve o projeto padrão para o usuário buscando o mais recente
   * associado à sua organização (`idEstab = userId` ou primeiro disponível).
   *
   * NOTA: DProject não tem campo `idCreator` no schema V2. Buscamos o
   * projeto mais recente onde `idEstab` = DEntidade do usuário (org).
   * Se não encontrado por idEstab, retornamos o projeto mais recente
   * não excluído como fallback.
   *
   * 1 query — sem N+1.
   *
   * @param userId - DEntidade.chave do usuário
   * @returns chave BigInt do projeto padrão, ou null se não encontrado
   */
  private async resolveDefaultProjectId(userId: bigint): Promise<bigint | null> {
    // Primeiro: tentar projeto associado ao usuário via idEstab
    const projectByEstab = await this.prisma.dProject.findFirst({
      where: {
        excluido: false,
        idEstab: userId,
      },
      select: { chave: true },
      orderBy: { chave: 'desc' },
    });

    if (projectByEstab) {
      return projectByEstab.chave;
    }

    // Fallback: projeto mais recente não excluído (qualquer projeto disponível)
    const project = await this.prisma.dProject.findFirst({
      where: { excluido: false },
      select: { chave: true },
      orderBy: { chave: 'desc' },
    });

    return project?.chave ?? null;
  }
}

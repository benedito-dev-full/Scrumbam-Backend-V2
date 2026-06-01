import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { EventProducerService } from '../../eventos/core/event-producer.service';
import { CorrelationIdService } from '../../common/services/correlation-id.service';
import { ManualTimerSession } from '../schemas/task-dados.schema';
import {
  TaskTimerStateDto,
  TaskTimerUserTotalDto,
} from '../dto/task-timer-response.dto';

/**
 * Ação de timer suportada pelos endpoints `/tasks/:id/timer/*`.
 *
 * - `start` / `resume`: abrem uma sessão manual (idênticos na semântica de
 *   persistência; `resume` é um alias explícito para clareza de UI).
 * - `pause` / `stop`: fecham a sessão aberta do usuário (gravam `endedAt` +
 *   `durationMs` server-side). `stop` é "encerrei o trabalho agora".
 */
export type TimerAction = 'start' | 'pause' | 'resume' | 'stop';

/**
 * Resultado interno de uma mutação de timer.
 *
 * Carrega a chave da task e o array atualizado de sessões manuais para que o
 * `TasksService` consiga reconstruir o `TaskResponseDto` (incluindo o `timer`
 * agregado) sem reler a task do banco.
 */
export interface TimerMutationResult {
  taskChave: bigint;
  manualTimers: ManualTimerSession[];
}

/**
 * Serviço do timer manual de tempo por tarefa (ADR-V2-057).
 *
 * **Pilar 1 — Engine NÃO se aplica:** DTask é tabela estrutural. Toda a
 * persistência é Prisma direto (Edit em `dados.telemetry.manualTimers` Json).
 * O Engine (`OperacaoExecucaoClaude`) permanece exclusivo de DPedido
 * idClasse=-300..-303 (ADR-V2-005/006). O timer manual jamais cria DPedido.
 *
 * **Anti-fraude:** `userId` vem SEMPRE do JWT (`actorId`), nunca do body.
 * `endedAt`/`durationMs` são calculados com `Date` do servidor no pause/stop —
 * o cliente nunca envia duração.
 *
 * **Separação manual × IA (ADR-V2-057):** este serviço manipula APENAS
 * `telemetry.manualTimers[]`. JAMAIS toca `telemetry.workSessions[]`,
 * `cycleTime` ou `leadTime` (fluxo de IA em `TasksService.updateStatus`).
 *
 * @see ManualTimerSession — modelo da sessão
 * @see TaskTimerStateDto — estado agregado exposto no TaskResponseDto
 * @see ADR-V2-057 — decisão de arquitetura
 */
@Injectable()
export class TaskTimerService {
  private readonly logger = new Logger(TaskTimerService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly eventProducer: EventProducerService,
    private readonly correlationIdService: CorrelationIdService,
  ) {}

  /**
   * Abre uma nova sessão manual de timer para o usuário (start / resume).
   *
   * Aplica tenant gate (404 anti-enumeration se a task estiver fora do scope)
   * e a regra "1 timer aberto por task": se já existir QUALQUER sessão aberta
   * (deste ou de outro usuário), lança 409.
   *
   * @param id - chave BigInt da task (string)
   * @param actorId - DEntidade.chave do usuário (vem do JWT, nunca do body)
   * @param accessibleProjectIds - scope tenant (ADR-V2-042); undefined = sem gate
   * @param action - 'start' ou 'resume' (apenas para logging/auditoria)
   * @returns sessões manuais atualizadas para reconstrução do response
   *
   * @throws {NotFoundException} task inexistente ou fora do scope
   * @throws {ConflictException} já existe timer aberto na task
   */
  async start(
    id: string,
    actorId: bigint,
    accessibleProjectIds?: string[],
    action: 'start' | 'resume' = 'start',
  ): Promise<TimerMutationResult> {
    const { task, dados, telemetry, manualTimers } = await this.loadTask(
      id,
      accessibleProjectIds,
    );

    // Regra 1-timer-por-task: nenhuma sessão pode estar aberta (de ninguém).
    if (manualTimers.some((s) => !s.endedAt)) {
      throw new ConflictException('Já existe um timer em andamento nesta task');
    }

    const nowIso = new Date().toISOString();
    // userId SEMPRE do JWT (actorId), nunca do body — anti-fraude (ADR-V2-057).
    manualTimers.push({ userId: actorId.toString(), startedAt: nowIso });

    await this.persist(task.chave, dados, telemetry, manualTimers);

    this.logger.debug(
      `timer_${action} taskId=${id} userId=${actorId.toString()} startedAt=${nowIso}`,
    );

    return { taskChave: task.chave, manualTimers };
  }

  /**
   * Fecha a sessão aberta do usuário (pause / stop).
   *
   * Aritmética 100% server-side (anti-fraude): grava `endedAt` com a hora do
   * servidor e calcula `durationMs = endedAt − startedAt`. O body nunca carrega
   * duração. Persiste imediatamente. Emite DEvento de auditoria pós-commit
   * (`timer.paused` / `timer.stopped`) reusando a classe de audit existente
   * (-489 AUDIT_GENERIC) — ZERO DClasse nova.
   *
   * @param id - chave BigInt da task (string)
   * @param actorId - DEntidade.chave do usuário (vem do JWT)
   * @param accessibleProjectIds - scope tenant (ADR-V2-042)
   * @param action - 'pause' ou 'stop' (define o tipo do DEvento de auditoria)
   * @returns sessões manuais atualizadas para reconstrução do response
   *
   * @throws {NotFoundException} task inexistente ou fora do scope
   * @throws {ConflictException} nenhuma sessão aberta para este usuário
   */
  async close(
    id: string,
    actorId: bigint,
    accessibleProjectIds: string[] | undefined,
    action: 'pause' | 'stop',
  ): Promise<TimerMutationResult> {
    const { task, dados, telemetry, manualTimers } = await this.loadTask(
      id,
      accessibleProjectIds,
    );

    const actorIdStr = actorId.toString();
    // Fecha a sessão aberta DESTE usuário (1 por task, mas filtra por dono).
    const open = manualTimers.find((s) => !s.endedAt && s.userId === actorIdStr);
    if (!open) {
      throw new ConflictException(
        'Nenhum timer em andamento para este usuário nesta task',
      );
    }

    const end = new Date();
    open.endedAt = end.toISOString();
    // Server-side: nunca confiar na duração do cliente (ADR-V2-057).
    open.durationMs = end.getTime() - new Date(open.startedAt).getTime();

    await this.persist(task.chave, dados, telemetry, manualTimers);

    // Evento de auditoria APÓS persistência (devari-backend-patterns §7).
    // Reusa -489 AUDIT_GENERIC via TYPE_TO_CLASSE — NÃO cria DClasse nova.
    await this.eventProducer.addInternalEvent(
      action === 'pause' ? 'timer.paused' : 'timer.stopped',
      {
        taskId: task.chave.toString(),
        userId: actorIdStr,
        durationMs: open.durationMs,
        ...(task.idProject && { projectId: task.idProject.toString() }),
      },
      this.correlationIdService.getOrGenerate(),
    );

    this.logger.debug(
      `timer_${action} taskId=${id} userId=${actorIdStr} durationMs=${open.durationMs}`,
    );

    return { taskChave: task.chave, manualTimers };
  }

  /**
   * Constrói o estado agregado do timer (DTO) a partir de sessões manuais.
   *
   * Síncrono e puro: NÃO hidrata nomes de usuário (deixados como `null` aqui).
   * Para o response com nomes, usar {@link buildTimerStateMap} (batch). É usado
   * tanto nas mutações (start/pause/resume/stop) quanto na agregação de lista.
   *
   * Retorna `null` quando não há nenhuma sessão (a task nunca teve timer),
   * sinalizando ausência de timer no `TaskResponseDto`.
   *
   * @param manualTimers - sessões manuais brutas de `telemetry.manualTimers`
   * @param userNames - mapa userId → nome (opcional; ausente = userName null)
   * @returns estado agregado ou null
   */
  buildTimerState(
    manualTimers: ManualTimerSession[] | undefined | null,
    userNames?: Map<string, string | null>,
  ): TaskTimerStateDto | null {
    if (!manualTimers || manualTimers.length === 0) {
      return null;
    }

    const openSession = manualTimers.find((s) => !s.endedAt);

    // Agregação server-side de durações fechadas, por usuário.
    const totals = new Map<string, number>();
    for (const s of manualTimers) {
      if (typeof s.durationMs === 'number' && s.durationMs > 0) {
        totals.set(s.userId, (totals.get(s.userId) ?? 0) + s.durationMs);
      }
    }

    // Ordem determinística por userId (BigInt asc) para resposta estável.
    const totalsByUser: TaskTimerUserTotalDto[] = [...totals.entries()]
      .sort((a, b) => (BigInt(a[0]) < BigInt(b[0]) ? -1 : 1))
      .map(([userId, totalMs]) => ({
        userId,
        userName: userNames?.get(userId) ?? null,
        totalMs,
      }));

    return {
      running: !!openSession,
      runningUserId: openSession?.userId ?? null,
      runningStartedAt: openSession?.startedAt ?? null,
      totalsByUser,
    };
  }

  /**
   * Soma o tempo manual total (todos os usuários) de uma task em ms.
   *
   * Conveniência para consumidores que precisam só do agregado global (ex.: a
   * coluna "Tempo gasto" da Fase 3). Deriva da mesma fonte server-side.
   *
   * @param manualTimers - sessões manuais brutas
   * @returns soma de durationMs das sessões fechadas (0 se nenhuma)
   */
  totalMs(manualTimers: ManualTimerSession[] | undefined | null): number {
    if (!manualTimers) return 0;
    return manualTimers.reduce(
      (acc, s) => acc + (typeof s.durationMs === 'number' && s.durationMs > 0 ? s.durationMs : 0),
      0,
    );
  }

  /**
   * Formata uma duração em milissegundos como rótulo humano "Xh Ymin".
   *
   * Fonte ÚNICA de formatação da coluna "Tempo gasto" (Fase 3 — ADR-V2-057):
   * o backend devolve a string pronta e o frontend apenas a exibe (NUNCA soma
   * no cliente). Regras:
   * - `0` (ou negativo/NaN) → `'—'` (travessão, "sem tempo registrado").
   * - `< 1 min` → `'<1min'` (evita exibir "0h 0min" para sessões muito curtas).
   * - `< 1 h`   → `'Ymin'` (ex.: "45min").
   * - `>= 1 h`  → `'Xh'` (minutos zero) ou `'Xh Ymin'` (ex.: "2h", "2h 45min").
   *
   * @param totalMs - total agregado em milissegundos
   * @returns rótulo formatado para exibição
   */
  formatTotalLabel(totalMs: number): string {
    if (!Number.isFinite(totalMs) || totalMs <= 0) {
      return '—';
    }

    const totalMinutes = Math.floor(totalMs / 60000);
    if (totalMinutes === 0) {
      return '<1min';
    }

    const hours = Math.floor(totalMinutes / 60);
    const minutes = totalMinutes % 60;

    if (hours === 0) {
      return `${minutes}min`;
    }
    if (minutes === 0) {
      return `${hours}h`;
    }
    return `${hours}h ${minutes}min`;
  }

  /**
   * Constrói um mapa taskChave → TaskTimerStateDto para um lote de tasks,
   * hidratando nomes de usuário em UMA query batch (ZERO N+1).
   *
   * Usado pelo `TasksService.buildResponse` (lista e findOne). Tasks sem
   * `manualTimers` ficam ausentes do mapa (response `timer = null`).
   *
   * @param tasks - lote com chave + dados (Json) de cada task
   * @returns Map taskChave(string) → TaskTimerStateDto
   */
  async buildTimerStateMap(
    tasks: Array<{ chave: bigint; dados?: unknown }>,
  ): Promise<Map<string, TaskTimerStateDto>> {
    const result = new Map<string, TaskTimerStateDto>();
    if (tasks.length === 0) return result;

    // Coleta os manualTimers de cada task + todos os userIds para o batch.
    const perTask = new Map<string, ManualTimerSession[]>();
    const userIdSet = new Set<string>();

    for (const t of tasks) {
      const dados = (t.dados as Record<string, unknown> | null) ?? null;
      const telemetry = (dados?.telemetry as Record<string, unknown> | null) ?? null;
      const manualTimers = (telemetry?.manualTimers as ManualTimerSession[] | undefined) ?? [];
      if (manualTimers.length === 0) continue;
      perTask.set(t.chave.toString(), manualTimers);
      for (const s of manualTimers) userIdSet.add(s.userId);
    }

    if (perTask.size === 0) return result;

    // Batch de nomes — 1 query para todos os usuários do lote (ZERO N+1).
    const userNames = await this.hydrateUserNames(userIdSet);

    for (const [taskChave, manualTimers] of perTask.entries()) {
      const state = this.buildTimerState(manualTimers, userNames);
      if (state) result.set(taskChave, state);
    }

    return result;
  }

  /**
   * Hidrata nomes de usuário (DEntidade.nome) em uma única query batch.
   *
   * @param userIdSet - conjunto de DEntidade.chave (string)
   * @returns Map userId → nome (ou null se entidade não encontrada)
   */
  private async hydrateUserNames(
    userIdSet: Set<string>,
  ): Promise<Map<string, string | null>> {
    const names = new Map<string, string | null>();
    if (userIdSet.size === 0) return names;

    const userIds = [...userIdSet].map((id) => BigInt(id));
    const users = await this.prisma.dEntidade.findMany({
      where: { chave: { in: userIds }, excluido: false },
      select: { chave: true, nome: true },
    });
    for (const u of users) {
      names.set(u.chave.toString(), u.nome ?? null);
    }
    return names;
  }

  /**
   * Carrega a task aplicando tenant gate e extrai dados/telemetria/manualTimers.
   *
   * Mesmo padrão de `TasksService.updateStatus`: 404 anti-enumeration quando a
   * task está fora do `accessibleProjectIds` (ADR-V2-042).
   *
   * @internal
   */
  private async loadTask(
    id: string,
    accessibleProjectIds?: string[],
  ): Promise<{
    task: { chave: bigint; idProject: bigint | null };
    dados: Record<string, unknown>;
    telemetry: Record<string, unknown>;
    manualTimers: ManualTimerSession[];
  }> {
    const taskId = BigInt(id);

    const task = await this.prisma.dTask.findFirst({
      where: { chave: taskId, excluido: false },
      select: { chave: true, idProject: true, dados: true },
    });

    if (!task) {
      throw new NotFoundException(`Task ${id} não encontrada`);
    }

    // ADR-V2-042: tenant gate via projectId. Mensagem idêntica → anti-enumeration.
    if (accessibleProjectIds !== undefined) {
      const pid = task.idProject?.toString() ?? null;
      if (!pid || !accessibleProjectIds.includes(pid)) {
        this.logger.warn(
          `tenant_mismatch_task_timer taskId=${id} projectId=${pid ?? 'null'} fora do scope`,
        );
        throw new NotFoundException(`Task ${id} não encontrada`);
      }
    }

    const dados = (task.dados as Record<string, unknown> | null) ?? {};
    const telemetry = (dados.telemetry as Record<string, unknown> | null) ?? {};
    const manualTimers =
      (telemetry.manualTimers as ManualTimerSession[] | undefined) ?? [];

    return {
      task: { chave: task.chave, idProject: task.idProject ?? null },
      dados,
      telemetry,
      manualTimers,
    };
  }

  /**
   * Persiste `manualTimers` em `dados.telemetry`, preservando o resto do Json.
   *
   * Faz spread defensivo de `dados` e `telemetry` para NÃO sobrescrever
   * `workSessions`, `cycleTime`, `leadTime` (fluxo de IA — ADR-V2-057) nem
   * `v3`, `identifier`, etc.
   *
   * @internal
   */
  private async persist(
    taskChave: bigint,
    dados: Record<string, unknown>,
    telemetry: Record<string, unknown>,
    manualTimers: ManualTimerSession[],
  ): Promise<void> {
    const novosDados = {
      ...dados,
      telemetry: {
        ...telemetry,
        manualTimers,
      },
    };

    await this.prisma.dTask.update({
      where: { chave: taskChave },
      data: { dados: novosDados as unknown as Prisma.InputJsonValue },
    });
  }
}

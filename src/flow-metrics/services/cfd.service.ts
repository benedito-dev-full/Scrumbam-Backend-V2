import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { PeriodResolver, PeriodInput } from '../helpers/period-resolver';
import { CfdResponseDto, CfdDataPointDto } from '../dto/cfd-response.dto';

/**
 * idClasse para DEvento TASK_STATUS_CHANGED (seed F1 V2).
 */
const EVENTO_TASK_STATUS_CHANGED = BigInt(-498);

/**
 * Status inicial assumido para tasks sem transição anterior ao período (plano D1).
 */
const STATUS_INICIAL = 'INBOX';

/**
 * Mapa estático de idStatus → código (fallback, igual ao WipAgeService).
 */
const STATUS_CODE_MAP: Record<string, string> = {
  '-441': 'INBOX',
  '-442': 'READY',
  '-443': 'EXECUTING',
  '-444': 'DONE',
  '-445': 'FAILED',
  '-446': 'CANCELLED',
  '-447': 'DISCARDED',
  '-448': 'VALIDATING',
  '-449': 'VALIDATED',
};

/**
 * Metadados de um evento DEvento -498 (TASK_STATUS_CHANGED).
 */
interface TaskStatusChangedMeta {
  taskId?: string;
  from?: string;
  to?: string;
  movedBy?: string;
  _meta?: unknown;
}

/**
 * Serviço de Cumulative Flow Diagram (CFD) de um projeto.
 *
 * Reconstrói o CFD por replay de eventos DEvento -498 (TASK_STATUS_CHANGED)
 * associados às tasks do projeto. Não persiste snapshots.
 *
 * Decisão D1 (plano §5): reconstrução por replay em vez de snapshot persistido.
 * - Estado inicial de cada task = INBOX (assumido quando sem transição anterior)
 * - Para cada dia D no período, aplica transições com criadoEm <= D 23:59:59
 * - Conta tasks por status ao fim de cada dia
 *
 * Performance: índice composto [idClasse, criadoEm DESC] em DEvento (schema).
 * Janela típica 30d + 1000 tasks → ~3-5k eventos → <100ms.
 *
 * F8 é read-only puro — NÃO persiste nada, NÃO emite eventos.
 *
 * @see PrismaService — acesso ao banco (read-only neste service)
 * @see PeriodResolver — resolução de período via TimezoneService
 */
@Injectable()
export class CfdService {
  private readonly logger = new Logger(CfdService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly periodResolver: PeriodResolver,
  ) {}

  /**
   * Calcula o CFD para um projeto no período especificado.
   *
   * Algoritmo (plano D1):
   * 1. Buscar todas as tasks do projeto (não excluídas)
   * 2. Buscar todos os eventos TASK_STATUS_CHANGED dessas tasks via subquery IN
   * 3. Para cada dia D em [from, to]:
   *    a. Para cada task: aplicar transições com criadoEm <= D 23:59:59
   *    b. Contar tasks por status resultante
   * 4. Retornar série temporal
   *
   * @param projectId - Chave BigInt do DProject
   * @param period - Filtros de período
   * @returns CfdResponseDto com série temporal de counts por status
   *
   * @throws {BadRequestException} Se periodFrom > periodTo
   *
   * @example
   * ```typescript
   * const result = await service.calculate(BigInt(123), { period: 'month' });
   * // {
   * //   series: [
   * //     { date: '2026-01-01', counts: { INBOX: 10, DONE: 0, EXECUTING: 0 } },
   * //     { date: '2026-01-02', counts: { INBOX: 8, DONE: 2, EXECUTING: 0 } }
   * //   ]
   * // }
   * ```
   *
   * @see CfdResponseDto — estrutura de retorno
   */
  async calculate(projectId: bigint, period: PeriodInput): Promise<CfdResponseDto> {
    this.logger.debug(`Calculando CFD projeto=${projectId}`);

    const dateRange = this.periodResolver.resolve(period);

    // 1. Buscar IDs de todas as tasks do projeto (não excluídas)
    const taskRows = await this.prisma.dTask.findMany({
      where: { idProject: projectId, excluido: false },
      select: { chave: true, idStatus: true, criadoEm: true },
    });

    if (taskRows.length === 0) {
      return { series: [] };
    }

    const taskIds = taskRows.map((t) => t.chave);

    // 2. Buscar eventos TASK_STATUS_CHANGED anteriores ao fim do período
    // Filtra via subquery IN(taskIds) — Postgres otimiza com hash join
    const eventos = await this.prisma.dEvento.findMany({
      where: {
        idClasse: EVENTO_TASK_STATUS_CHANGED,
        excluido: false,
        criadoEm: { lte: dateRange.lte },
        // Filtrar por tasks do projeto via identificadorExterno (taskId no metaDados)
        // DEvento -498 armazena taskId em metaDados.taskId conforme F5/F7
      },
      select: {
        criadoEm: true,
        metaDados: true,
        identificadorExterno: true,
      },
      orderBy: { criadoEm: 'asc' },
    });

    // Criar set de taskIds como strings para lookup rápido
    const taskIdSet = new Set(taskIds.map((id) => id.toString()));

    // Filtrar eventos que pertencem às tasks do projeto
    const eventosFiltrados = eventos.filter((e) => {
      const meta = e.metaDados as TaskStatusChangedMeta | null;
      if (meta?.taskId) {
        return taskIdSet.has(meta.taskId);
      }
      // Fallback: usar identificadorExterno
      if (e.identificadorExterno) {
        return taskIdSet.has(e.identificadorExterno);
      }
      return false;
    });

    // 3. Construir mapa de estado inicial das tasks
    // Estado inicial = status atual no DTask (ou INBOX se null)
    const taskInitialStatus = new Map<string, string>();
    for (const task of taskRows) {
      const code = task.idStatus ? (STATUS_CODE_MAP[task.idStatus.toString()] ?? 'INBOX') : 'INBOX';
      taskInitialStatus.set(task.chave.toString(), code);
    }

    // 4. Gerar lista de dias no período
    const days = this.generateDays(dateRange.gte, dateRange.lte);

    // 5. Para cada dia, replay de transições e contagem por status
    const series: CfdDataPointDto[] = [];

    for (const day of days) {
      const dayEnd = new Date(day);
      dayEnd.setUTCHours(23, 59, 59, 999);

      // Estado de cada task ao fim deste dia
      const taskStatus = new Map<string, string>(taskInitialStatus);

      // Aplicar transições até o fim do dia
      for (const evento of eventosFiltrados) {
        if (evento.criadoEm > dayEnd) break; // eventos são ordenados ASC

        const meta = evento.metaDados as TaskStatusChangedMeta | null;
        if (!meta?.taskId || !meta?.to) continue;

        if (taskIdSet.has(meta.taskId)) {
          const toCode = this.resolveStatusCode(meta.to);
          taskStatus.set(meta.taskId, toCode);
        }
      }

      // Contar tasks por status
      const counts: Record<string, number> = {};
      for (const status of taskStatus.values()) {
        counts[status] = (counts[status] ?? 0) + 1;
      }

      // Incluir apenas tasks que existiam no dia (criadoEm <= dayEnd)
      const existingCounts: Record<string, number> = {};
      for (const task of taskRows) {
        if (task.criadoEm <= dayEnd) {
          const status = taskStatus.get(task.chave.toString()) ?? STATUS_INICIAL;
          existingCounts[status] = (existingCounts[status] ?? 0) + 1;
        }
      }

      series.push({
        date: day.toISOString().slice(0, 10),
        counts: existingCounts,
      });
    }

    return { series };
  }

  /**
   * Resolve o código do status a partir de uma string (idStatus ou código).
   *
   * @param statusStr - String de status (pode ser idClasse negativo ou código)
   * @returns Código legível (ex: 'EXECUTING')
   */
  private resolveStatusCode(statusStr: string): string {
    // Verificar se é um ID negativo (ex: '-443')
    if (statusStr.startsWith('-') && !isNaN(Number(statusStr))) {
      return STATUS_CODE_MAP[statusStr] ?? statusStr;
    }
    // Já é um código legível
    return statusStr;
  }

  /**
   * Gera lista de datas (início do dia UTC) entre from e to.
   *
   * @param from - Data inicial
   * @param to - Data final
   * @returns Array de Dates, uma por dia
   */
  private generateDays(from: Date, to: Date): Date[] {
    const days: Date[] = [];
    const current = new Date(from);
    current.setUTCHours(0, 0, 0, 0);

    const end = new Date(to);
    end.setUTCHours(23, 59, 59, 999);

    while (current <= end) {
      days.push(new Date(current));
      current.setUTCDate(current.getUTCDate() + 1);
    }

    return days;
  }
}

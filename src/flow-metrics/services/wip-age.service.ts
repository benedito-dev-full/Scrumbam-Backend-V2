import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { PrismaService } from '../../prisma.service';
import { WipAgeResponseDto, WipAgeByStatusDto } from '../dto/wip-age-response.dto';
import { parseTaskDados } from '../../tasks/schemas/task-dados.schema';

/**
 * idClasse dos status de conclusão — tasks nestes status são excluídas do WIP.
 */
const DONE_STATUS_IDS = new Set([BigInt(-444), BigInt(-449)]);

/**
 * idClasse de status que devem usar executingAt como timestamp inicial.
 */
const EXECUTING_STATUS_IDS = new Set([BigInt(-443), BigInt(-448)]);

/**
 * Range de idClasse para status V3 (DTabela -441..-449, seed F1).
 */
const STATUS_ID_MIN = BigInt(-449);
const STATUS_ID_MAX = BigInt(-441);

/**
 * Mapa estático de idStatus → código do status V3 (fallback se banco indisponível).
 */
const STATUS_CODE_FALLBACK: Record<string, string> = {
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
 * Serviço de cálculo de WIP (Work in Progress) age de tasks de um projeto.
 *
 * WIP age = tempo (em horas) desde o início do trabalho até agora,
 * para tasks ainda não concluídas (não-DONE/VALIDATED).
 *
 * Timestamp inicial por status (plano §6 nota 5):
 * - EXECUTING / VALIDATING → `dados.telemetry.executingAt` (mais relevante)
 * - INBOX / READY / outros → `criadoEm` (momento de entrada no sistema)
 *
 * Carrega o mapa de status uma única vez no boot via OnModuleInit (cache sem TTL —
 * statuses V3 não mudam em runtime).
 *
 * F8 é read-only puro — NÃO persiste nada, NÃO emite eventos.
 *
 * @see PrismaService — acesso ao banco (read-only neste service)
 */
@Injectable()
export class WipAgeService implements OnModuleInit {
  private readonly logger = new Logger(WipAgeService.name);

  /** Cache de idStatus → statusCode (carregado no boot, sem TTL). */
  private statusCodeMap: Map<string, string> = new Map();

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inicializa o cache de status codes ao subir o módulo.
   *
   * Carrega DTabela com idClasse no range -441..-449 para mapear
   * idStatus → código do status (ex: '-444' → 'DONE').
   */
  async onModuleInit(): Promise<void> {
    await this.loadStatusCodes();
  }

  /**
   * Carrega mapa de status a partir do banco.
   */
  async loadStatusCodes(): Promise<void> {
    try {
      const statuses = await this.prisma.dTabela.findMany({
        where: {
          idClasse: { gte: STATUS_ID_MIN, lte: STATUS_ID_MAX },
          excluido: false,
        },
        select: { chave: true, codigo: true, nome: true },
      });

      for (const s of statuses) {
        const key = s.chave.toString();
        this.statusCodeMap.set(key, s.codigo ?? s.nome ?? key);
      }

      this.logger.log(`Status codes carregados: ${this.statusCodeMap.size} entradas`);
    } catch (err) {
      this.logger.warn(
        `Falha ao carregar status codes do banco, usando fallback estático: ${String(err)}`,
      );
      for (const [id, code] of Object.entries(STATUS_CODE_FALLBACK)) {
        this.statusCodeMap.set(id, code);
      }
    }
  }

  /**
   * Resolve o código do status a partir do idStatus BigInt.
   *
   * @param idStatus - idClasse do status
   * @returns Código do status (ex: 'EXECUTING') ou idStatus como string
   */
  getStatusCode(idStatus: bigint): string {
    const key = idStatus.toString();
    return this.statusCodeMap.get(key) ?? STATUS_CODE_FALLBACK[key] ?? key;
  }

  /**
   * Calcula a WIP age por status para um projeto.
   *
   * Retorna apenas tasks não-DONE (excluindo DONE e VALIDATED).
   * Tasks agrupadas por status com métricas de idade média e máxima.
   *
   * @param projectId - Chave BigInt do DProject
   * @returns WipAgeResponseDto com breakdown por status e total
   *
   * @example
   * ```typescript
   * const result = await service.calculate(BigInt(123));
   * // {
   * //   byStatus: [
   * //     { statusCode: 'INBOX', avgAgeHours: 2.5, maxAgeHours: 10.0, count: 5 },
   * //     { statusCode: 'EXECUTING', avgAgeHours: 18.0, maxAgeHours: 72.0, count: 2 }
   * //   ],
   * //   total: 7,
   * //   calculatedAt: '2026-05-10T14:00:00.000Z'
   * // }
   * ```
   *
   * @see WipAgeResponseDto — estrutura de retorno
   */
  async calculate(projectId: bigint): Promise<WipAgeResponseDto> {
    this.logger.debug(`Calculando WIP age projeto=${projectId}`);

    const now = new Date();

    // Buscar tasks não-DONE (excluir DONE e VALIDATED)
    const tasks = await this.prisma.dTask.findMany({
      where: {
        idProject: projectId,
        excluido: false,
        NOT: {
          idStatus: { in: Array.from(DONE_STATUS_IDS) },
        },
      },
      select: {
        idStatus: true,
        criadoEm: true,
        dados: true,
      },
    });

    // Agrupar por status
    const grouped = new Map<string, number[]>();

    for (const task of tasks) {
      if (!task.idStatus) continue;

      const statusCode = this.getStatusCode(task.idStatus);
      const ageHours = this.calculateAgeHours(task, now);

      if (!grouped.has(statusCode)) {
        grouped.set(statusCode, []);
      }
      grouped.get(statusCode)!.push(ageHours);
    }

    const byStatus: WipAgeByStatusDto[] = [];

    for (const [statusCode, ages] of grouped.entries()) {
      const avg = ages.reduce((a, b) => a + b, 0) / ages.length;
      const max = Math.max(...ages);

      byStatus.push({
        statusCode,
        avgAgeHours: Math.round(avg * 100) / 100,
        maxAgeHours: Math.round(max * 100) / 100,
        count: ages.length,
      });
    }

    // Ordenar por statusCode para resposta consistente
    byStatus.sort((a, b) => a.statusCode.localeCompare(b.statusCode));

    return {
      byStatus,
      total: tasks.length,
      calculatedAt: now.toISOString(),
    };
  }

  /**
   * Calcula a idade em horas de uma task a partir do timestamp correto.
   *
   * Regra (plano §6 nota 5):
   * - EXECUTING / VALIDATING → usa `telemetry.executingAt` (mais preciso)
   * - outros → usa `criadoEm`
   *
   * @param task - Task com idStatus, criadoEm e dados
   * @param now - Timestamp de referência
   * @returns Idade em horas
   */
  private calculateAgeHours(
    task: { idStatus: bigint | null; criadoEm: Date; dados: unknown },
    now: Date,
  ): number {
    let startAt: Date = task.criadoEm;

    if (task.idStatus && EXECUTING_STATUS_IDS.has(task.idStatus)) {
      const dados = parseTaskDados(task.dados);
      const executingAt = dados.telemetry?.executingAt;
      if (executingAt) {
        const parsed = new Date(executingAt);
        if (!isNaN(parsed.getTime())) {
          startAt = parsed;
        }
      }
    }

    const diffMs = now.getTime() - startAt.getTime();
    return Math.max(0, diffMs / (1000 * 60 * 60));
  }
}

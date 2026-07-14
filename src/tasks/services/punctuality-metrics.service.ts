import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';
import { PunctualityMetricsResponseDto } from '../dto/punctuality-metrics-response.dto';

/**
 * Linha agregada retornada pelo SQL raw.
 *
 * - `averageDelayDays`: `AVG(...)` do PostgreSQL retorna `numeric` → o driver
 *   Prisma entrega como `string` (ou `null` quando não há linhas na agregação).
 * - `sampleSize`: `COUNT(*)` → `bigint`.
 */
type PunctualityRow = {
  averageDelayDays: string | number | null;
  sampleSize: bigint;
};

/**
 * Constantes de idClasse de DTabela para estados TERMINAIS V3 — fonte da verdade
 * é o seed canônico V2 (`prisma/seeds/classes.seed.ts`). Espelham
 * `STATUS_TO_TABELA_CLASSE` de `tasks.service.ts` e as constantes de
 * `PhaseMetricsService`. O JOIN é com `DTabela` (chave POSITIVA por projeto),
 * cujo `idClasse` NEGATIVO identifica o estado do registro.
 *
 * -444 = DONE, -449 = VALIDATED. Apenas estes entram no cálculo de pontualidade.
 */
const STATUS_DONE_IDCLASSE = -444 as const;
const STATUS_VALIDATED_IDCLASSE = -449 as const;

/**
 * Atraso em DIAS DE CALENDÁRIO: `dia(doneAt em SP) − dia(dueDate)`.
 *
 * Os dois lados recebem tratamento DIFERENTE, e é aí que estava o bug:
 *
 * - **`doneAt` é um INSTANTE real** (gravado com `new Date()` na transição para
 *   DONE) → converte-se para o dia em `America/Sao_Paulo`.
 * - **`dueDate` é uma DATA CIVIL** ("dia 13"), que o banco guarda como
 *   `2026-07-13T00:00:00.000Z` — meia-noite UTC. Ele NÃO deve ser convertido de
 *   fuso: em Brasília isso seria 21h do dia 12, e o prazo "voltaria" um dia.
 *   Lê-se a data UTC, que é exatamente o dia escolhido pelo usuário.
 *
 * A subtração crua de timestamps que existia aqui misturava as duas naturezas:
 * uma task concluída às 10h do PRÓPRIO dia do prazo dava `+13h ≈ +0,54 dia`,
 * entrando na média de atraso e na "Margem de atraso" como se tivesse atrasado.
 * Concluir no dia do prazo é `0` — não é atraso.
 */
const DELAY_DAYS_EXPR = Prisma.sql`(
  date_trunc(
    'day',
    ((t."dados"->'telemetry'->>'doneAt')::timestamptz) AT TIME ZONE 'America/Sao_Paulo'
  )
  - date_trunc('day', t."dueDate" AT TIME ZONE 'UTC')
)`;

/**
 * Service de métricas de pontualidade / margem de atraso (agregadas por projeto).
 *
 * Expõe DUAS métricas irmãs sobre a mesma base (`completedAt - dueDate`):
 *
 * - `computeForProject` — **Pontualidade**: média de TODAS as tasks concluídas
 *   com prazo (atraso E adiantamento juntos). Responde "no saldo geral, o
 *   projeto está adiantado ou atrasado?".
 * - `computeStrictDelayForProject` — **Margem de Atraso**: média SÓ das tasks
 *   que atrasaram de fato (`diffDays > 0`, atraso estrito). Responde "quando o
 *   projeto atrasa, de quanto costuma ser esse atraso?".
 *
 * ```
 * dias = completedAt - dueDate   (positivo = atrasou, negativo = adiantou)
 * ```
 *
 * Regras de negócio (fechadas):
 * - Pontualidade: valores negativos (entrega adiantada) contam normalmente na
 *   média — NÃO são clampados a zero.
 * - Margem de Atraso: SÓ `diffDays > 0` entra; `diffDays = 0` (prazo exato) e
 *   `diffDays < 0` (adiantada) são EXCLUÍDOS do cálculo (não contam como 0).
 * - Tasks concluídas SEM `dueDate` são EXCLUÍDAS do cálculo (não entram nem como 0).
 * - Tasks sem `doneAt` (nunca de fato concluídas, ou concluídas antes da
 *   telemetria existir) são EXCLUÍDAS.
 * - Apenas status TERMINAL DONE (-444) / VALIDATED (-449) entram, via JOIN
 *   `DTask.idStatus` → `DTabela.idClasse` (mesmo padrão de `PhaseMetricsService`).
 *
 * Agregação 100% no banco (`AVG`) — 1 query total, sem paginação, sem teto de
 * volume. Resolve o problema do limite `@Max(100)` do `ListTasksQueryDto` pela
 * raiz (o cálculo roda sobre TODAS as linhas do projeto de uma vez).
 *
 * Tabela estrutural (DTask) — Pilar 1 NÃO se aplica (leitura/agregação pura,
 * Prisma direto, sem Engine). Segue o precedente já revisado de
 * `PhaseMetricsService`.
 *
 * @see PhaseMetricsService — precedente arquitetural (agregação server-side sobre DTask)
 * @see PunctualityMetricsResponseDto — shape da resposta
 * @see prisma/seeds/classes.seed.ts — origem das constantes idClasse
 */
@Injectable()
export class PunctualityMetricsService {
  private readonly logger = new Logger(PunctualityMetricsService.name);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Calcula a média de atraso (dias corridos) das tasks concluídas de um projeto.
   *
   * @param projectId - chave BigInt do projeto (List) alvo
   * @returns `{ averageDelayDays, sampleSize, computedAt }`. `averageDelayDays`
   *   é `null` e `sampleSize` é `0` quando não há amostras.
   *
   * @example
   * ```typescript
   * const m = await service.computeForProject(BigInt(5));
   * // { averageDelayDays: 2.35, sampleSize: 12, computedAt: '2026-07-09T...' }
   *
   * // Projeto sem tasks concluídas com dueDate:
   * // { averageDelayDays: null, sampleSize: 0, computedAt: '...' }
   * ```
   */
  async computeForProject(projectId: bigint): Promise<PunctualityMetricsResponseDto> {
    this.logger.log(`computeForProject(${projectId.toString()})`);

    const row = await this.aggregate([Prisma.sql`t."idProject" = ${projectId}`]);

    return this.buildResponse(row);
  }

  /**
   * Calcula a "margem de atraso" — média de dias corridos SÓ das tasks que
   * atrasaram de fato (`diffDays > 0`, atraso ESTRITO) do projeto.
   *
   * Diferença central para `computeForProject`: enquanto a Pontualidade agrega
   * TODAS as tasks concluídas com prazo (atraso e adiantamento se cancelam na
   * média — responde "no saldo geral, o projeto está adiantado ou atrasado?"),
   * a Margem de Atraso agrega SÓ o subconjunto que atrasou (responde "quando o
   * projeto atrasa, de quanto costuma ser esse atraso?").
   *
   * Regras de negócio (fechadas com o CEO):
   * - Só entram tasks com `diffDays > 0` (atraso estrito).
   * - Tasks entregues exatamente no prazo (`diffDays = 0`) são EXCLUÍDAS — não
   *   contam como "0 dias de atraso" (mesmo padrão de exclusão de amostra que
   *   `dueDate`/`doneAt` ausentes já usam em `computeForProject`).
   * - Tasks adiantadas (`diffDays < 0`) são EXCLUÍDAS.
   * - Mesmas exclusões-base de `computeForProject`: sem `dueDate`, sem
   *   `doneAt`, ou fora de status terminal (DONE/VALIDATED) — ver `aggregate`.
   *
   * Reaproveita o núcleo compartilhado (`aggregate`) — mesma query base, com 1
   * filtro adicional (`(doneAt - dueDate) > 0`) concatenado ao WHERE.
   *
   * @param projectId - chave BigInt do projeto (List) alvo
   * @returns `{ averageDelayDays, sampleSize, computedAt }`. `averageDelayDays`
   *   é sempre `>= 0` quando não-null (nunca negativo — só atrasos estritos
   *   entram); `null` e `sampleSize: 0` quando não há amostras.
   *
   * @example
   * ```typescript
   * const m = await service.computeStrictDelayForProject(BigInt(5));
   * // { averageDelayDays: 3.8, sampleSize: 7, computedAt: '2026-07-09T...' }
   *
   * // Projeto sem tasks atrasadas (só pontuais/adiantadas):
   * // { averageDelayDays: null, sampleSize: 0, computedAt: '...' }
   * ```
   */
  async computeStrictDelayForProject(projectId: bigint): Promise<PunctualityMetricsResponseDto> {
    this.logger.log(`computeStrictDelayForProject(${projectId.toString()})`);

    const row = await this.aggregate([
      Prisma.sql`t."idProject" = ${projectId}`,
      Prisma.sql`${DELAY_DAYS_EXPR} > interval '0'`,
    ]);

    return this.buildResponse(row);
  }

  /**
   * Variante agregada por `assigneeId` (recorte "por usuário") — reservada.
   *
   * NÃO exposta via rota HTTP nesta rodada: o recorte "por usuário logado" é
   * calculado client-side no Frontend-V2 (mesmo padrão do KPI "Ritmo"). Mantida
   * aqui, no mesmo service, por coesão — evita duplicar a query SQL se o CEO
   * decidir migrar esse recorte para o backend no futuro (ex.: relatório de
   * gestão que rode fora do dashboard pessoal).
   *
   * @param assigneeId - chave BigInt da DEntidade do usuário
   * @param scopeProjectIds - quando informado, restringe a agregação a estes
   *   projetos (`idProject IN (...)`). Lista vazia → nenhuma amostra.
   * @returns `PunctualityMetricsResponseDto` no mesmo shape de `computeForProject`
   */
  async computeForUser(
    assigneeId: bigint,
    scopeProjectIds?: bigint[],
  ): Promise<PunctualityMetricsResponseDto> {
    this.logger.log(
      `computeForUser(${assigneeId.toString()}, scope=${scopeProjectIds?.length ?? 'all'})`,
    );

    // Scope explícito e vazio → sem amostras (defense-in-depth, sem hit no banco).
    if (scopeProjectIds !== undefined && scopeProjectIds.length === 0) {
      return this.buildResponse({ averageDelayDays: null, sampleSize: BigInt(0) });
    }

    const filters: Prisma.Sql[] = [Prisma.sql`t."idAssignee" = ${assigneeId}`];
    if (scopeProjectIds !== undefined) {
      filters.push(Prisma.sql`t."idProject" IN (${Prisma.join(scopeProjectIds)})`);
    }

    const row = await this.aggregate(filters);

    return this.buildResponse(row);
  }

  /**
   * Núcleo compartilhado da agregação (`AVG` + `COUNT` no banco).
   *
   * Recebe fragmentos de filtro adicionais (projeto e/ou assignee) que são
   * concatenados ao WHERE base com `AND`. Os fragmentos usam parâmetros
   * vinculados (`${value}` → $1, $2, ...) — seguro contra injeção. As constantes
   * de idClasse são literais fixas do seed. Query única (ZERO N+1).
   *
   * Base do WHERE (sempre presente):
   * - `excluido = false`
   * - status terminal (`DTabela.idClasse IN (-444, -449)`)
   * - `dueDate IS NOT NULL`
   * - `doneAt` presente E parseável como timestamp (guard anti-500 no cast).
   */
  private async aggregate(extraFilters: Prisma.Sql[]): Promise<PunctualityRow> {
    const where = extraFilters.length
      ? Prisma.join(extraFilters, ' AND ', ' AND ', '')
      : Prisma.empty;

    const rows = await this.prisma.$queryRaw<PunctualityRow[]>(Prisma.sql`
      SELECT
        AVG(
          EXTRACT(EPOCH FROM ${DELAY_DAYS_EXPR}) / 86400.0
        ) AS "averageDelayDays",
        COUNT(*) AS "sampleSize"
      FROM "DTask" t
      INNER JOIN "DTabela" s
        ON s.chave = t."idStatus" AND s.excluido = false
      WHERE t.excluido = false
        AND s."idClasse" IN (${STATUS_DONE_IDCLASSE}, ${STATUS_VALIDATED_IDCLASSE})
        AND t."dueDate" IS NOT NULL
        AND (t."dados"->'telemetry'->>'doneAt') IS NOT NULL
        AND (t."dados"->'telemetry'->>'doneAt') ~ '^\d{4}-\d{2}-\d{2}'
        ${where}
    `);

    return rows[0] ?? { averageDelayDays: null, sampleSize: BigInt(0) };
  }

  /**
   * Converte a linha crua do SQL no DTO de resposta.
   *
   * `AVG` retorna `numeric` → o driver Prisma entrega como `string` (ou `null`
   * quando `COUNT = 0`). Normalizamos para `number | null`. `sampleSize` vem
   * como `bigint` → `Number` (a contagem cabe folgado em number).
   */
  private buildResponse(row: PunctualityRow): PunctualityMetricsResponseDto {
    const sampleSize = Number(row.sampleSize ?? 0);
    const averageDelayDays =
      row.averageDelayDays === null || row.averageDelayDays === undefined
        ? null
        : Number(row.averageDelayDays);

    this.logger.debug(`punctuality → avg=${averageDelayDays ?? 'null'} sample=${sampleSize}`);

    return {
      averageDelayDays,
      sampleSize,
      computedAt: new Date().toISOString(),
    };
  }
}

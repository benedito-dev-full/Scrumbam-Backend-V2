import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { TimezoneService } from '../common/services/timezone.service';
import { RoleResolverService } from '../auth/services/role-resolver.service';
import { parseTaskDados } from '../tasks/schemas/task-dados.schema';
import { DelayReasonsGroupBy, DelayReasonsQueryDto } from './dto/delay-reasons-query.dto';
import { DelayReasonGroupDto, DelayReasonsResponseDto } from './dto/delay-reasons-response.dto';
import { computeOverdue } from './overdue.util';

/** DClasse do evento de justificativa de atraso (seed F1 — ADR-V2-070). */
const ID_CLASSE_DELAY_JUSTIFICATION = -503;

/**
 * Coluna de `GROUP BY` por dimensão (whitelist estática — NÃO recebe input do
 * cliente diretamente). `groupBy` é validado por `@IsIn` no DTO e usado apenas
 * como chave deste mapa; o fragmento SQL é fixo em código → sem risco de
 * injeção. Os valores (org/user/motivo/datas) vão como bind params.
 */
const GROUP_COLUMN: Record<DelayReasonsGroupBy, Prisma.Sql> = {
  motivo: Prisma.sql`(e."metaDados" ->> 'motivoClasse')`,
  usuario: Prisma.sql`e."idEntidade"::text`,
  projeto: Prisma.sql`(e."metaDados" ->> 'projetoId')`,
};

/** Linha crua da agregação (`$queryRaw`). */
interface AggRow {
  /** Chave do grupo (varia por dimensão; string). */
  key: string | null;
  /** `COUNT(*)::int` → number. */
  count: number;
  /** `AVG(numeric)` → o driver Prisma entrega como `string` (ou `null`). */
  avgDelayDays: string | null;
}

/** Linha crua da agregação cruzada (`$queryRaw` com `GROUP BY groupCol, subCol`). */
interface SubAggRow extends AggRow {
  /** Chave da dimensão secundária (`subGroupBy`; string). */
  subKey: string | null;
}

/**
 * Service de agregação do painel admin de motivos de atraso (Fase 2 —
 * ADR-V2-070).
 *
 * Agrega justificativas **vigentes** (`DEvento` idClasse=-503,
 * `excluido=false`) da organização, agrupadas por motivo / usuário / projeto,
 * com filtros de autor, projeto, motivo e período.
 *
 * **1 query de agregação (`$queryRaw`, ZERO N+1)** + 1 query batch para
 * resolver rótulos legíveis (nome do motivo/usuário/projeto). O SQL faz
 * `INNER JOIN DProject` por `(metaDados->>'projetoId')::bigint` para restringir
 * ao tenant (`DProject.idEstab = orgId`) — justificativas de tasks sem projeto
 * NÃO entram (não há org a que atribuí-las).
 *
 * **Pilar 1 NÃO se aplica** (não é transação financeira — só SELECT).
 * **RBAC:** org ADMIN (-161) SOMENTE (CEO decisão 3). Project MANAGER NÃO acessa.
 *
 * @see RoleResolverService.getOrgRole — resolução do role de org.
 * @see DEvento_delay_reason_agg_idx — índice parcial que acelera esta query.
 */
@Injectable()
export class DelayReasonsService {
  private readonly logger = new Logger(DelayReasonsService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly timezone: TimezoneService,
    private readonly roleResolver: RoleResolverService,
  ) {}

  /**
   * Agrega os motivos de atraso da organização para o painel admin.
   *
   * Fluxo:
   *  1. Resolve a **org-alvo**: se `projectId` foi passado, é a org DONA desse
   *     projeto (`DProject.idEstab`); senão, a org ativa do JWT.
   *  2. Autoriza: requester DEVE ser org ADMIN (-161) da org-alvo — senão 403.
   *  3. Agrega (`$queryRaw`) as justificativas vigentes da org, com filtros.
   *  4. Resolve rótulos (nome do motivo/usuário/projeto) em 1 query batch.
   *
   * @param query - Filtros + `groupBy` (dimensão do ranking).
   * @param requesterEntidadeId - `DEntidade.chave` do requester (do JWT).
   * @param jwtOrgId - `organizationId` do JWT (org ativa; usado quando não há `projectId`).
   * @returns Ranking `{ groupBy, orgId, total, groups[], filters }`.
   *
   * @throws {NotFoundException} `projectId` informado não existe.
   * @throws {ForbiddenException} Requester não é org ADMIN da org-alvo (ou sem org).
   */
  async aggregate(
    query: DelayReasonsQueryDto,
    requesterEntidadeId: bigint,
    jwtOrgId?: string,
  ): Promise<DelayReasonsResponseDto> {
    const orgId = await this.resolveTargetOrg(query.projectId, jwtOrgId);
    await this.assertOrgAdmin(requesterEntidadeId, orgId);

    const groups = query.subGroupBy
      ? await this.aggregateWithSub(query, orgId)
      : await this.resolveLabels(query.groupBy, await this.runAggregation(query, orgId));

    const total = groups.reduce((acc, g) => acc + g.count, 0);

    // KPI opcional "% com justificativa": só computa (2 queries extras) quando
    // pedido — retrocompatível e sem custo quando ausente/false.
    const overdue = query.includeOverdue
      ? await this.computeOverdueCounts(orgId, query)
      : { overdueTotal: null, overduePending: null };

    this.logger.log(
      `delay_reasons_panel org=${orgId.toString()} requester=${requesterEntidadeId.toString()} ` +
        `groupBy=${query.groupBy} subGroupBy=${query.subGroupBy ?? 'none'} ` +
        `groups=${groups.length} total=${total} ` +
        `includeOverdue=${query.includeOverdue ? 'yes' : 'no'} ` +
        `overdueTotal=${overdue.overdueTotal ?? 'null'} overduePending=${overdue.overduePending ?? 'null'}`,
    );

    return {
      groupBy: query.groupBy,
      subGroupBy: query.subGroupBy ?? null,
      orgId: orgId.toString(),
      total,
      groups,
      filters: {
        userId: query.userId ?? null,
        projectId: query.projectId ?? null,
        motivoClasse: query.motivoClasse ?? null,
        from: query.from ?? null,
        to: query.to ?? null,
      },
      overdueTotal: overdue.overdueTotal,
      overduePending: overdue.overduePending,
    };
  }

  /**
   * Conta, org-wide, as tarefas ATRASADAS e quantas estão SEM justificativa
   * vigente — alimenta o KPI "% com justificativa" do painel admin.
   *
   * Escopo: tarefas COM projeto (`idProject != null`) cujo projeto pertence à
   * `orgId` (`DProject.idEstab`, `excluido=false`), respeitando os MESMOS
   * filtros da agregação que se aplicam a tarefas: `userId` (assignee),
   * `projectId` e período (`from`/`to` sobre `dueDate`, TZ Brasil).
   * `motivoClasse` NÃO se aplica aqui (é filtro de justificativa, não de tarefa).
   *
   * "Atrasada" é decidido por {@link computeOverdue} (single source of truth —
   * OPEN ou COMPLETED_LATE), avaliado em memória sobre a linha já carregada.
   *
   * **ZERO N+1 — exatamente 2 queries:** (1) `findMany` das tarefas candidatas
   * (com JOIN de tenant em `DProject`); (2) `findMany` das justificativas
   * vigentes (`DEvento -503`) do lote de atrasadas. A query 2 é pulada quando
   * não há tarefa atrasada (`pending=0`).
   *
   * @param orgId - Org-alvo já resolvida (`resolveTargetOrg`) e autorizada
   *   (`assertOrgAdmin`) pelo chamador. NÃO reautoriza aqui.
   * @param query - Filtros da requisição (usa `userId`/`projectId`/`from`/`to`).
   * @returns `{ overdueTotal, overduePending }` (ambos `number`).
   */
  private async computeOverdueCounts(
    orgId: bigint,
    query: DelayReasonsQueryDto,
  ): Promise<{ overdueTotal: number; overduePending: number }> {
    const dueDate: { not: null; gte?: Date; lte?: Date } = { not: null };
    if (query.from) {
      dueDate.gte = this.timezone.toStartOfDayBrazil(new Date(query.from));
    }
    if (query.to) {
      dueDate.lte = this.timezone.toEndOfDayBrazil(new Date(query.to));
    }

    const tasks = await this.prisma.dTask.findMany({
      where: {
        excluido: false,
        dueDate,
        idProject: { not: null },
        project: { idEstab: orgId, excluido: false },
        ...(query.userId ? { idAssignee: BigInt(query.userId) } : {}),
        ...(query.projectId ? { idProject: BigInt(query.projectId) } : {}),
      },
      select: { chave: true, dueDate: true, dados: true, atualizadoEm: true },
    });

    const overdueTaskIds = tasks
      .filter(
        (t) =>
          computeOverdue(
            { dueDate: t.dueDate, dados: parseTaskDados(t.dados), atualizadoEm: t.atualizadoEm },
            this.timezone,
          ).isOverdue,
      )
      .map((t) => t.chave.toString());

    const overdueTotal = overdueTaskIds.length;
    if (overdueTotal === 0) {
      return { overdueTotal: 0, overduePending: 0 };
    }

    const justified = await this.prisma.dEvento.findMany({
      where: {
        idClasse: ID_CLASSE_DELAY_JUSTIFICATION,
        excluido: false,
        identificadorExterno: { in: overdueTaskIds },
      },
      select: { identificadorExterno: true },
    });
    const justifiedSet = new Set(justified.map((e) => e.identificadorExterno));

    const overduePending = overdueTaskIds.filter((id) => !justifiedSet.has(id)).length;
    return { overdueTotal, overduePending };
  }

  /**
   * Agrega com CRUZAMENTO (`subGroupBy`): cada grupo do ranking primário é
   * quebrado por uma segunda dimensão em `groups[].sub`.
   *
   * Continua sendo **1 única query** de agregação (`GROUP BY groupCol, subCol`,
   * ZERO N+1) + no máximo 2 `findMany` de rótulos (uma por dimensão). O fold em
   * JS soma os subs no pai (`count`) e calcula a média PONDERADA (idêntica ao
   * `AVG` sobre as mesmas linhas). Pais e subs ordenados por `count` desc.
   *
   * @throws {BadRequestException} `subGroupBy` igual a `groupBy` (cruzamento
   *   degenerado — não faz sentido cruzar uma dimensão com ela mesma).
   */
  private async aggregateWithSub(
    query: DelayReasonsQueryDto,
    orgId: bigint,
  ): Promise<DelayReasonGroupDto[]> {
    const subGroupBy = query.subGroupBy!;
    if (subGroupBy === query.groupBy) {
      throw new BadRequestException('subGroupBy deve ser diferente de groupBy');
    }

    const rows = await this.runSubAggregation(query, orgId);

    // Conta só linhas com AMBAS as chaves resolvidas → garante `count` do pai =
    // soma exata dos subs (linha sem sub-chave não vira card e não é somável).
    const validRows = rows.filter(
      (r): r is SubAggRow & { key: string; subKey: string } => r.key !== null && r.subKey !== null,
    );

    // Agrupa por chave do pai, preservando a ordem de primeira aparição.
    const parentOrder: string[] = [];
    const parentRows = new Map<string, (SubAggRow & { subKey: string })[]>();
    for (const r of validRows) {
      if (!parentRows.has(r.key)) {
        parentRows.set(r.key, []);
        parentOrder.push(r.key);
      }
      parentRows.get(r.key)!.push(r);
    }

    // Rótulos das DUAS dimensões: 1 findMany cada (ZERO N+1).
    const parentKeys = parentOrder.map((k) => BigInt(k));
    const subKeys = [...new Set(validRows.map((r) => r.subKey))].map((k) => BigInt(k));
    const [parentLabels, subLabels] = await Promise.all([
      this.resolveLabelMap(query.groupBy, parentKeys),
      this.resolveLabelMap(subGroupBy, subKeys),
    ]);

    const groups = parentOrder.map((parentKey) => {
      const subRows = parentRows.get(parentKey)!;
      const sub = subRows
        .map((r) => ({
          key: r.subKey,
          label: subLabels.get(r.subKey) ?? null,
          count: Number(r.count),
          avgDelayDays: this.normalizeAvg(r.avgDelayDays),
        }))
        .sort((a, b) => b.count - a.count);

      return {
        key: parentKey,
        label: parentLabels.get(parentKey) ?? null,
        count: subRows.reduce((acc, r) => acc + Number(r.count), 0),
        avgDelayDays: this.weightedAvg(subRows),
        sub,
      };
    });

    return groups.sort((a, b) => b.count - a.count);
  }

  /**
   * Resolve a organização-alvo da agregação (escopo de tenant).
   *
   * - Com `projectId`: a org é a DONA do projeto (`DProject.idEstab`) — garante
   *   que o admin da org A jamais veja o projeto da org B.
   * - Sem `projectId`: a org ativa do JWT (`jwtOrgId`).
   *
   * @throws {NotFoundException} `projectId` informado não existe.
   * @throws {ForbiddenException} Projeto sem org, ou requisição sem org ativa.
   */
  private async resolveTargetOrg(projectId?: string, jwtOrgId?: string): Promise<bigint> {
    if (projectId) {
      const project = await this.prisma.dProject.findFirst({
        where: { chave: BigInt(projectId), excluido: false },
        select: { idEstab: true },
      });
      if (!project) {
        throw new NotFoundException(`Projeto ${projectId} não encontrado`);
      }
      if (!project.idEstab) {
        throw new ForbiddenException('Projeto sem organização dona; painel indisponível');
      }
      return project.idEstab;
    }

    if (!jwtOrgId) {
      throw new ForbiddenException('Organização ativa ausente no token');
    }
    return BigInt(jwtOrgId);
  }

  /**
   * Garante que o requester é org ADMIN (-161) da org-alvo. 403 caso contrário.
   * NUNCA usa `getProjectRole`/MANAGER (CEO decisão 3).
   */
  private async assertOrgAdmin(requesterEntidadeId: bigint, orgId: bigint): Promise<void> {
    const role = await this.roleResolver.getOrgRole(requesterEntidadeId, orgId);
    if (role !== 'ADMIN') {
      this.logger.warn(
        `delay_reasons_denied requester=${requesterEntidadeId.toString()} ` +
          `org=${orgId.toString()} role=${role ?? 'null'}`,
      );
      throw new ForbiddenException(
        'Apenas ADMIN da organização pode acessar o painel de motivos de atraso',
      );
    }
  }

  /**
   * Monta o fragmento `WHERE` dos filtros opcionais (autor/projeto/motivo/
   * período) como bind params — ZERO interpolação de input do cliente. O escopo
   * de org e o `idClasse` ficam fora daqui (fixos em cada query).
   */
  private buildFilters(query: DelayReasonsQueryDto): Prisma.Sql {
    const filters: Prisma.Sql[] = [];
    if (query.userId) {
      filters.push(Prisma.sql`e."idEntidade" = ${BigInt(query.userId)}`);
    }
    if (query.projectId) {
      filters.push(Prisma.sql`(e."metaDados" ->> 'projetoId') = ${query.projectId}`);
    }
    if (query.motivoClasse) {
      filters.push(Prisma.sql`(e."metaDados" ->> 'motivoClasse') = ${query.motivoClasse}`);
    }
    if (query.from) {
      const gte = this.timezone.toStartOfDayBrazil(new Date(query.from));
      filters.push(Prisma.sql`e."criadoEm" >= ${gte}`);
    }
    if (query.to) {
      const lte = this.timezone.toEndOfDayBrazil(new Date(query.to));
      filters.push(Prisma.sql`e."criadoEm" <= ${lte}`);
    }
    return filters.length ? Prisma.join(filters, ' AND ', ' AND ', '') : Prisma.empty;
  }

  /**
   * Executa a agregação simples (1 query `$queryRaw`, ZERO N+1).
   *
   * Whitelist de coluna de grupo via {@link GROUP_COLUMN}; filtros e escopo de
   * org como bind params (sem injeção). `INNER JOIN DProject` aplica o escopo
   * de tenant e exclui justificativas de tasks sem projeto.
   */
  private async runAggregation(query: DelayReasonsQueryDto, orgId: bigint): Promise<AggRow[]> {
    const groupCol = GROUP_COLUMN[query.groupBy];
    const where = this.buildFilters(query);

    return this.prisma.$queryRaw<AggRow[]>(Prisma.sql`
      SELECT
        ${groupCol} AS "key",
        COUNT(*)::int AS "count",
        AVG((e."metaDados" ->> 'delayDays')::numeric) AS "avgDelayDays"
      FROM "DEvento" e
      INNER JOIN "DProject" p
        ON p."chave" = (e."metaDados" ->> 'projetoId')::bigint
       AND p."excluido" = false
      WHERE e."idClasse" = ${ID_CLASSE_DELAY_JUSTIFICATION}
        AND e."excluido" = false
        AND p."idEstab" = ${orgId}
        ${where}
      GROUP BY ${groupCol}
      ORDER BY "count" DESC
    `);
  }

  /**
   * Executa a agregação CRUZADA (1 query `$queryRaw`, ZERO N+1).
   *
   * Ambas as colunas (`groupCol`/`subCol`) vêm da whitelist {@link GROUP_COLUMN}
   * — NUNCA de string do cliente. `GROUP BY groupCol, subCol` produz a matriz
   * (pai × sub) numa única query; o fold em JS soma os subs no pai.
   */
  private async runSubAggregation(
    query: DelayReasonsQueryDto,
    orgId: bigint,
  ): Promise<SubAggRow[]> {
    const groupCol = GROUP_COLUMN[query.groupBy];
    const subCol = GROUP_COLUMN[query.subGroupBy!];
    const where = this.buildFilters(query);

    return this.prisma.$queryRaw<SubAggRow[]>(Prisma.sql`
      SELECT
        ${groupCol} AS "key",
        ${subCol} AS "subKey",
        COUNT(*)::int AS "count",
        AVG((e."metaDados" ->> 'delayDays')::numeric) AS "avgDelayDays"
      FROM "DEvento" e
      INNER JOIN "DProject" p
        ON p."chave" = (e."metaDados" ->> 'projetoId')::bigint
       AND p."excluido" = false
      WHERE e."idClasse" = ${ID_CLASSE_DELAY_JUSTIFICATION}
        AND e."excluido" = false
        AND p."idEstab" = ${orgId}
        ${where}
      GROUP BY ${groupCol}, ${subCol}
      ORDER BY COUNT(*) DESC
    `);
  }

  /**
   * Resolve os rótulos legíveis dos grupos em 1 query batch (ZERO N+1).
   *
   * - `motivo` → `DClasse.nome` (chave in keys).
   * - `usuario` → `DEntidade.nome`.
   * - `projeto` → `DProject.nome`.
   *
   * @param groupBy - Dimensão (define a tabela de rótulos).
   * @param rows - Linhas cruas da agregação.
   * @returns Grupos com `label`, `count` e `avgDelayDays` normalizados.
   */
  private async resolveLabels(
    groupBy: DelayReasonsGroupBy,
    rows: AggRow[],
  ): Promise<DelayReasonGroupDto[]> {
    const validRows = rows.filter((r): r is AggRow & { key: string } => r.key !== null);
    const keys = validRows.map((r) => BigInt(r.key));
    const labelMap = await this.resolveLabelMap(groupBy, keys);

    return validRows.map((r) => ({
      key: r.key,
      label: labelMap.get(r.key) ?? null,
      count: Number(r.count),
      avgDelayDays: this.normalizeAvg(r.avgDelayDays),
    }));
  }

  /**
   * Resolve os rótulos legíveis de UMA dimensão em 1 query batch (ZERO N+1).
   *
   * Mapa dimensão → tabela: `motivo` → `DClasse.nome`, `usuario` →
   * `DEntidade.nome`, `projeto` → `DProject.nome`. Chamado uma vez por dimensão
   * (no cruzamento, 2 vezes → no máximo 2 `findMany`).
   *
   * @param dimension - Dimensão a resolver (define a tabela de rótulos).
   * @param keys - Chaves (`DClasse`/`DEntidade`/`DProject`) a rotular.
   * @returns Mapa `chave.toString()` → nome (vazio se `keys` vazio).
   */
  private async resolveLabelMap(
    dimension: DelayReasonsGroupBy,
    keys: bigint[],
  ): Promise<Map<string, string>> {
    const labelMap = new Map<string, string>();
    if (keys.length === 0) {
      return labelMap;
    }

    if (dimension === 'motivo') {
      const classes = await this.prisma.dClasse.findMany({
        where: { chave: { in: keys } },
        select: { chave: true, nome: true },
      });
      classes.forEach((c) => labelMap.set(c.chave.toString(), c.nome));
    } else if (dimension === 'usuario') {
      const users = await this.prisma.dEntidade.findMany({
        where: { chave: { in: keys } },
        select: { chave: true, nome: true },
      });
      users.forEach((u) => labelMap.set(u.chave.toString(), u.nome ?? ''));
    } else {
      const projects = await this.prisma.dProject.findMany({
        where: { chave: { in: keys } },
        select: { chave: true, nome: true },
      });
      projects.forEach((p) => labelMap.set(p.chave.toString(), p.nome));
    }

    return labelMap;
  }

  /**
   * Média PONDERADA de `avgDelayDays` das linhas-sub de um pai:
   * `Σ(count · avg) / Σ(count)`, considerando SÓ subs com `avg` não-nulo (no
   * numerador e no denominador). Usa o `avg` CRU de cada sub (não o arredondado)
   * → matematicamente idêntico ao `AVG` sobre as mesmas linhas. Normaliza o
   * resultado final a 1 casa. `null` se nenhum sub tiver amostra válida.
   */
  private weightedAvg(rows: SubAggRow[]): number | null {
    let weighted = 0;
    let counted = 0;
    for (const r of rows) {
      if (r.avgDelayDays === null || r.avgDelayDays === undefined) {
        continue;
      }
      const avg = Number(r.avgDelayDays);
      if (Number.isNaN(avg)) {
        continue;
      }
      weighted += Number(r.count) * avg;
      counted += Number(r.count);
    }
    if (counted === 0) {
      return null;
    }
    return this.normalizeAvg(String(weighted / counted));
  }

  /**
   * Normaliza a média de `AVG(numeric)` (string | null do driver) → number | null
   * com 1 casa decimal.
   */
  private normalizeAvg(raw: string | null): number | null {
    if (raw === null || raw === undefined) {
      return null;
    }
    const value = Number(raw);
    if (Number.isNaN(value)) {
      return null;
    }
    return Math.round(value * 10) / 10;
  }
}

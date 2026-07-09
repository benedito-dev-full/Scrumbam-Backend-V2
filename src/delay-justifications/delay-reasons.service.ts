import { ForbiddenException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma.service';
import { TimezoneService } from '../common/services/timezone.service';
import { RoleResolverService } from '../auth/services/role-resolver.service';
import { DelayReasonsGroupBy, DelayReasonsQueryDto } from './dto/delay-reasons-query.dto';
import { DelayReasonGroupDto, DelayReasonsResponseDto } from './dto/delay-reasons-response.dto';

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

    const rows = await this.runAggregation(query, orgId);
    const groups = await this.resolveLabels(query.groupBy, rows);
    const total = groups.reduce((acc, g) => acc + g.count, 0);

    this.logger.log(
      `delay_reasons_panel org=${orgId.toString()} requester=${requesterEntidadeId.toString()} ` +
        `groupBy=${query.groupBy} groups=${groups.length} total=${total}`,
    );

    return {
      groupBy: query.groupBy,
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
    };
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
   * Executa a agregação (1 query `$queryRaw`, ZERO N+1).
   *
   * Whitelist de coluna de grupo via {@link GROUP_COLUMN}; filtros e escopo de
   * org como bind params (sem injeção). `INNER JOIN DProject` aplica o escopo
   * de tenant e exclui justificativas de tasks sem projeto.
   */
  private async runAggregation(query: DelayReasonsQueryDto, orgId: bigint): Promise<AggRow[]> {
    const groupCol = GROUP_COLUMN[query.groupBy];

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

    const where = filters.length ? Prisma.join(filters, ' AND ', ' AND ', '') : Prisma.empty;

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

    const labelMap = new Map<string, string>();
    if (keys.length > 0) {
      if (groupBy === 'motivo') {
        const classes = await this.prisma.dClasse.findMany({
          where: { chave: { in: keys } },
          select: { chave: true, nome: true },
        });
        classes.forEach((c) => labelMap.set(c.chave.toString(), c.nome));
      } else if (groupBy === 'usuario') {
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
    }

    return validRows.map((r) => ({
      key: r.key,
      label: labelMap.get(r.key) ?? null,
      count: Number(r.count),
      avgDelayDays: this.normalizeAvg(r.avgDelayDays),
    }));
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

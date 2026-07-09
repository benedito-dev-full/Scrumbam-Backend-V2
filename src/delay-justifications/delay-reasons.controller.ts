import { Controller, Get, Logger, Query, Request, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AuthCompositeGuard } from '../auth/guards/auth-composite.guard';
import { DelayReasonsService } from './delay-reasons.service';
import { DelayReasonsQueryDto } from './dto/delay-reasons-query.dto';
import { DelayReasonsResponseDto } from './dto/delay-reasons-response.dto';

/**
 * Shape do `req.user` injetado pelo `AuthCompositeGuard`. `entidadeId` já é a
 * `DEntidade.chave` do usuário; `organizationId` é a org ativa do token.
 */
interface JwtRequest {
  user: { entidadeId: string; organizationId?: string };
}

/**
 * Controller do painel admin de motivos de atraso (Fase 2 — ADR-V2-070).
 *
 * `GET /reports/delay-reasons` — agregação (por motivo/usuário/projeto) das
 * justificativas vigentes da organização. **Acesso: org ADMIN (-161) SOMENTE**
 * (CEO decisão 3) — o RBAC fino (org-alvo + role) vive no service.
 *
 * Mora no módulo `delay-justifications` (e não em `reports`) por coesão: o
 * conhecimento do payload de `DEvento -503` fica num único lugar. A rota
 * `reports/delay-reasons` é declarada explicitamente (padrão dos outros
 * endpoints deste módulo, que usam `@Controller()` + path completo).
 *
 * @see DelayReasonsService — agregação `$queryRaw`, escopo de org e RBAC.
 */
@ApiTags('delay-justifications')
@ApiBearerAuth()
@UseGuards(AuthCompositeGuard)
@Controller()
export class DelayReasonsController {
  private readonly logger = new Logger(DelayReasonsController.name);

  constructor(private readonly service: DelayReasonsService) {}

  /**
   * Agrega os motivos de atraso da organização para o painel admin.
   *
   * A org-alvo é a org DONA do `projectId` (quando filtrado) ou a org ativa do
   * JWT. Só ADMIN (-161) dessa org acessa (403 caso contrário).
   *
   * @param query - Filtros (`userId`, `projectId`, `motivoClasse`, `from`, `to`)
   *   + `groupBy` (obrigatório: `motivo` | `usuario` | `projeto`).
   * @param req - Request com `user.entidadeId` e `user.organizationId`.
   * @returns Ranking agregado (`total` + `groups[]` ordenado por `count` desc).
   *
   * @throws {ForbiddenException} Requester não é org ADMIN da org-alvo (403).
   * @throws {NotFoundException} `projectId` informado não existe (404).
   *
   * @example
   * ```bash
   * curl "http://localhost:3000/reports/delay-reasons?groupBy=motivo&from=2026-07-01" \
   *   -H "Authorization: Bearer ..."
   * ```
   */
  @Get('reports/delay-reasons')
  @ApiOperation({
    summary: 'Painel admin: agregação de motivos de atraso',
    description:
      'Conta justificativas vigentes (DEvento -503) da organização, agrupadas por ' +
      'motivo/usuário/projeto, com filtros. Acesso: org ADMIN (-161) SOMENTE.',
  })
  @ApiQuery({ name: 'groupBy', required: true, enum: ['motivo', 'usuario', 'projeto'] })
  @ApiQuery({ name: 'userId', required: false, description: 'Filtro por autor (DEntidade.chave)' })
  @ApiQuery({
    name: 'projectId',
    required: false,
    description: 'Filtro por projeto (DProject.chave)',
  })
  @ApiQuery({
    name: 'motivoClasse',
    required: false,
    description: 'Filtro por motivo (-531..-537)',
  })
  @ApiQuery({ name: 'from', required: false, description: 'Início do período (ISO 8601)' })
  @ApiQuery({ name: 'to', required: false, description: 'Fim do período (ISO 8601)' })
  @ApiResponse({ status: 200, description: 'Ranking agregado', type: DelayReasonsResponseDto })
  @ApiResponse({ status: 401, description: 'Não autenticado' })
  @ApiResponse({ status: 403, description: 'Não é org ADMIN da organização' })
  @ApiResponse({ status: 404, description: 'projectId informado não existe' })
  async getDelayReasons(
    @Query() query: DelayReasonsQueryDto,
    @Request() req: JwtRequest,
  ): Promise<DelayReasonsResponseDto> {
    this.logger.log(
      `GET /reports/delay-reasons — user=${req.user.entidadeId} groupBy=${query.groupBy}`,
    );
    return this.service.aggregate(query, BigInt(req.user.entidadeId), req.user.organizationId);
  }
}

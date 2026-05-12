import { Body, Controller, Get, HttpCode, Logger, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle, ThrottlerGuard } from '@nestjs/throttler';
import { ApiOperation, ApiParam, ApiResponse, ApiTags } from '@nestjs/swagger';

import { InvitesService } from './invites.service';
import { CreateInviteDto } from './dto/create-invite.dto';
import { AcceptInviteDto } from './dto/accept-invite.dto';
import { InviteInfoDto } from './dto/invite-info.dto';
import { AcceptInviteResponseDto } from './dto/accept-invite-response.dto';
import { PendingInviteDto } from './dto/pending-invite.dto';

import { AuthCompositeGuard } from '../auth/guards/auth-composite.guard';
import { CurrentUser, JwtPayload } from '../auth/decorators/current-user.decorator';

/**
 * Controller de convites por email (ADR-V2-028).
 *
 * Tres endpoints com niveis de auth distintos:
 *
 * | Endpoint                                  | Auth                          | Rate limit  |
 * |-------------------------------------------|-------------------------------|-------------|
 * | POST /organizations/:orgId/invites        | JWT + ADMIN da org (service)  | 3/min/ip    |
 * | GET  /invites/:token                      | Publico                       | -           |
 * | POST /invites/:token/accept               | Publico                       | -           |
 *
 * Anti-enumeracao: GET e POST/accept retornam 404 identico para
 * token invalido/expirado/usado. NUNCA revelam motivo especifico para
 * chamador nao autenticado.
 *
 * O token raw NUNCA aparece em logs — somente o hash ou o inviteId.
 */
@ApiTags('invites')
@Controller()
export class InvitesController {
  private readonly logger = new Logger(InvitesController.name);

  constructor(private readonly invitesService: InvitesService) {}

  /**
   * Cria convite para novo membro da organizacao.
   *
   * Requer ADMIN da org (validado no service via DVincula -161).
   * Rate limit: 3 requisicoes por minuto.
   *
   * @param orgId - Chave BigInt da org (path param).
   * @param dto - email + role.
   * @param user - JWT payload (extraido do token).
   * @returns 201 com `{ id, email, role, expiresAt }`.
   *
   * @throws {UnauthorizedException} Sem auth.
   * @throws {ForbiddenException} Nao e ADMIN.
   * @throws {NotFoundException} Org inexistente.
   * @throws {ConflictException} Email ja e membro / convite pendente existe.
   *
   * @example
   * ```bash
   * curl -X POST https://api.scrumban.com.br/organizations/100/invites \
   *   -H "Authorization: Bearer <jwt>" \
   *   -H "Content-Type: application/json" \
   *   -d '{"email":"convidado@x.com","role":"MEMBER"}'
   * ```
   */
  @Post('organizations/:orgId/invites')
  @UseGuards(AuthCompositeGuard, ThrottlerGuard)
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @ApiOperation({
    summary: 'Cria convite por email (ADMIN da org)',
    description:
      'Gera token (hash SHA-256 em DTabela -476), envia email com link e emite DEvento -502 para audit. Rate limit: 3/min.',
  })
  @ApiParam({ name: 'orgId', description: 'Chave BigInt da organizacao' })
  @ApiResponse({ status: 201, description: 'Convite criado e email disparado' })
  @ApiResponse({ status: 401, description: 'Nao autenticado' })
  @ApiResponse({ status: 403, description: 'Nao e ADMIN' })
  @ApiResponse({ status: 404, description: 'Org nao encontrada' })
  @ApiResponse({ status: 409, description: 'Email ja e membro / convite pendente existe' })
  @ApiResponse({ status: 429, description: 'Rate limit atingido' })
  async create(
    @Param('orgId') orgId: string,
    @Body() dto: CreateInviteDto,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ id: string; email: string; role: 'MEMBER' | 'VIEWER'; expiresAt: string }> {
    this.logger.log(
      `POST /organizations/${orgId}/invites email=${dto.email.toLowerCase()} role=${dto.role} inviter=${user.entidadeId}`,
    );
    return this.invitesService.createInvite(orgId, dto, BigInt(user.entidadeId));
  }

  /**
   * Lista convites pendentes da organizacao (ADMIN).
   *
   * Retorna apenas convites em status PENDING e nao expirados, sem dados
   * sensiveis (tokenHash NUNCA exposto). Validacao de ADMIN no service.
   *
   * @example
   * ```bash
   * curl https://api.scrumban.com.br/api/v1/organizations/100/invites \
   *   -H "Authorization: Bearer <jwt>"
   * ```
   */
  @Get('organizations/:orgId/invites')
  @UseGuards(AuthCompositeGuard)
  @ApiOperation({
    summary: 'Lista convites pendentes da organizacao (ADMIN)',
    description: 'Retorna PENDING + nao expirados. NAO expoe tokenHash.',
  })
  @ApiParam({ name: 'orgId', description: 'Chave BigInt da organizacao' })
  @ApiResponse({ status: 200, description: 'Lista de convites pendentes', type: [PendingInviteDto] })
  @ApiResponse({ status: 401, description: 'Nao autenticado' })
  @ApiResponse({ status: 403, description: 'Nao e ADMIN' })
  @ApiResponse({ status: 404, description: 'Org nao encontrada' })
  async listPending(
    @Param('orgId') orgId: string,
    @CurrentUser() user: JwtPayload,
  ): Promise<{ invites: PendingInviteDto[] }> {
    const invites = await this.invitesService.listPendingInvites(orgId, BigInt(user.entidadeId));
    return { invites };
  }

  /**
   * Retorna info publica do convite por token.
   *
   * Publico (sem auth). 404 identico para invalido/expirado/usado
   * (anti-enumeracao).
   *
   * @param token - Token raw (path param).
   * @returns InviteInfoDto sanitizado.
   *
   * @throws {NotFoundException} Token invalido/expirado/usado.
   *
   * @example
   * ```bash
   * curl https://api.scrumban.com.br/invites/Tk9-XXXXXX
   * ```
   */
  @Get('invites/:token')
  @ApiOperation({
    summary: 'Retorna info publica do convite (publico)',
    description:
      'Resposta sanitizada — sem hash, sem ids internos. 404 identico para qualquer falha (anti-enumeracao).',
  })
  @ApiParam({ name: 'token', description: 'Token raw do convite (base64url)' })
  @ApiResponse({ status: 200, description: 'Info do convite', type: InviteInfoDto })
  @ApiResponse({ status: 404, description: 'Convite invalido/expirado/usado' })
  async getInfo(@Param('token') token: string): Promise<InviteInfoDto> {
    // NUNCA logar o token raw — apenas a chamada generica.
    this.logger.debug('GET /invites/:token');
    return this.invitesService.getInviteByToken(token);
  }

  /**
   * Aceita convite e completa onboarding com auto-login.
   *
   * Publico (sem auth). Cria DUserGroup + DEntidade + DVincula em
   * $transaction atomica + audit + auto-login (JWT + refresh).
   *
   * @param token - Token raw (path param).
   * @param dto - name + password.
   * @returns 201 com tokens + perfil + redirectTo.
   *
   * @throws {NotFoundException} Token invalido/expirado/usado.
   * @throws {ConflictException} Email virou user entre GET e POST.
   *
   * @example
   * ```bash
   * curl -X POST https://api.scrumban.com.br/invites/Tk9-XXXXXX/accept \
   *   -H "Content-Type: application/json" \
   *   -d '{"name":"Maria","password":"senha123"}'
   * ```
   */
  @Post('invites/:token/accept')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Aceita convite e completa onboarding (publico)',
    description:
      'Workflow: $transaction (DUserGroup + DEntidade + DVincula + UPDATE DTabela + DEvento) + auto-login (JWT + refresh) fora da tx.',
  })
  @ApiParam({ name: 'token', description: 'Token raw do convite' })
  @ApiResponse({
    status: 201,
    description: 'Conta criada + auto-login realizado',
    type: AcceptInviteResponseDto,
  })
  @ApiResponse({ status: 404, description: 'Convite invalido/expirado/usado' })
  @ApiResponse({ status: 409, description: 'Email ja registrado entre GET e POST' })
  async accept(
    @Param('token') token: string,
    @Body() dto: AcceptInviteDto,
  ): Promise<AcceptInviteResponseDto> {
    // NUNCA logar token raw — somente o evento de acept (sem token no payload).
    this.logger.log(`POST /invites/:token/accept name="${dto.name}"`);
    return this.invitesService.acceptInvite(token, dto);
  }
}

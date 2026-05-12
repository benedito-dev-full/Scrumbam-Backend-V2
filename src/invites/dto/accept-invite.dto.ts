import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DTO para aceitar convite e completar onboarding.
 *
 * Usado em `POST /invites/:token/accept` (publico).
 *
 * Os campos sao opcionais no DTO porque o aceite tem dois fluxos
 * (ADR-V2-030 — multi-tenant identity):
 *
 * - `flow=new_user`: email nao tem conta ainda. `name` e `password` sao
 *   OBRIGATORIOS — o service os valida e cria DUserGroup + DEntidade.
 * - `flow=existing_user`: email ja tem DEntidade -150 em outra org. O accept
 *   apenas cria DVincula (merge). `name` e `password` sao IGNORADOS (loga
 *   warn se presentes). O fluxo e identificado pelo `metaDados.flow` do
 *   DTabela -476 ja persistido — o frontend tambem ve isso via
 *   `GET /invites/:token`.
 *
 * Validacoes (quando presentes):
 * - name: 2-100 chars (DEntidade.nome).
 * - password: minimo 8 caracteres (mesma policy do `RegisterDto`).
 *
 * O email do novo usuario vem do proprio convite (DTabela.nome). O token
 * em path param e usado para localizar o convite (via hash SHA-256).
 *
 * @example
 * ```typescript
 * // Fluxo new_user (cria conta)
 * const dto: AcceptInviteDto = {
 *   name: 'Maria Souza',
 *   password: 'senha123',
 * };
 *
 * // Fluxo existing_user (merge — body vazio aceito)
 * const dto: AcceptInviteDto = {};
 * ```
 */
export class AcceptInviteDto {
  /**
   * Nome completo do novo usuario (DEntidade.nome + DUserGroup.nome).
   *
   * OBRIGATORIO no fluxo `new_user`. Ignorado no fluxo `existing_user`.
   * Validacao final acontece no service apos resolver o `flow`.
   */
  @ApiPropertyOptional({
    description: 'Nome completo do novo usuario (obrigatorio em flow=new_user)',
    example: 'Maria Souza',
    minLength: 2,
    maxLength: 100,
  })
  @IsOptional()
  @IsString()
  @MinLength(2, { message: 'Nome deve ter no minimo 2 caracteres' })
  @MaxLength(100, { message: 'Nome deve ter no maximo 100 caracteres' })
  name?: string;

  /**
   * Senha em texto plano — sera hashada com bcrypt rounds=12.
   *
   * OBRIGATORIO no fluxo `new_user`. Ignorado no fluxo `existing_user`
   * (user ja tem credenciais validas em DUserGroup).
   */
  @ApiPropertyOptional({
    description: 'Senha (minimo 8 caracteres) — obrigatorio em flow=new_user',
    example: 'senha123',
    minLength: 8,
  })
  @IsOptional()
  @IsString()
  @MinLength(8, { message: 'Senha deve ter no minimo 8 caracteres' })
  password?: string;
}

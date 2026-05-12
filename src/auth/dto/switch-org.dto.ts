import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/**
 * DTO para `POST /auth/switch-org` (ADR-V2-030).
 *
 * Permite a um usuario com multiplos vinculos (DVincula -161/-162/-163)
 * trocar a organizacao "ativa" da sessao sem precisar fazer logout/login.
 *
 * Pos-switch o backend emite um novo par de tokens (access + refresh
 * rotacionado) com `organizationId` apontando para a org de destino. O
 * frontend salva os novos tokens e invalida o cache de queries.
 *
 * Validacao:
 * - `organizationId` deve ser uma string inteira (positiva ou negativa).
 *   Aceita negativo porque DEntidade.chave canonicas podem ser negativas
 *   (seeds). O service valida que existe DVincula ativo para o usuario.
 *
 * @example
 * ```typescript
 * const dto: SwitchOrgDto = { organizationId: '152' };
 * ```
 */
export class SwitchOrgDto {
  /**
   * Chave BigInt da organizacao alvo (string serializada).
   *
   * Deve corresponder a uma DEntidade (-152) onde o usuario autenticado
   * tem DVincula ativo (-161/-162/-163). Caso contrario, 403.
   */
  @ApiProperty({
    description: 'Chave da DEntidade(-152) da organizacao alvo (string)',
    example: '152',
  })
  @IsString()
  @Matches(/^-?\d+$/, { message: 'organizationId deve ser um inteiro em string' })
  organizationId!: string;
}

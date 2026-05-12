import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Resumo de uma organizacao a qual o usuario tem vinculo ativo.
 *
 * Usado para popular `UserProfileDto.availableOrgs[]`. O frontend renderiza
 * essa lista no workspace switcher (ADR-V2-030). Cada item representa uma
 * DVincula (-161/-162/-163) ativa do usuario.
 *
 * @example
 * ```json
 * { "id": "152", "nome": "Devari", "role": "ADMIN" }
 * ```
 */
export class AvailableOrgDto {
  /** Chave BigInt da DEntidade(-152) (string). */
  @ApiProperty({ description: 'ID da organizacao', example: '152' })
  id!: string;

  /** Nome publico da organizacao. */
  @ApiProperty({ description: 'Nome da organizacao', example: 'Devari' })
  nome!: string;

  /** Role do usuario na org (derivado do idClasse da DVincula). */
  @ApiProperty({
    description: 'Role do usuario nesta org',
    example: 'ADMIN',
    enum: ['ADMIN', 'MEMBER', 'VIEWER'],
  })
  role!: 'ADMIN' | 'MEMBER' | 'VIEWER';
}

/**
 * Perfil mínimo do usuário embutido no AuthResponseDto.
 *
 * IDs como string (BigInt serializado). Frontend usa chave para
 * chamadas subsequentes à API.
 */
export class UserProfileDto {
  /** Chave BigInt da DUserGroup (string). */
  @ApiProperty({ description: 'ID do DUserGroup', example: '1' })
  id!: string;

  /** Chave BigInt da DEntidade (-150 USER) (string). */
  @ApiProperty({ description: 'ID da DEntidade (USER)', example: '2' })
  entidadeId!: string;

  /** Email do usuário. */
  @ApiProperty({ description: 'Email', example: 'joao@empresa.com' })
  email!: string;

  /** Nome completo. */
  @ApiProperty({ description: 'Nome completo', example: 'João Silva' })
  name!: string;

  /** Chave BigInt da organização padrão (string). */
  @ApiPropertyOptional({ description: 'ID da organização padrão', example: '3' })
  organizationId?: string;

  /** Nome da organização padrão. */
  @ApiPropertyOptional({ description: 'Nome da organização padrão', example: 'Empresa ABC' })
  organizationName?: string;

  /** Role do usuário na organização padrão. */
  @ApiPropertyOptional({
    description: 'Role na org',
    example: 'ADMIN',
    enum: ['ADMIN', 'MEMBER', 'VIEWER'],
  })
  orgRole?: string;

  /**
   * Lista de organizacoes que o usuario tem acesso (ADR-V2-030).
   *
   * Contem TODAS as DVinculas ativas do usuario (-161/-162/-163). Populado
   * em `GET /auth/me` e nos retornos de `login`/`register`/`switch-org`.
   * O frontend usa para renderizar o workspace switcher.
   *
   * Quando o usuario so tem 1 org, esse array tem 1 elemento e a UI omite
   * o dropdown (fallback: mostra so o nome da org).
   */
  @ApiPropertyOptional({
    description: 'Organizacoes com vinculo ativo do usuario',
    type: () => [AvailableOrgDto],
  })
  availableOrgs?: AvailableOrgDto[];
}

/**
 * DTO de resposta para login, register e refresh.
 *
 * @example
 * ```json
 * {
 *   "accessToken": "eyJ...",
 *   "refreshToken": "abc123...",
 *   "expiresIn": 900,
 *   "tokenType": "Bearer",
 *   "user": { "id": "1", "email": "joao@empresa.com", "name": "João Silva" }
 * }
 * ```
 */
export class AuthResponseDto {
  /** JWT access token (expira em 15min por padrão). */
  @ApiProperty({ description: 'JWT access token', example: 'eyJhbGciOiJIUzI1NiJ9...' })
  accessToken!: string;

  /**
   * Refresh token (plaintext — armazenado como hash SHA-256 no banco).
   * Guardar com segurança — exibido UMA vez, não recuperável.
   */
  @ApiProperty({
    description: 'Refresh token (rotativo — guardar com segurança)',
    example: 'abc123...',
  })
  refreshToken!: string;

  /** Tempo de expiração do access token em segundos (ex: 900 = 15min). */
  @ApiProperty({ description: 'Expiração do access token em segundos', example: 900 })
  expiresIn!: number;

  /** Tipo do token (sempre "Bearer"). */
  @ApiProperty({ description: 'Tipo do token', example: 'Bearer' })
  tokenType!: 'Bearer';

  /** Perfil do usuário autenticado. */
  @ApiProperty({ description: 'Perfil do usuário', type: UserProfileDto })
  user!: UserProfileDto;
}

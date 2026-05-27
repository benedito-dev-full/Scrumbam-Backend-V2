import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsOptional, IsString, MaxLength, ValidateNested } from 'class-validator';

/**
 * Preferências de aparência da UI do usuário.
 *
 * Subobjeto opcional dentro de `UserPreferencesDto`. Cada campo é
 * individualmente opcional — o frontend deve aplicar defaults sensatos
 * quando ausente (`theme='system'`, `density='normal'`).
 *
 * @example
 * ```typescript
 * const appearance: UserAppearancePreferencesDto = {
 *   theme: 'dark',
 *   density: 'compact',
 *   accent: '#6366F1',
 * };
 * ```
 */
export class UserAppearancePreferencesDto {
  /**
   * Tema visual da UI.
   *
   * `system` segue a preferência do SO (default sugerido no frontend).
   */
  @ApiPropertyOptional({
    description: 'Tema visual (light/dark/system)',
    enum: ['light', 'dark', 'system'],
    example: 'dark',
  })
  @IsOptional()
  @IsIn(['light', 'dark', 'system'])
  theme?: 'light' | 'dark' | 'system';

  /**
   * Densidade da UI (espaçamento entre elementos).
   */
  @ApiPropertyOptional({
    description: 'Densidade da UI',
    enum: ['compact', 'normal', 'cozy'],
    example: 'normal',
  })
  @IsOptional()
  @IsIn(['compact', 'normal', 'cozy'])
  density?: 'compact' | 'normal' | 'cozy';

  /**
   * Cor de destaque (accent color) — hex ou CSS var.
   *
   * Limite de 32 caracteres acomoda valores `#RRGGBB`, `rgb(...)` e
   * variáveis CSS curtas. Validação semântica (hex válido) fica no
   * frontend para não bloquear formatos legítimos futuros.
   */
  @ApiPropertyOptional({
    description: 'Cor de destaque (accent) em hex ou CSS',
    example: '#6366F1',
    maxLength: 32,
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  accent?: string;
}

/**
 * Preferências de localização do usuário (idioma, timezone, formato de data).
 *
 * Todos os campos são opcionais — frontend aplica defaults se ausente.
 *
 * @example
 * ```typescript
 * const locale: UserLocalePreferencesDto = {
 *   language: 'pt-BR',
 *   timezone: 'America/Sao_Paulo',
 *   dateFormat: 'dd/MM/yyyy',
 * };
 * ```
 */
export class UserLocalePreferencesDto {
  /**
   * Idioma da UI (BCP-47).
   */
  @ApiPropertyOptional({
    description: 'Idioma (BCP-47)',
    example: 'pt-BR',
    maxLength: 10,
  })
  @IsOptional()
  @IsString()
  @MaxLength(10)
  language?: string;

  /**
   * Timezone do usuário (IANA).
   */
  @ApiPropertyOptional({
    description: 'Timezone (IANA)',
    example: 'America/Sao_Paulo',
    maxLength: 64,
  })
  @IsOptional()
  @IsString()
  @MaxLength(64)
  timezone?: string;

  /**
   * Formato de data preferido (token usado pelo frontend).
   */
  @ApiPropertyOptional({
    description: 'Formato de data',
    example: 'dd/MM/yyyy',
    maxLength: 32,
  })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  dateFormat?: string;
}

/**
 * Preferências de notificações do usuário (canais e gatilhos).
 *
 * Controla quando e como o usuário recebe notificações. Cada flag é
 * independente — o backend de notificações consulta este bloco antes
 * de disparar (logica fora do escopo desta task).
 *
 * @example
 * ```typescript
 * const notifications: UserNotificationsPreferencesDto = {
 *   emailOnMention: true,
 *   emailDigest: false,
 *   inAppEnabled: true,
 * };
 * ```
 */
export class UserNotificationsPreferencesDto {
  /**
   * Receber email quando mencionado em comentários/tasks.
   */
  @ApiPropertyOptional({
    description: 'Email ao ser mencionado',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  emailOnMention?: boolean;

  /**
   * Receber email digest periódico (resumo).
   */
  @ApiPropertyOptional({
    description: 'Email digest periódico',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  emailDigest?: boolean;

  /**
   * Habilitar notificações in-app (toasts/badge).
   */
  @ApiPropertyOptional({
    description: 'Notificações in-app habilitadas',
    example: true,
  })
  @IsOptional()
  @IsBoolean()
  inAppEnabled?: boolean;
}

/**
 * Preferências pessoais do usuário (armazenadas em `DEntidade.dados.preferences`).
 *
 * Cada sub-bloco é opcional e independente. O PATCH `/auth/me` substitui
 * o sub-bloco inteiro (merge por chave de 1º nível) — mandar só
 * `appearance` não toca `locale` ou `notifications`.
 *
 * Persistido no campo polimórfico `DEntidade.dados` (Json), sob a chave
 * `preferences`. Outras chaves de `dados` (defaultProjectId, defaultTeamId,
 * onboardingCompleted) permanecem na raiz e NÃO são afetadas.
 *
 * @example
 * ```typescript
 * const prefs: UserPreferencesDto = {
 *   appearance: { theme: 'dark' },
 *   locale: { language: 'pt-BR' },
 *   notifications: { inAppEnabled: true },
 * };
 * ```
 */
export class UserPreferencesDto {
  /**
   * Bloco de aparência (tema, densidade, accent).
   */
  @ApiPropertyOptional({ type: () => UserAppearancePreferencesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UserAppearancePreferencesDto)
  appearance?: UserAppearancePreferencesDto;

  /**
   * Bloco de localização (idioma, timezone, formato de data).
   */
  @ApiPropertyOptional({ type: () => UserLocalePreferencesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UserLocalePreferencesDto)
  locale?: UserLocalePreferencesDto;

  /**
   * Bloco de notificações (canais e gatilhos).
   */
  @ApiPropertyOptional({ type: () => UserNotificationsPreferencesDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => UserNotificationsPreferencesDto)
  notifications?: UserNotificationsPreferencesDto;
}

import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsHexColor,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

/**
 * Tipos de coluna customizável suportados na Table View (estilo Monday/ClickUp).
 *
 * Espelha o contrato de propósito definido pelo frontend
 * (`Scrumbam-Frontend-V2/src/lib/prototype/groups-store.ts`) e a especificação
 * da Fase 2 do plano `plan-tasks-colunas-customizaveis-8-tipos-task1.md`.
 *
 * São EXATAMENTE 8 tipos. Qualquer divergência aqui quebra o frontend
 * (risco ALTO documentado no §7 do plano).
 *
 * @remarks
 * - `text`     — texto livre (respeita `config.maxLength`).
 * - `number`   — número finito (respeita `config.decimals`/`config.currency`).
 * - `date`     — data ISO-8601.
 * - `person`   — id de uma DEntidade (responsável).
 * - `status`   — valor restrito a `config.options[].id`.
 * - `checkbox` — booleano.
 * - `dropdown` — valor restrito a `config.options[].id`.
 * - `link`     — URL.
 *
 * NOTA Fase 2: este arquivo define APENAS os tipos validados (DTOs). A validação
 * de VALORES por tipo (Fase 4) e a edição de schema via PATCH (Fase 3) NÃO fazem
 * parte deste escopo.
 */
export type ColumnType =
  | 'text'
  | 'number'
  | 'date'
  | 'person'
  | 'status'
  | 'checkbox'
  | 'dropdown'
  | 'link';

/**
 * Lista canônica dos 8 tipos de coluna, usada pelo validador `@IsIn`.
 *
 * Mantida como `readonly` para garantir que o array seja a única fonte de
 * verdade dos tipos aceitos tanto em runtime (class-validator) quanto em
 * tempo de compilação (via {@link ColumnType}).
 */
export const COLUMN_TYPES: readonly ColumnType[] = [
  'text',
  'number',
  'date',
  'person',
  'status',
  'checkbox',
  'dropdown',
  'link',
] as const;

/**
 * Moedas suportadas como meta de exibição para colunas do tipo `number`.
 *
 * É apenas metadado de apresentação — NÃO altera nem valida o valor numérico
 * gravado na célula (ver tabela de validação por tipo no §5 do plano).
 */
export type ColumnCurrency = 'BRL' | 'USD';

/** Lista canônica de moedas aceitas, usada pelo validador `@IsIn`. */
export const COLUMN_CURRENCIES: readonly ColumnCurrency[] = ['BRL', 'USD'] as const;

/**
 * Uma opção selecionável de uma coluna do tipo `status` ou `dropdown`.
 *
 * Espelha `ColumnOption` do frontend: `{ id, label, color? }`. O `id` é a chave
 * estável que será gravada em `DTask.dados.fields[<columnKey>]` quando a célula
 * for preenchida (Fase 4); `label`/`color` são meta de exibição.
 *
 * Os campos `id` e `label` são OBRIGATÓRIOS; apenas `color` é opcional.
 *
 * A unicidade de `id` entre as opções de uma mesma coluna é exigida na Fase 3
 * (edição de schema), não neste DTO.
 */
export class ColumnOptionDto {
  /**
   * Identificador estável da opção (gravado na célula da task quando selecionada).
   *
   * @example 'o_1'
   */
  @ApiProperty({
    description:
      'Identificador estável da opção, gravado na célula da task quando selecionada.',
    example: 'o_1',
  })
  @IsString()
  @MaxLength(64)
  id!: string;

  /**
   * Rótulo exibido ao usuário para a opção.
   *
   * @example 'Votorantim'
   */
  @ApiProperty({
    description: 'Rótulo exibido ao usuário para a opção.',
    example: 'Votorantim',
  })
  @IsString()
  @MaxLength(120)
  label!: string;

  /**
   * Cor de exibição da opção, em hexadecimal (`#RGB` ou `#RRGGBB`). Opcional.
   *
   * @example '#e11d48'
   */
  @ApiPropertyOptional({
    description: 'Cor de exibição da opção em hexadecimal (#RGB ou #RRGGBB).',
    example: '#e11d48',
  })
  @IsOptional()
  @IsHexColor()
  color?: string;
}

/**
 * Configuração adicional, específica por tipo, de uma coluna customizável.
 *
 * Espelha `ColumnConfig` do frontend: `{ currency?, decimals?, maxLength?, options? }`.
 * Todos os campos são opcionais; sua aplicabilidade depende do `type` da coluna:
 *
 * - `currency`/`decimals` → relevantes para `number`.
 * - `maxLength`           → relevante para `text`.
 * - `options`            → obrigatório (na prática) para `status`/`dropdown`.
 *
 * A coerência entre `type` e os campos preenchidos é validada na edição de
 * schema (Fase 3); aqui validamos apenas o FORMATO de cada campo.
 */
export class ColumnConfigDto {
  /**
   * Moeda de exibição para colunas `number` (meta de apresentação, não valida o valor).
   *
   * @example 'BRL'
   */
  @ApiPropertyOptional({
    description:
      'Moeda de exibição para colunas number (meta de apresentação, não valida o valor).',
    enum: COLUMN_CURRENCIES,
    example: 'BRL',
  })
  @IsOptional()
  @IsIn(COLUMN_CURRENCIES)
  currency?: ColumnCurrency;

  /**
   * Número de casas decimais para colunas `number` (0 a 10).
   *
   * @example 2
   */
  @ApiPropertyOptional({
    description: 'Número de casas decimais para colunas number (0 a 10).',
    minimum: 0,
    maximum: 10,
    example: 2,
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  decimals?: number;

  /**
   * Comprimento máximo permitido para colunas `text` (>= 1).
   *
   * @example 255
   */
  @ApiPropertyOptional({
    description: 'Comprimento máximo permitido para colunas text (>= 1).',
    minimum: 1,
    example: 255,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxLength?: number;

  /**
   * Lista de opções selecionáveis para colunas `status`/`dropdown`.
   *
   * Cada item é validado individualmente como {@link ColumnOptionDto}
   * (`@ValidateNested({ each: true })`). A unicidade de `id` entre as opções é
   * exigida na Fase 3.
   */
  @ApiPropertyOptional({
    description: 'Opções selecionáveis para colunas status/dropdown.',
    type: () => [ColumnOptionDto],
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ColumnOptionDto)
  options?: ColumnOptionDto[];
}

/**
 * Definição de uma coluna customizável de uma Lista (DProject idClasse=-352).
 *
 * Espelha `ColumnDef` do frontend:
 * `{ key, type, label, order, required?, config?, builtin? }`.
 *
 * O conjunto dessas definições compõe o schema persistido na COLUNA própria
 * `DProject.tableFields` (envelope {@link TableFieldsDto}). Esta task (Fase 2)
 * define apenas o DTO; a persistência via `PATCH /projects/:id` é da Fase 3.
 *
 * @remarks `key` é um slug (`^f_[a-z0-9]{2,}$`), NÃO uma chave de tabela/BigInt —
 * é o identificador da coluna usado como chave em `DTask.dados.fields[key]`.
 */
export class ColumnDefDto {
  /**
   * Slug estável da coluna no formato `f_<alfanumérico minúsculo>` (mínimo 2 chars após o prefixo).
   *
   * Usado como chave em `DTask.dados.fields[key]`. NÃO é uma chave de entidade
   * (não é BigInt); é gerado pelo cliente/servidor como identificador opaco.
   *
   * @example 'f_a1b2'
   */
  @ApiProperty({
    description:
      'Slug estável da coluna (formato f_<alfanumérico minúsculo>, mínimo 2 chars após o prefixo), usado como chave em DTask.dados.fields[key].',
    pattern: '^f_[a-z0-9]{2,}$',
    example: 'f_a1b2',
  })
  @IsString()
  @Matches(/^f_[a-z0-9]{2,}$/, {
    message:
      'key deve ser um slug no formato f_<alfanumérico minúsculo> com ao menos 2 caracteres após o prefixo (ex.: f_a1b2)',
  })
  key!: string;

  /**
   * Tipo da coluna — um dos 8 tipos canônicos ({@link ColumnType}).
   *
   * @example 'dropdown'
   */
  @ApiProperty({
    description: 'Tipo da coluna (um dos 8 tipos canônicos).',
    enum: COLUMN_TYPES,
    example: 'dropdown',
  })
  @IsIn(COLUMN_TYPES, {
    message: `type deve ser um dos tipos: ${COLUMN_TYPES.join(', ')}`,
  })
  type!: ColumnType;

  /**
   * Rótulo exibido ao usuário no cabeçalho da coluna.
   *
   * @example 'Cliente'
   */
  @ApiProperty({
    description: 'Rótulo exibido ao usuário no cabeçalho da coluna.',
    example: 'Cliente',
  })
  @IsString()
  @MaxLength(120)
  label!: string;

  /**
   * Posição da coluna na Table View (inteiro >= 0, crescente).
   *
   * A unicidade/coerência de `order` entre colunas é validada na Fase 3.
   *
   * @example 3
   */
  @ApiProperty({
    description: 'Posição da coluna na Table View (inteiro >= 0).',
    minimum: 0,
    example: 3,
  })
  @IsInt()
  @Min(0)
  order!: number;

  /**
   * Indica se a célula é obrigatória ao preencher a task. Opcional (default falso).
   *
   * Quando `true`, um valor `null`/ausente em `DTask.dados.fields[key]` deve ser
   * rejeitado com 400 na Fase 4.
   *
   * @example false
   */
  @ApiPropertyOptional({
    description: 'Se a célula é obrigatória ao preencher a task (default falso).',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  required?: boolean;

  /**
   * Configuração específica por tipo da coluna. Opcional ({@link ColumnConfigDto}).
   */
  @ApiPropertyOptional({
    description: 'Configuração específica por tipo da coluna.',
    type: () => ColumnConfigDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => ColumnConfigDto)
  config?: ColumnConfigDto;

  /**
   * Indica que a coluna é built-in (Responsável/Prioridade/Data/Status), não custom.
   *
   * Colunas built-in já gravam via campos dedicados da task; este flag apenas as
   * descreve no schema para o frontend. Opcional (default falso).
   *
   * @example false
   */
  @ApiPropertyOptional({
    description:
      'Indica coluna built-in (Responsável/Prioridade/Data/Status), não custom (default falso).',
    example: false,
  })
  @IsOptional()
  @IsBoolean()
  builtin?: boolean;
}

/**
 * Envelope versionado do schema de colunas customizáveis de uma Lista.
 *
 * É o formato canônico armazenado na COLUNA própria `DProject.tableFields`
 * (irmã de `dados`, espelhando `DClasse.tableFields`): `{ version, columns[] }`.
 *
 * O campo `version` habilita controle otimista de concorrência na edição de
 * schema (Fase 3); `columns` é a lista de definições {@link ColumnDefDto}.
 *
 * @example
 * {
 *   "version": 1,
 *   "columns": [
 *     { "key": "f_a1b2", "type": "dropdown", "label": "Cliente", "order": 3,
 *       "config": { "options": [{ "id": "o_1", "label": "Votorantim" }] } }
 *   ]
 * }
 */
export class TableFieldsDto {
  /**
   * Número de versão do schema (inteiro entre 1 e 1.000.000), para concorrência otimista.
   *
   * @example 1
   */
  @ApiProperty({
    description:
      'Número de versão do schema (entre 1 e 1.000.000), para concorrência otimista.',
    minimum: 1,
    maximum: 1000000,
    example: 1,
  })
  @IsInt()
  @Min(1)
  @Max(1000000)
  version!: number;

  /**
   * Lista de definições de coluna que compõem o schema da Lista.
   *
   * Cada item é validado individualmente como {@link ColumnDefDto}
   * (`@ValidateNested({ each: true })`). A unicidade de `key`/`order`/
   * `options.id` é exigida na Fase 3.
   */
  @ApiProperty({
    description: 'Lista de definições de coluna que compõem o schema da Lista.',
    type: () => [ColumnDefDto],
  })
  @IsArray()
  @ArrayMaxSize(200)
  @ValidateNested({ each: true })
  @Type(() => ColumnDefDto)
  columns!: ColumnDefDto[];
}

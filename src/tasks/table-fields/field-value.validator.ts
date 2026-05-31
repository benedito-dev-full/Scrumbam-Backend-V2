import { BadRequestException } from '@nestjs/common';
import { isISO8601 } from 'class-validator';
import { ColumnDefDto } from './column-def.dto';

/** Valor aceito em uma celula de coluna customizavel. */
export type FieldValue = string | number | boolean | null;

/** Valores de celulas aceitos depois da validacao, sem `null` de limpeza. */
export type PersistableFieldValue = Exclude<FieldValue, null>;

/**
 * Resultado da validacao de `DTask.dados.fields`.
 *
 * `values` contem apenas chaves existentes no schema da Lista e valores
 * persistiveis. `clearedKeys` contem chaves conhecidas recebidas como `null`,
 * que devem ser removidas do objeto persistido.
 */
export interface ValidatedFieldValues {
  values: Record<string, PersistableFieldValue>;
  clearedKeys: string[];
}

/** Tipos que restringem o valor ao conjunto `config.options[].id`. */
const OPTION_VALUE_TYPES = new Set(['status', 'dropdown']);

/**
 * Valida valores de celulas customizadas contra o schema da Lista.
 *
 * Funcao pura e testavel: nao acessa banco, nao normaliza schema e nao grava
 * dados. Chaves desconhecidas sao ignoradas para suportar corridas entre
 * frontend e backend sem poluir `DTask.dados.fields`.
 *
 * @param columns - Definicoes de colunas vindas de `DProject.tableFields.columns`.
 * @param fields - Payload recebido em `dados.fields`.
 * @returns Valores validos e chaves que devem ser limpas.
 *
 * @throws {BadRequestException} Quando uma chave conhecida recebe valor
 * incompativel com o tipo da coluna.
 *
 * @example
 * ```typescript
 * const result = validateFieldValues(
 *   [{ key: 'f_status', type: 'status', label: 'Status', order: 0,
 *      config: { options: [{ id: 'todo', label: 'A fazer' }] } }],
 *   { f_status: 'todo', f_ignorada: 'x' },
 * );
 * // result.values = { f_status: 'todo' }
 * ```
 */
export function validateFieldValues(
  columns: readonly ColumnDefDto[],
  fields: Record<string, unknown>,
): ValidatedFieldValues {
  const columnsByKey = new Map(columns.map((column) => [column.key, column]));
  const values: Record<string, PersistableFieldValue> = {};
  const clearedKeys: string[] = [];

  for (const [key, rawValue] of Object.entries(fields)) {
    const column = columnsByKey.get(key);
    if (!column) {
      continue;
    }

    if (rawValue === null) {
      if (column.required) {
        throwInvalidValue(column, 'campo obrigatorio nao pode ser limpo');
      }
      clearedKeys.push(key);
      continue;
    }

    values[key] = validateSingleValue(column, rawValue);
  }

  return { values, clearedKeys };
}

/**
 * Garante que todas as colunas obrigatorias tenham valor apos o merge.
 *
 * Deve ser chamada sobre o objeto final que sera persistido, depois de aplicar
 * os valores novos e remover as chaves recebidas como `null`.
 *
 * @param columns - Definicoes de colunas vindas de `DProject.tableFields.columns`.
 * @param mergedFields - Objeto final de `DTask.dados.fields`.
 *
 * @throws {BadRequestException} Quando uma coluna obrigatoria fica ausente ou
 * nula no resultado final.
 */
export function assertRequiredFieldValues(
  columns: readonly ColumnDefDto[],
  mergedFields: Record<string, unknown>,
): void {
  for (const column of columns) {
    if (!column.required) {
      continue;
    }

    const value = mergedFields[column.key];
    if (value === undefined || value === null) {
      throwInvalidValue(column, 'campo obrigatorio ausente');
    }
  }
}

/**
 * Valida um unico valor nao-nulo conforme o tipo da coluna.
 *
 * @param column - Definicao da coluna.
 * @param rawValue - Valor recebido para a celula.
 * @returns Valor aceito para persistencia.
 *
 * @throws {BadRequestException} Quando o valor viola o tipo/configuracao.
 */
function validateSingleValue(column: ColumnDefDto, rawValue: unknown): PersistableFieldValue {
  switch (column.type) {
    case 'text':
      if (typeof rawValue !== 'string') {
        throwInvalidValue(column, 'esperado texto');
      }
      if (column.config?.maxLength !== undefined && rawValue.length > column.config.maxLength) {
        throwInvalidValue(
          column,
          `texto excede maxLength=${column.config.maxLength}`,
        );
      }
      return rawValue;

    case 'number':
      if (typeof rawValue !== 'number' || !Number.isFinite(rawValue)) {
        throwInvalidValue(column, 'esperado numero finito');
      }
      return rawValue;

    case 'date':
      if (typeof rawValue !== 'string' || !isISO8601(rawValue, { strict: true })) {
        throwInvalidValue(column, 'esperada data ISO-8601');
      }
      return rawValue;

    case 'person':
      if (typeof rawValue !== 'string') {
        throwInvalidValue(column, 'esperado id de pessoa em string');
      }
      return rawValue;

    case 'checkbox':
      if (typeof rawValue !== 'boolean') {
        throwInvalidValue(column, 'esperado booleano');
      }
      return rawValue;

    case 'link':
      if (typeof rawValue !== 'string' || !isHttpUrl(rawValue)) {
        throwInvalidValue(column, 'esperada URL http/https');
      }
      return rawValue;

    case 'status':
    case 'dropdown':
      return validateOptionValue(column, rawValue);
  }
}

/**
 * Valida tipos baseados em options (`status` e `dropdown`).
 *
 * @param column - Definicao da coluna.
 * @param rawValue - Valor recebido para a celula.
 * @returns ID de opcao aceito para persistencia.
 *
 * @throws {BadRequestException} Quando o valor nao esta em `config.options`.
 */
function validateOptionValue(column: ColumnDefDto, rawValue: unknown): PersistableFieldValue {
  if (!OPTION_VALUE_TYPES.has(column.type)) {
    throwInvalidValue(column, 'tipo de coluna invalido para options');
  }

  const optionIds = new Set((column.config?.options ?? []).map((option) => option.id));
  if (typeof rawValue !== 'string' || !optionIds.has(rawValue)) {
    throwInvalidValue(column, 'valor deve existir em config.options[].id');
  }
  return rawValue;
}

/**
 * Verifica se a string e uma URL absoluta http/https.
 *
 * @param value - Valor recebido para coluna `link`.
 * @returns `true` quando a URL usa protocolo http ou https.
 */
function isHttpUrl(value: string): boolean {
  try {
    const parsed = new URL(value);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Lanca uma excecao padronizada de valor invalido para uma coluna.
 *
 * @param column - Definicao da coluna.
 * @param reason - Motivo legivel da rejeicao.
 * @throws {BadRequestException} Sempre.
 */
function throwInvalidValue(column: ColumnDefDto, reason: string): never {
  const label = column.label ? `${column.label} (${column.key})` : column.key;
  throw new BadRequestException(
    `Valor invalido para coluna "${label}" do tipo ${column.type}: ${reason}`,
  );
}

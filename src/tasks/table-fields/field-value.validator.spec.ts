import { BadRequestException } from '@nestjs/common';
import {
  assertRequiredFieldValues,
  validateFieldValues,
} from './field-value.validator';
import { ColumnDefDto, ColumnType } from './column-def.dto';

/** Helper: monta uma coluna minima valida para testes de valor. */
function col(partial: Partial<ColumnDefDto>): ColumnDefDto {
  return {
    key: 'f_col',
    type: 'text' as ColumnType,
    label: 'Coluna',
    order: 0,
    ...partial,
  } as ColumnDefDto;
}

describe('validateFieldValues', () => {
  const optionConfig = {
    options: [
      { id: 'todo', label: 'A fazer' },
      { id: 'done', label: 'Feito' },
    ],
  };

  test.each([
    ['text', col({ type: 'text', config: { maxLength: 5 } }), 'abc', 123],
    ['number', col({ type: 'number' }), 42.5, '42'],
    ['date', col({ type: 'date' }), '2026-06-30', '30/06/2026'],
    ['person', col({ type: 'person' }), '100', 100],
    ['status', col({ type: 'status', config: optionConfig }), 'todo', 'missing'],
    ['checkbox', col({ type: 'checkbox' }), true, 'true'],
    ['dropdown', col({ type: 'dropdown', config: optionConfig }), 'done', 'missing'],
    ['link', col({ type: 'link' }), 'https://github.com/org/repo', 'ftp://example.com'],
  ] as Array<[ColumnType, ColumnDefDto, unknown, unknown]>)(
    'valida tipo %s com caso valido e invalido',
    (_type, column, validValue, invalidValue) => {
      expect(validateFieldValues([column], { [column.key]: validValue })).toEqual({
        values: { [column.key]: validValue },
        clearedKeys: [],
      });

      expect(() => validateFieldValues([column], { [column.key]: invalidValue })).toThrow(
        BadRequestException,
      );
    },
  );

  it('respeita maxLength em text', () => {
    const column = col({ key: 'f_text', type: 'text', config: { maxLength: 3 } });
    expect(() => validateFieldValues([column], { f_text: 'abcd' })).toThrow(
      BadRequestException,
    );
  });

  it('ignora chaves desconhecidas sem persistir valor', () => {
    const column = col({ key: 'f_text', type: 'text' });
    expect(validateFieldValues([column], { f_unknown: 'x' })).toEqual({
      values: {},
      clearedKeys: [],
    });
  });

  it('retorna clearedKeys quando valor null limpa celula opcional', () => {
    const column = col({ key: 'f_text', type: 'text' });
    expect(validateFieldValues([column], { f_text: null })).toEqual({
      values: {},
      clearedKeys: ['f_text'],
    });
  });

  it('rejeita null em coluna required', () => {
    const column = col({ key: 'f_text', type: 'text', required: true });
    expect(() => validateFieldValues([column], { f_text: null })).toThrow(
      BadRequestException,
    );
  });
});

describe('assertRequiredFieldValues', () => {
  it('nao lanca quando required esta presente no objeto final', () => {
    const column = col({ key: 'f_text', type: 'text', required: true });
    expect(() => assertRequiredFieldValues([column], { f_text: 'ok' })).not.toThrow();
  });

  it('lanca quando required esta ausente no objeto final', () => {
    const column = col({ key: 'f_text', type: 'text', required: true });
    expect(() => assertRequiredFieldValues([column], {})).toThrow(BadRequestException);
  });
});

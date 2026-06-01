import { BadRequestException } from '@nestjs/common';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { BUILTIN_COLUMN_ORDER, BUILTIN_COLUMNS_TEMPLATE } from './builtin-columns';
import { validateTableFields } from './table-fields.validator';
import { ColumnDefDto, TableFieldsDto, ColumnType } from './column-def.dto';

/** Helper: monta uma ColumnDefDto mínima válida, permitindo override. */
function col(partial: Partial<ColumnDefDto>): ColumnDefDto {
  return {
    key: 'f_a',
    type: 'text' as ColumnType,
    label: 'A',
    order: 0,
    ...partial,
  } as ColumnDefDto;
}

/** Helper: monta o envelope TableFieldsDto. */
function envelope(columns: ColumnDefDto[]): TableFieldsDto {
  return { version: 1, columns } as TableFieldsDto;
}

describe('validateTableFields', () => {
  it('não lança para schema válido (várias colunas)', () => {
    const dto = envelope([
      col({ key: 'f_nome', type: 'text', label: 'Nome', order: 0 }),
      col({ key: 'f_valor', type: 'number', label: 'Valor', order: 1 }),
      col({
        key: 'f_status',
        type: 'status',
        label: 'Status',
        order: 2,
        config: {
          options: [
            { id: 'todo', label: 'A fazer' },
            { id: 'done', label: 'Feito' },
          ],
        },
      }),
    ]);
    expect(() => validateTableFields(dto)).not.toThrow();
  });

  it('não lança para schema vazio (columns: [])', () => {
    expect(() => validateTableFields(envelope([]))).not.toThrow();
  });

  it('não lança para coluna text sem config', () => {
    const dto = envelope([col({ key: 'f_txt', type: 'text', order: 0 })]);
    expect(() => validateTableFields(dto)).not.toThrow();
  });

  it('lança quando há key duplicada', () => {
    const dto = envelope([
      col({ key: 'f_dup', order: 0 }),
      col({ key: 'f_dup', order: 1 }),
    ]);
    expect(() => validateTableFields(dto)).toThrow(BadRequestException);
    expect(() => validateTableFields(dto)).toThrow(/key "f_dup"/);
  });

  it('lança quando há order duplicado', () => {
    const dto = envelope([
      col({ key: 'f_aa', order: 5 }),
      col({ key: 'f_bb', order: 5 }),
    ]);
    expect(() => validateTableFields(dto)).toThrow(BadRequestException);
    expect(() => validateTableFields(dto)).toThrow(/order 5/);
  });

  it('lança quando há options.id duplicada na mesma coluna', () => {
    const dto = envelope([
      col({
        key: 'f_status',
        type: 'status',
        order: 0,
        config: {
          options: [
            { id: 'x', label: 'X' },
            { id: 'x', label: 'X2' },
          ],
        },
      }),
    ]);
    expect(() => validateTableFields(dto)).toThrow(BadRequestException);
    expect(() => validateTableFields(dto)).toThrow(/id "x"/);
  });

  it('lança quando coluna status não tem options', () => {
    const dto = envelope([col({ key: 'f_status', type: 'status', order: 0 })]);
    expect(() => validateTableFields(dto)).toThrow(BadRequestException);
    expect(() => validateTableFields(dto)).toThrow(/exige ao menos uma opção/);
  });

  it('lança quando coluna dropdown tem options vazio', () => {
    const dto = envelope([
      col({ key: 'f_dd', type: 'dropdown', order: 0, config: { options: [] } }),
    ]);
    expect(() => validateTableFields(dto)).toThrow(BadRequestException);
    expect(() => validateTableFields(dto)).toThrow(/exige ao menos uma opção/);
  });

  it('permite options.id iguais em colunas DIFERENTES', () => {
    const dto = envelope([
      col({
        key: 'f_s1',
        type: 'status',
        order: 0,
        config: { options: [{ id: 'shared', label: 'S' }] },
      }),
      col({
        key: 'f_s2',
        type: 'dropdown',
        order: 1,
        config: { options: [{ id: 'shared', label: 'S' }] },
      }),
    ]);
    expect(() => validateTableFields(dto)).not.toThrow();
  });

  it('nao lanca para schema misturando builtin e custom', () => {
    const dto = envelope([
      ...BUILTIN_COLUMNS_TEMPLATE,
      col({ key: 'f_cliente', type: 'text', label: 'Cliente', order: 6 }),
    ] as ColumnDefDto[]);

    expect(() => validateTableFields(dto)).not.toThrow();
  });

  it.each(BUILTIN_COLUMN_ORDER)('aceita a key builtin %s quando builtin=true', (key) => {
    const builtin = BUILTIN_COLUMNS_TEMPLATE.find((column) => column.key === key);

    expect(builtin).toBeDefined();
    expect(() => validateTableFields(envelope([builtin as ColumnDefDto]))).not.toThrow();
  });

  it('rejeita builtin=true fora do conjunto canonico', () => {
    const dto = envelope([
      col({ key: 'f_fake', type: 'text', label: 'Fake', order: 0, builtin: true }),
    ]);

    expect(() => validateTableFields(dto)).toThrow(BadRequestException);
    expect(() => validateTableFields(dto)).toThrow(/builtin invalida/);
  });

  it('mantem regex f_* para coluna custom', () => {
    const dto = envelope([col({ key: 'status', type: 'text', label: 'Status', order: 0 })]);

    expect(() => validateTableFields(dto)).toThrow(BadRequestException);
    expect(() => validateTableFields(dto)).toThrow(/formato f_/);
  });
});

describe('ColumnDefDto key validation', () => {
  it('isenta key builtin do regex do DTO quando builtin=true', () => {
    const dto = plainToInstance(ColumnDefDto, {
      key: '__nome',
      type: 'text',
      label: 'Tarefa',
      order: 0,
      builtin: true,
    });

    expect(validateSync(dto)).toHaveLength(0);
  });

  it('continua rejeitando key fora do regex quando builtin=false', () => {
    const dto = plainToInstance(ColumnDefDto, {
      key: 'status',
      type: 'text',
      label: 'Status',
      order: 0,
      builtin: false,
    });

    expect(validateSync(dto).some((error) => error.property === 'key')).toBe(true);
  });
});

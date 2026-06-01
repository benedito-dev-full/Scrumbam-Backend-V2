import {
  BUILTIN_COLUMN_ORDER,
  BUILTIN_COLUMNS_TEMPLATE,
  mergeBuiltinColumns,
} from './builtin-columns';
import { TableFieldsDto } from './column-def.dto';

describe('mergeBuiltinColumns', () => {
  it('materializa as 6 builtin quando tableFields e null', () => {
    const result = mergeBuiltinColumns(null);

    expect(result.version).toBe(1);
    expect(result.columns).toHaveLength(6);
    expect(result.columns.map((column) => column.key)).toEqual(BUILTIN_COLUMN_ORDER);
    expect(result.columns.every((column) => column.builtin === true)).toBe(true);
    expect(result.columns.map((column) => column.order)).toEqual([0, 1, 2, 3, 4, 5]);
  });

  it('preserva custom depois das builtin em ordem deterministica', () => {
    const stored: TableFieldsDto = {
      version: 3,
      columns: [
        { key: 'f_b', type: 'text', label: 'B', order: 20 },
        { key: 'f_a', type: 'number', label: 'A', order: 10 },
      ],
    };

    const result = mergeBuiltinColumns(stored);

    expect(result.version).toBe(3);
    expect(result.columns.map((column) => column.key)).toEqual([
      ...BUILTIN_COLUMN_ORDER,
      'f_a',
      'f_b',
    ]);
    expect(result.columns.map((column) => column.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
  });

  it('nao duplica builtin ja armazenada e completa as ausentes', () => {
    const stored: TableFieldsDto = {
      version: 1,
      columns: [
        { key: 'status', type: 'status', label: 'Status', order: 9, builtin: true },
        { key: 'f_cliente', type: 'text', label: 'Cliente', order: 10 },
      ],
    };

    const result = mergeBuiltinColumns(stored);

    expect(result.columns.filter((column) => column.key === 'status')).toHaveLength(1);
    expect(result.columns.map((column) => column.key)).toEqual([
      ...BUILTIN_COLUMN_ORDER,
      'f_cliente',
    ]);
  });

  it('renumera colisao de order entre builtin e custom no conjunto inteiro', () => {
    const stored: TableFieldsDto = {
      version: 1,
      columns: [
        { key: 'f_cliente', type: 'text', label: 'Cliente', order: 0 },
        { key: 'f_valor', type: 'number', label: 'Valor', order: 0 },
      ],
    };

    const result = mergeBuiltinColumns(stored);

    expect(result.columns.map((column) => column.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(result.columns.slice(6).map((column) => column.key)).toEqual(['f_cliente', 'f_valor']);
  });

  it('e idempotente', () => {
    const stored: TableFieldsDto = {
      version: 2,
      columns: [
        { key: 'f_cliente', type: 'text', label: 'Cliente', order: 4 },
        { key: 'status', type: 'status', label: 'Status', order: 0, builtin: true },
      ],
    };

    const once = mergeBuiltinColumns(stored);
    const twice = mergeBuiltinColumns(once);

    expect(twice).toEqual(once);
  });

  it('inclui options canonicas para status e prioridade', () => {
    const result = mergeBuiltinColumns(null);
    const status = result.columns.find((column) => column.key === 'status');
    const prioridade = result.columns.find((column) => column.key === 'prioridade');

    expect(status?.config?.options?.map((option) => option.id)).toEqual([
      'backlog',
      'ready',
      'em-progresso',
      'concluido',
      'falhou',
    ]);
    expect(prioridade?.config?.options?.map((option) => option.id)).toEqual([
      'LOW',
      'MEDIUM',
      'HIGH',
      'URGENT',
    ]);
    expect(BUILTIN_COLUMNS_TEMPLATE.find((column) => column.key === 'identifier')?.builtin).toBe(
      true,
    );
  });
});

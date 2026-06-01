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

  it('injeta builtin ausentes ao final de um legado so-custom (ordem por order)', () => {
    const stored: TableFieldsDto = {
      version: 3,
      columns: [
        { key: 'f_b', type: 'text', label: 'B', order: 20 },
        { key: 'f_a', type: 'number', label: 'A', order: 10 },
      ],
    };

    const result = mergeBuiltinColumns(stored);

    expect(result.version).toBe(3);
    // Custom ja existentes vem primeiro (order 10/20), builtin injetadas ao final.
    expect(result.columns.map((column) => column.key)).toEqual([
      'f_a',
      'f_b',
      ...BUILTIN_COLUMN_ORDER,
    ]);
    expect(result.columns.map((column) => column.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(result.columns).toHaveLength(8);
  });

  it('PRESERVA a ordem reordenada das builtin (regressao do bug de reorder)', () => {
    // Cenario do usuario: arrastou "status" para DEPOIS de uma custom.
    // O front grava a nova `order`; o merge NAO pode forcar builtin ao inicio.
    const stored: TableFieldsDto = {
      version: 5,
      columns: [
        { key: '__nome', type: 'text', label: 'Tarefa', order: 0, builtin: true },
        { key: 'identifier', type: 'text', label: 'ID', order: 1, builtin: true },
        { key: 'f_cliente', type: 'text', label: 'Cliente', order: 2 },
        { key: 'status', type: 'status', label: 'Status', order: 3, builtin: true },
        { key: 'responsavel', type: 'person', label: 'Resp.', order: 4, builtin: true },
        { key: 'prioridade', type: 'dropdown', label: 'Prioridade', order: 5, builtin: true },
        { key: 'dueDate', type: 'date', label: 'Data', order: 6, builtin: true },
      ],
    };

    const result = mergeBuiltinColumns(stored);

    // status PERMANECE depois de f_cliente — a reordenacao foi respeitada.
    expect(result.columns.map((column) => column.key)).toEqual([
      '__nome',
      'identifier',
      'f_cliente',
      'status',
      'responsavel',
      'prioridade',
      'dueDate',
    ]);
    expect(result.columns.map((column) => column.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
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
    // status(order 9) e f_cliente(order 10) vem primeiro; builtin ausentes ao final.
    expect(result.columns.map((column) => column.key)).toEqual([
      'status',
      'f_cliente',
      '__nome',
      'identifier',
      'responsavel',
      'prioridade',
      'dueDate',
    ]);
    expect(result.columns).toHaveLength(7);
  });

  it('renumera colisao de order entre custom no conjunto inteiro', () => {
    const stored: TableFieldsDto = {
      version: 1,
      columns: [
        { key: 'f_cliente', type: 'text', label: 'Cliente', order: 0 },
        { key: 'f_valor', type: 'number', label: 'Valor', order: 0 },
      ],
    };

    const result = mergeBuiltinColumns(stored);

    expect(result.columns.map((column) => column.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    // Custom (order 0, desempate estavel) primeiro; builtin injetadas ao final.
    expect(result.columns.slice(0, 2).map((column) => column.key)).toEqual([
      'f_cliente',
      'f_valor',
    ]);
    expect(result.columns.slice(2).map((column) => column.key)).toEqual([...BUILTIN_COLUMN_ORDER]);
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

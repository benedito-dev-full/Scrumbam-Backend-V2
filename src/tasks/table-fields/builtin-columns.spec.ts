import {
  BUILTIN_COLUMN_ORDER,
  BUILTIN_COLUMNS_TEMPLATE,
  mergeBuiltinColumns,
} from './builtin-columns';
import { TableFieldsDto } from './column-def.dto';

describe('mergeBuiltinColumns', () => {
  it('materializa as 7 builtin quando tableFields e null', () => {
    const result = mergeBuiltinColumns(null);

    expect(result.version).toBe(1);
    expect(result.columns).toHaveLength(7);
    expect(result.columns.map((column) => column.key)).toEqual(BUILTIN_COLUMN_ORDER);
    expect(result.columns.every((column) => column.builtin === true)).toBe(true);
    expect(result.columns.map((column) => column.order)).toEqual([0, 1, 2, 3, 4, 5, 6]);
  });

  it('materializa timeSpent (7a builtin) como text read-only ao final', () => {
    const result = mergeBuiltinColumns(null);

    const timeSpent = result.columns.find((column) => column.key === 'timeSpent');
    expect(timeSpent).toBeDefined();
    expect(timeSpent?.type).toBe('text');
    expect(timeSpent?.label).toBe('Tempo gasto');
    expect(timeSpent?.builtin).toBe(true);
    expect(timeSpent?.readOnly).toBe(true);
    // É a última builtin na ordem canônica.
    expect(result.columns[result.columns.length - 1].key).toBe('timeSpent');
    // BUILTIN_COLUMN_ORDER inclui timeSpent como 7º item.
    expect(BUILTIN_COLUMN_ORDER).toContain('timeSpent');
    expect(BUILTIN_COLUMN_ORDER).toHaveLength(7);
  });

  it('força readOnly:true em timeSpent mesmo se um legado o persistiu sem o flag', () => {
    // Legado materializou timeSpent antes do flag existir (sem readOnly) e ainda
    // o reordenou. O merge deve RESTAURAR readOnly:true a partir do template,
    // sem deixar a coluna virar editável.
    const stored: TableFieldsDto = {
      version: 4,
      columns: [
        { key: '__nome', type: 'text', label: 'Tarefa', order: 0, builtin: true },
        { key: 'status', type: 'status', label: 'Status', order: 1, builtin: true },
        { key: 'identifier', type: 'text', label: 'ID', order: 2, builtin: true },
        { key: 'responsavel', type: 'person', label: 'Resp.', order: 3, builtin: true },
        { key: 'prioridade', type: 'dropdown', label: 'Prioridade', order: 4, builtin: true },
        { key: 'dueDate', type: 'date', label: 'Data', order: 5, builtin: true },
        // timeSpent persistido SEM readOnly (legado).
        { key: 'timeSpent', type: 'text', label: 'Tempo gasto', order: 6, builtin: true },
      ],
    };

    const result = mergeBuiltinColumns(stored);

    const timeSpent = result.columns.find((column) => column.key === 'timeSpent');
    expect(timeSpent?.readOnly).toBe(true);
    expect(timeSpent?.builtin).toBe(true);
    expect(result.columns).toHaveLength(7);
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
    expect(result.columns.map((column) => column.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
    expect(result.columns).toHaveLength(9);
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
    // timeSpent (7a builtin AUSENTE neste legado) é injetada ao FINAL, sem
    // perturbar a ordem reordenada das demais.
    expect(result.columns.map((column) => column.key)).toEqual([
      '__nome',
      'identifier',
      'f_cliente',
      'status',
      'responsavel',
      'prioridade',
      'dueDate',
      'timeSpent',
    ]);
    expect(result.columns.map((column) => column.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7]);
    expect(result.columns.find((column) => column.key === 'timeSpent')?.readOnly).toBe(true);
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
      'timeSpent',
    ]);
    expect(result.columns).toHaveLength(8);
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

    expect(result.columns.map((column) => column.order)).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 8]);
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

  it('preserva hidden:true em builtin arquivada apos merge (nao perde o flag)', () => {
    // Cenario: usuario arquivou a coluna "responsavel" (hidden:true).
    // O merge nao deve restaurar hidden para false nem omiti-lo.
    const stored: TableFieldsDto = {
      version: 2,
      columns: [
        { key: '__nome', type: 'text', label: 'Tarefa', order: 0, builtin: true },
        { key: 'status', type: 'status', label: 'Status', order: 1, builtin: true },
        { key: 'identifier', type: 'text', label: 'ID', order: 2, builtin: true },
        // responsavel arquivada: hidden:true deve sobreviver
        {
          key: 'responsavel',
          type: 'person',
          label: 'Resp.',
          order: 3,
          builtin: true,
          hidden: true,
        },
        { key: 'prioridade', type: 'dropdown', label: 'Prioridade', order: 4, builtin: true },
        { key: 'dueDate', type: 'date', label: 'Data', order: 5, builtin: true },
        {
          key: 'timeSpent',
          type: 'text',
          label: 'Tempo gasto',
          order: 6,
          builtin: true,
          readOnly: true,
        },
      ],
    };

    const result = mergeBuiltinColumns(stored);

    const responsavel = result.columns.find((c) => c.key === 'responsavel');
    expect(responsavel).toBeDefined();
    expect(responsavel?.hidden).toBe(true);
    expect(responsavel?.builtin).toBe(true);
    // Nenhuma builtin deve ter sido perdida ou duplicada.
    expect(result.columns).toHaveLength(7);
  });

  it('preserva label customizado de builtin (rename) apos merge', () => {
    // Cenario: usuario renomeou "__nome" de "Tarefa" para "Atividade".
    // O merge via {...base, ...existing} deve manter o label do existing.
    const stored: TableFieldsDto = {
      version: 3,
      columns: [
        { key: '__nome', type: 'text', label: 'Atividade', order: 0, builtin: true },
        { key: 'status', type: 'status', label: 'Status', order: 1, builtin: true },
        { key: 'identifier', type: 'text', label: 'ID', order: 2, builtin: true },
        { key: 'responsavel', type: 'person', label: 'Resp.', order: 3, builtin: true },
        { key: 'prioridade', type: 'dropdown', label: 'Prioridade', order: 4, builtin: true },
        { key: 'dueDate', type: 'date', label: 'Data', order: 5, builtin: true },
        {
          key: 'timeSpent',
          type: 'text',
          label: 'Tempo gasto',
          order: 6,
          builtin: true,
          readOnly: true,
        },
      ],
    };

    const result = mergeBuiltinColumns(stored);

    const nome = result.columns.find((c) => c.key === '__nome');
    expect(nome?.label).toBe('Atividade');
    expect(nome?.builtin).toBe(true);
    // key e type vem do template (imutaveis).
    expect(nome?.key).toBe('__nome');
    expect(nome?.type).toBe('text');
  });

  it('preserva label customizado de builtin NAO-__nome (status/prioridade) apos merge', () => {
    // Garante que o rename vale para QUALQUER builtin, nao so o titulo —
    // o label do existing prevalece, mas key/type/options vem do template.
    const stored: TableFieldsDto = {
      version: 2,
      columns: [
        { key: 'status', type: 'status', label: 'Situacao', order: 1, builtin: true },
        { key: 'prioridade', type: 'dropdown', label: 'Urgencia', order: 4, builtin: true },
        { key: 'responsavel', type: 'person', label: 'Dono', order: 3, builtin: true },
      ],
    };

    const result = mergeBuiltinColumns(stored);

    const status = result.columns.find((c) => c.key === 'status');
    expect(status?.label).toBe('Situacao');
    expect(status?.type).toBe('status');
    // options canonicas continuam vindo do template mesmo apos rename.
    expect(status?.config?.options?.length ?? 0).toBeGreaterThan(0);

    expect(result.columns.find((c) => c.key === 'prioridade')?.label).toBe('Urgencia');
    expect(result.columns.find((c) => c.key === 'responsavel')?.label).toBe('Dono');
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

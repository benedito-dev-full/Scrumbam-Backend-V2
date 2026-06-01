import { ColumnDefDto, TableFieldsDto } from './column-def.dto';

export const BUILTIN_COLUMN_ORDER = [
  '__nome',
  'status',
  'identifier',
  'responsavel',
  'prioridade',
  'dueDate',
  'timeSpent',
] as const;

export type BuiltinColumnKey = (typeof BUILTIN_COLUMN_ORDER)[number];

export const BUILTIN_COLUMN_KEYS: ReadonlySet<string> = new Set(BUILTIN_COLUMN_ORDER);

export const BUILTIN_COLUMNS_TEMPLATE: readonly ColumnDefDto[] = [
  { key: '__nome', type: 'text', label: 'Tarefa', order: 0, builtin: true },
  {
    key: 'status',
    type: 'status',
    label: 'Status',
    order: 1,
    builtin: true,
    config: {
      options: [
        { id: 'backlog', label: 'Backlog', color: '#6b7280' },
        { id: 'ready', label: 'Pronto', color: '#3b82f6' },
        { id: 'em-progresso', label: 'Em Progresso', color: '#8b5cf6' },
        { id: 'concluido', label: 'Concluído', color: '#10b981' },
        { id: 'falhou', label: 'Falhou', color: '#ef4444' },
      ],
    },
  },
  { key: 'identifier', type: 'text', label: 'ID da tarefa', order: 2, builtin: true },
  { key: 'responsavel', type: 'person', label: 'Resp.', order: 3, builtin: true },
  {
    key: 'prioridade',
    type: 'dropdown',
    label: 'Prioridade',
    order: 4,
    builtin: true,
    config: {
      options: [
        { id: 'LOW', label: 'Baixa', color: '#6b7280' },
        { id: 'MEDIUM', label: 'Média', color: '#f59e0b' },
        { id: 'HIGH', label: 'Alta', color: '#f97316' },
        { id: 'URGENT', label: 'Urgente', color: '#ef4444' },
      ],
    },
  },
  { key: 'dueDate', type: 'date', label: 'Data limite', order: 5, builtin: true },
  // 7ª builtin (Fase 3 — ADR-V2-057): "Tempo gasto" read-only. O VALOR é o total
  // agregado server-side por task (soma de durationMs de manualTimers de todos os
  // usuários, já formatado em "Xh Ymin" / "—"). NÃO é editável, NÃO grava em
  // dados.fields[key]; usa type 'text' + readOnly para não inflar os 8 ColumnType.
  { key: 'timeSpent', type: 'text', label: 'Tempo gasto', order: 6, builtin: true, readOnly: true },
];

type ColumnLike = ColumnDefDto & { key: string; order: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cloneColumn(column: ColumnDefDto): ColumnDefDto {
  return {
    ...column,
    config: column.config
      ? {
          ...column.config,
          options: column.config.options?.map((option) => ({ ...option })),
        }
      : undefined,
  };
}

function mergeBuiltinColumn(template: ColumnDefDto, existing?: ColumnDefDto): ColumnDefDto {
  const base = cloneColumn(template);
  if (!existing) {
    return base;
  }

  const existingOptions = existing.config?.options ?? [];
  const templateOptions = template.config?.options ?? [];

  return {
    ...base,
    ...existing,
    key: template.key,
    type: template.type,
    builtin: true,
    // O flag read-only é determinado pelo TEMPLATE (server-side), não pelo que o
    // cliente eventualmente persistiu — uma builtin read-only (ex.: timeSpent)
    // nunca pode virar editável por reorder/merge.
    ...(template.readOnly !== undefined ? { readOnly: template.readOnly } : {}),
    config:
      template.config || existing.config
        ? {
            ...template.config,
            ...existing.config,
            options: (existingOptions.length > 0 ? existingOptions : templateOptions).map(
              (option) => ({ ...option }),
            ),
          }
        : undefined,
  };
}

function getVersion(stored: unknown): number {
  if (!isRecord(stored)) {
    return 1;
  }
  return Number.isInteger(stored.version) && Number(stored.version) > 0
    ? Number(stored.version)
    : 1;
}

function getColumns(stored: unknown): ColumnDefDto[] {
  if (!isRecord(stored) || !Array.isArray(stored.columns)) {
    return [];
  }
  return stored.columns.filter(isRecord) as unknown as ColumnDefDto[];
}

/**
 * Completa o schema com as 7 colunas builtin SEM impor uma ordem fixa.
 *
 * Regras (Fase 4 — reordenar TUDO):
 * - Builtin JÁ armazenada: preserva sua `order` (foi o usuário que reordenou);
 *   só completa campos do template (type/options/builtin:true via mergeBuiltinColumn).
 * - Builtin AUSENTE (lista legada / null): injeta do template ao FINAL do schema
 *   atual (não força ao início) na ordem canônica do template, idempotente.
 * - Custom: preserva como está.
 * - A ordem final do conjunto INTEIRO é decidida por `order` (com desempate
 *   estável pelo índice original) e depois renumerada contígua. Assim o reorder
 *   enviado pelo front (que define `order` por posição) é respeitado no GET.
 *
 * @param stored - tableFields cru do banco (objeto, null, ou malformado)
 * @returns TableFieldsDto com as 7 builtin garantidas + custom, ordem preservada
 */
export function mergeBuiltinColumns(stored: unknown): TableFieldsDto {
  const columns = getColumns(stored);
  const storedBuiltinByKey = new Map<string, ColumnDefDto>();

  for (const column of columns) {
    if (BUILTIN_COLUMN_KEYS.has(column.key) && !storedBuiltinByKey.has(column.key)) {
      storedBuiltinByKey.set(column.key, column);
    }
  }

  // `order` base para builtin ausentes: depois da maior order existente, para
  // não colidir nem "puxar" colunas existentes ao serem injetadas em legados.
  const maxStoredOrder = columns.reduce(
    (max, column) => (Number.isFinite(column.order) ? Math.max(max, column.order) : max),
    -1,
  );

  // 1) Builtin: preserva a coluna armazenada (com sua `order`) ou injeta do
  //    template ao final, na ordem canônica do template.
  let nextInjectedOrder = maxStoredOrder + 1;
  const builtinColumns: ColumnDefDto[] = BUILTIN_COLUMNS_TEMPLATE.map((template) => {
    const existing = storedBuiltinByKey.get(template.key);
    const merged = mergeBuiltinColumn(template, existing);
    if (existing && Number.isFinite(existing.order)) {
      return { ...merged, order: existing.order, builtin: true };
    }
    return { ...merged, order: nextInjectedOrder++, builtin: true };
  });

  // 2) Custom: preserva como está (com sua `order`).
  const customColumns = columns
    .filter((column) => !BUILTIN_COLUMN_KEYS.has(column.key))
    .map((column) => cloneColumn(column as ColumnLike));

  // 3) Ordena o conjunto INTEIRO por `order`, desempate estável por índice de
  //    inserção, e renumera contíguo pela posição final.
  const columnsSorted = [...builtinColumns, ...customColumns]
    .map((column, insertionIndex) => ({ column, insertionIndex }))
    .sort((a, b) => {
      const orderDiff = a.column.order - b.column.order;
      return orderDiff !== 0 ? orderDiff : a.insertionIndex - b.insertionIndex;
    })
    .map(({ column }, order) => ({ ...column, order }));

  return {
    version: getVersion(stored),
    columns: columnsSorted,
  };
}

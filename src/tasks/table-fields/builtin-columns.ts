import { ColumnDefDto, TableFieldsDto } from './column-def.dto';

export const BUILTIN_COLUMN_ORDER = [
  '__nome',
  'status',
  'identifier',
  'responsavel',
  'prioridade',
  'dueDate',
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
  { key: 'dueDate', type: 'date', label: 'Data', order: 5, builtin: true },
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

export function mergeBuiltinColumns(stored: unknown): TableFieldsDto {
  const columns = getColumns(stored);
  const builtinByKey = new Map<string, ColumnDefDto>();

  for (const column of columns) {
    if (BUILTIN_COLUMN_KEYS.has(column.key) && !builtinByKey.has(column.key)) {
      builtinByKey.set(column.key, column);
    }
  }

  const builtinColumns = BUILTIN_COLUMNS_TEMPLATE.map((template, index) => ({
    ...mergeBuiltinColumn(template, builtinByKey.get(template.key)),
    order: index,
    builtin: true,
  }));

  const customColumns = columns
    .map((column, originalIndex) => ({ column, originalIndex }))
    .filter(({ column }) => !BUILTIN_COLUMN_KEYS.has(column.key))
    .sort((a, b) => {
      const orderDiff = a.column.order - b.column.order;
      return orderDiff !== 0 ? orderDiff : a.originalIndex - b.originalIndex;
    })
    .map(({ column }) => cloneColumn(column as ColumnLike));

  return {
    version: getVersion(stored),
    columns: [...builtinColumns, ...customColumns].map((column, index) => ({
      ...column,
      order: index,
    })),
  };
}

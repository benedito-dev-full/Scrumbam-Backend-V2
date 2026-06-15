import { MCP_ERROR_CODES } from '../constants';
import { McpUserContext } from '../interfaces/mcp.types';
import { McpToolError } from './tool.interface';

export const V3_STATUS_CODES = [
  'INBOX',
  'READY',
  'EXECUTING',
  'DONE',
  'FAILED',
  'CANCELLED',
  'DISCARDED',
  'VALIDATING',
  'VALIDATED',
] as const;

export function assertRecord(params: unknown): Record<string, unknown> {
  if (!params || typeof params !== 'object' || Array.isArray(params)) {
    throw invalidParams('params', 'object required');
  }

  return params as Record<string, unknown>;
}

export function optionalRecord(params: unknown): Record<string, unknown> {
  if (params === undefined || params === null) {
    return {};
  }

  return assertRecord(params);
}

export function requiredString(params: Record<string, unknown>, field: string): string {
  const value = params[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalidParams(field, 'required string');
  }

  return value;
}

export function optionalString(params: Record<string, unknown>, field: string): string | undefined {
  const value = params[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalidParams(field, 'string expected');
  }

  return value;
}

/**
 * Extrai um campo opcional que, quando presente, deve ser um objeto JSON
 * (record chave→valor) — NUNCA array nem primitivo. Usado para o parametro
 * `fields` (valores de colunas customizaveis) das tools create_task/update_task.
 *
 * A MCP NAO valida o TIPO de cada valor de coluna (string/number/boolean/null):
 * essa validacao e responsabilidade UNICA do backend (`TasksService` contra
 * `DProject.tableFields`). Este helper apenas garante o shape de container.
 *
 * Semantica:
 *   - ausente/null → retorna `undefined` (campo nao informado)
 *   - objeto JSON → retorna o objeto fiel (valores repassados como vieram,
 *     inclusive `null` interno, que o backend interpreta como "limpar coluna")
 *   - array ou primitivo → lanca INVALID_PARAMS
 *
 * @param params - Objeto de argumentos da chamada MCP
 * @param field - Nome do campo a extrair
 * @returns O record quando valido, ou `undefined` se ausente/null
 * @throws {McpToolError} INVALID_PARAMS quando o valor existe mas nao e objeto
 */
export function optionalRecordField(
  params: Record<string, unknown>,
  field: string,
): Record<string, unknown> | undefined {
  const value = params[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw invalidParams(field, 'object expected');
  }
  return value as Record<string, unknown>;
}

export function maxStringLength(value: string, field: string, maxLength: number): void {
  if (value.length > maxLength) {
    throw invalidParams(field, `max length ${maxLength} exceeded`);
  }
}

export function optionalLimit(params: Record<string, unknown>): number {
  const value = params.limit;
  if (value === undefined || value === null) {
    return 20;
  }
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 50) {
    throw invalidParams('limit', 'integer between 1 and 50 expected');
  }

  return value;
}

/**
 * Valida que um campo opcional, quando presente e nao-null, e uma string em
 * formato ISO 8601 (data ou datetime). Espelha o validador `@IsISO8601` do
 * `CreateTaskDto`/`UpdateTaskDto` — falha cedo com INVALID_PARAMS limpo,
 * evitando que uma data malformada vire 500 no service (`new Date(...)`).
 *
 * Semantica:
 *   - ausente/null/undefined → retorna `undefined` (campo nao informado)
 *   - string ISO 8601 valida → retorna a string
 *   - qualquer outro valor → lanca INVALID_PARAMS
 *
 * @param params - Objeto de argumentos da chamada MCP
 * @param field - Nome do campo a extrair
 * @returns A string ISO 8601 quando valida, ou `undefined` se ausente/null
 * @throws {McpToolError} INVALID_PARAMS quando o valor existe mas nao e ISO 8601
 *
 * @example
 * ```typescript
 * const dueDate = optionalIso8601({ dueDate: '2026-06-30' }, 'dueDate'); // '2026-06-30'
 * const none = optionalIso8601({}, 'dueDate');                            // undefined
 * optionalIso8601({ dueDate: 'amanha' }, 'dueDate');                      // throws
 * ```
 */
export function optionalIso8601(
  params: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = params[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  return assertIso8601(value, field);
}

/**
 * Garante que `value` e uma string em formato ISO 8601. Reutilizavel por
 * extratores que aceitam `string | null` (ex: update_task), onde a checagem
 * de null acontece fora deste helper.
 *
 * @param value - Valor a validar (tipado como `unknown`)
 * @param field - Nome do campo (para a mensagem de erro)
 * @returns A string validada (narrowing para `string`)
 * @throws {McpToolError} INVALID_PARAMS quando nao e string ISO 8601 valida
 */
export function assertIso8601(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw invalidParams(field, 'ISO 8601 date string expected');
  }
  if (value.trim() === '' || Number.isNaN(Date.parse(value))) {
    throw invalidParams(field, 'ISO 8601 date string expected');
  }
  return value;
}

export function parseBigIntParam(value: string, field: string): bigint {
  try {
    return BigInt(value);
  } catch {
    throw invalidParams(field, 'valid bigint string expected');
  }
}

export function invalidParams(field: string, issue: string): McpToolError {
  return new McpToolError(MCP_ERROR_CODES.INVALID_PARAMS, 'Invalid params', {
    field,
    issue,
  });
}

/**
 * Garante que o contexto MCP autenticado possui o scope requerido pela tool.
 *
 * Espelha o padrao dos demais helpers deste arquivo (lancar `McpToolError`
 * com codigo JSON-RPC apropriado). Introduzido pelo ADR-V2-067 como o primeiro
 * consumidor de `ctx.scopes` no servidor MCP — tools legadas (criadas antes
 * deste helper) NAO chamam `requireScope` e mantem o comportamento anterior
 * de "key autenticada = libera tudo" (backward-compat explicito).
 *
 * Semantica:
 *   - `ctx.scopes` ausente, nao-array ou sem o scope alvo → joga FORBIDDEN
 *   - scope presente → retorna sem efeito (passa)
 *
 * @param ctx - Contexto da chamada MCP (preenchido por `McpKeyGuard` a partir
 *   dos scopes persistidos em DTabela -472 quando a key foi gerada)
 * @param scope - Scope obrigatorio para executar a tool (ex: 'executions:create')
 * @throws {McpToolError} FORBIDDEN (-32002) quando o scope nao esta presente;
 *   `data.requiredScope` traz o scope que faltou para diagnostico cliente-side
 *
 * @example
 * ```typescript
 * // dentro de uma tool que exige scope
 * async handler(params: unknown, ctx: McpUserContext) {
 *   requireScope(ctx, 'executions:create');
 *   // ... fluxo normal da tool
 * }
 * ```
 */
export function requireScope(ctx: McpUserContext, scope: string): void {
  if (!Array.isArray(ctx.scopes) || !ctx.scopes.includes(scope)) {
    throw new McpToolError(MCP_ERROR_CODES.FORBIDDEN, 'Forbidden', {
      requiredScope: scope,
    });
  }
}

export function textResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  };
}

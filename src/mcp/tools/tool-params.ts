import { MCP_ERROR_CODES } from '../constants';
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

export function requiredString(
  params: Record<string, unknown>,
  field: string,
): string {
  const value = params[field];
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalidParams(field, 'required string');
  }

  return value;
}

export function optionalString(
  params: Record<string, unknown>,
  field: string,
): string | undefined {
  const value = params[field];
  if (value === undefined || value === null) {
    return undefined;
  }
  if (typeof value !== 'string' || value.trim() === '') {
    throw invalidParams(field, 'string expected');
  }

  return value;
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

export function textResult(payload: unknown) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
  };
}

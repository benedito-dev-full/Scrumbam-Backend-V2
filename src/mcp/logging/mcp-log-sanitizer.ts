const MCP_KEY_HEADER_PATTERN = /(["']?x-mcp-key["']?\s*[:=]\s*)(["']?)[^"',}\s]+(\2)/gi;

export function sanitizeMcpLogValue(value: unknown): unknown {
  if (typeof value === 'string') {
    return value.replace(MCP_KEY_HEADER_PATTERN, '$1$2[REDACTED]$3');
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeMcpLogValue(item));
  }

  if (value && typeof value === 'object') {
    const sanitized: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      sanitized[key] =
        key.toLowerCase() === 'x-mcp-key'
          ? '[REDACTED]'
          : sanitizeMcpLogValue(entry);
    }
    return sanitized;
  }

  return value;
}

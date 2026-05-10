import { ConsoleLogger, Injectable, LogLevel } from '@nestjs/common';

import { sanitizeMcpLogValue } from './mcp-log-sanitizer';

@Injectable()
export class SanitizingLogger extends ConsoleLogger {
  constructor(context?: string, options?: { logLevels?: LogLevel[] }) {
    super(context ?? 'Application', options ?? {});
  }

  log(message: unknown, ...optionalParams: unknown[]): void {
    super.log(sanitizeMcpLogValue(message), ...this.sanitizeParams(optionalParams));
  }

  error(message: unknown, ...optionalParams: unknown[]): void {
    super.error(sanitizeMcpLogValue(message), ...this.sanitizeParams(optionalParams));
  }

  warn(message: unknown, ...optionalParams: unknown[]): void {
    super.warn(sanitizeMcpLogValue(message), ...this.sanitizeParams(optionalParams));
  }

  debug(message: unknown, ...optionalParams: unknown[]): void {
    super.debug(sanitizeMcpLogValue(message), ...this.sanitizeParams(optionalParams));
  }

  verbose(message: unknown, ...optionalParams: unknown[]): void {
    super.verbose(sanitizeMcpLogValue(message), ...this.sanitizeParams(optionalParams));
  }

  private sanitizeParams(params: unknown[]): unknown[] {
    return params.map((param) => sanitizeMcpLogValue(param));
  }
}

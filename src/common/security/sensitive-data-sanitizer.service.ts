import { Injectable } from '@nestjs/common';

const SENSITIVE_KEY_PATTERN =
  /(^authorization$|^ssh$|token$|secret$|key$|password$|apiKey|privateKey)/i;
const REDACTED = '[REDACTED]';

@Injectable()
export class SensitiveDataSanitizerService {
  sanitize<T>(value: T): T {
    return this.sanitizeValue(value) as T;
  }

  sanitizeRecord<T extends Record<string, unknown>>(value: T): T {
    return this.sanitizeValue(value) as T;
  }

  private sanitizeValue(value: unknown): unknown {
    if (Array.isArray(value)) {
      return value.map((item) => this.sanitizeValue(item));
    }

    if (!value || typeof value !== 'object') {
      return value;
    }

    const output: Record<string, unknown> = {};
    for (const [key, item] of Object.entries(value)) {
      output[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED
        : this.sanitizeValue(item);
    }

    return output;
  }
}

import { cleanCpfCnpj } from './clean-cpf-cnpj.util';

/**
 * Valida um CPF usando o algoritmo de dígitos verificadores.
 *
 * Aceita CPF com ou sem formatação (`123.456.789-09` ou `12345678909`).
 * Rejeita CPFs com todos os dígitos iguais (ex: `11111111111`).
 *
 * Algoritmo:
 * 1. Remove formatação.
 * 2. Rejeita se não tiver 11 dígitos ou todos iguais.
 * 3. Calcula e verifica o 1º dígito verificador.
 * 4. Calcula e verifica o 2º dígito verificador.
 *
 * @param cpf - CPF formatado ou não
 * @returns `true` se o CPF for válido, `false` caso contrário
 *
 * @example
 * ```typescript
 * validateCpf('123.456.789-09'); // true (CPF válido formatado)
 * validateCpf('12345678909');    // true (CPF válido sem formatação)
 * validateCpf('111.111.111-11'); // false (todos dígitos iguais)
 * validateCpf('123.456.789-00'); // false (dígitos verificadores incorretos)
 * ```
 */
export function validateCpf(cpf: string): boolean {
  const cleaned = cleanCpfCnpj(cpf);

  if (cleaned.length !== 11) return false;

  // Rejeitar CPFs com todos os dígitos iguais
  if (/^(\d)\1{10}$/.test(cleaned)) return false;

  // Calcular 1º dígito verificador
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    sum += parseInt(cleaned[i]) * (10 - i);
  }
  let remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(cleaned[9])) return false;

  // Calcular 2º dígito verificador
  sum = 0;
  for (let i = 0; i < 10; i++) {
    sum += parseInt(cleaned[i]) * (11 - i);
  }
  remainder = (sum * 10) % 11;
  if (remainder === 10 || remainder === 11) remainder = 0;
  if (remainder !== parseInt(cleaned[10])) return false;

  return true;
}

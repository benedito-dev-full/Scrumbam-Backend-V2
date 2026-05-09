import { cleanCpfCnpj } from './clean-cpf-cnpj.util';

/**
 * Valida um CNPJ usando o algoritmo de dígitos verificadores.
 *
 * Aceita CNPJ com ou sem formatação (`12.345.678/0001-95` ou `12345678000195`).
 * Rejeita CNPJs com todos os dígitos iguais (ex: `00000000000000`).
 *
 * Algoritmo:
 * 1. Remove formatação.
 * 2. Rejeita se não tiver 14 dígitos ou todos iguais.
 * 3. Calcula e verifica o 1º dígito verificador (pesos 5,4,3,2,9,8,7,6,5,4,3,2).
 * 4. Calcula e verifica o 2º dígito verificador (pesos 6,5,4,3,2,9,8,7,6,5,4,3,2).
 *
 * @param cnpj - CNPJ formatado ou não
 * @returns `true` se o CNPJ for válido, `false` caso contrário
 *
 * @example
 * ```typescript
 * validateCnpj('11.222.333/0001-81'); // true (CNPJ válido formatado)
 * validateCnpj('11222333000181');      // true (CNPJ válido sem formatação)
 * validateCnpj('00.000.000/0000-00'); // false (todos dígitos iguais)
 * validateCnpj('12.345.678/0001-00'); // false (dígitos verificadores incorretos)
 * ```
 */
export function validateCnpj(cnpj: string): boolean {
  const cleaned = cleanCpfCnpj(cnpj);

  if (cleaned.length !== 14) return false;

  // Rejeitar CNPJs com todos os dígitos iguais
  if (/^(\d)\1{13}$/.test(cleaned)) return false;

  // Pesos para 1º dígito verificador
  const weights1 = [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += parseInt(cleaned[i]) * weights1[i];
  }
  let remainder = sum % 11;
  const digit1 = remainder < 2 ? 0 : 11 - remainder;
  if (digit1 !== parseInt(cleaned[12])) return false;

  // Pesos para 2º dígito verificador
  const weights2 = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
  sum = 0;
  for (let i = 0; i < 13; i++) {
    sum += parseInt(cleaned[i]) * weights2[i];
  }
  remainder = sum % 11;
  const digit2 = remainder < 2 ? 0 : 11 - remainder;
  if (digit2 !== parseInt(cleaned[13])) return false;

  return true;
}

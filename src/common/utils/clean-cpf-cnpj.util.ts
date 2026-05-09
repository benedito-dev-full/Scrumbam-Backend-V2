/**
 * Remove caracteres de formatação de CPF/CNPJ.
 *
 * Elimina pontos (`.`), traços (`-`) e barras (`/`) deixando apenas dígitos.
 * Não valida o formato ou os dígitos verificadores.
 *
 * @param input - CPF ou CNPJ formatado ou não (ex: `123.456.789-09`, `12.345.678/0001-95`)
 * @returns String contendo apenas dígitos (ex: `12345678909`, `12345678000195`)
 *
 * @example
 * ```typescript
 * cleanCpfCnpj('123.456.789-09');   // '12345678909'
 * cleanCpfCnpj('12.345.678/0001-95'); // '12345678000195'
 * cleanCpfCnpj('12345678909');        // '12345678909' (já limpo)
 * ```
 */
export function cleanCpfCnpj(input: string): string {
  return input.replace(/[.\-/]/g, '');
}

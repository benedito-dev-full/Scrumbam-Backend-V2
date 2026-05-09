import { validateCpf } from './validate-cpf.util';
import { validateCnpj } from './validate-cnpj.util';

describe('validateCpf', () => {
  it('deve retornar true para CPF válido formatado', () => {
    // CPF válido com formatação
    expect(validateCpf('529.982.247-25')).toBe(true);
  });

  it('deve retornar true para CPF válido sem formatação', () => {
    // Mesmo CPF sem formatação
    expect(validateCpf('52998224725')).toBe(true);
  });

  it('deve retornar false para CPF inválido (dígitos verificadores errados)', () => {
    expect(validateCpf('123.456.789-00')).toBe(false);
  });

  it('deve retornar false para CPF com todos os dígitos iguais', () => {
    expect(validateCpf('111.111.111-11')).toBe(false);
    expect(validateCpf('00000000000')).toBe(false);
    expect(validateCpf('999.999.999-99')).toBe(false);
  });
});

describe('validateCnpj', () => {
  it('deve retornar true para CNPJ válido formatado', () => {
    // CNPJ válido com formatação
    expect(validateCnpj('11.222.333/0001-81')).toBe(true);
  });

  it('deve retornar true para CNPJ válido sem formatação', () => {
    // Mesmo CNPJ sem formatação
    expect(validateCnpj('11222333000181')).toBe(true);
  });

  it('deve retornar false para CNPJ inválido (dígitos verificadores errados)', () => {
    expect(validateCnpj('12.345.678/0001-00')).toBe(false);
  });

  it('deve retornar false para CNPJ com todos os dígitos iguais', () => {
    expect(validateCnpj('00.000.000/0000-00')).toBe(false);
    expect(validateCnpj('11111111111111')).toBe(false);
  });
});

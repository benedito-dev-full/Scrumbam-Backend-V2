import { BadRequestException } from '@nestjs/common';
import { ParseBigIntPipe } from './parse-bigint.pipe';

describe('ParseBigIntPipe', () => {
  let pipe: ParseBigIntPipe;

  beforeEach(() => {
    pipe = new ParseBigIntPipe();
  });

  it('converte número positivo válido para bigint', () => {
    expect(pipe.transform('42')).toBe(BigInt(42));
  });

  it('converte número negativo válido para bigint', () => {
    expect(pipe.transform('-150')).toBe(BigInt(-150));
  });

  it('lança BadRequestException para string vazia', () => {
    expect(() => pipe.transform('')).toThrow(BadRequestException);
  });

  it('lança BadRequestException para string não-numérica', () => {
    expect(() => pipe.transform('abc')).toThrow(BadRequestException);
  });

  it('lança BadRequestException para string com ponto decimal', () => {
    expect(() => pipe.transform('1.5')).toThrow(BadRequestException);
  });
});

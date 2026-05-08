/**
 * Testes unit do validador de hierarquia de DClasses (Pilar 3 — F1).
 *
 * Cobre os 6 cenarios listados no DoD-08 do plano:
 *   1. arvore valida (classesFixas direto)
 *   2. ciclo direto    (A -> B -> A)
 *   3. ciclo indireto  (A -> B -> C -> A)
 *   4. idPai inexistente
 *   5. sequestro de chave canonica reservada
 *   6. chave duplicada
 * Bonus: chave positiva (DoD-09 / DoD-10).
 */

import {
  validateHierarchy,
  CANONICAL_RESERVED,
  FIXED_RANGE_MIN,
  FIXED_RANGE_MAX,
  isInFixedRange,
  type DClasseSeed,
} from '../validate-hierarchy';
import { classesFixas } from '../../../templates/classes-base-template';

/** Helper para criar seed minimo com defaults sensatos. */
function seed(
  chave: number,
  codigo: string,
  idPai: number | null,
  agrupamento = false,
): DClasseSeed {
  return {
    chave,
    codigo,
    nome: codigo,
    idPai,
    agrupamento,
    inativo: false,
    excluido: false,
    excluivel: false,
    editavel: false,
    tableFields: null,
    baseFields: false,
  };
}

describe('validateHierarchy', () => {
  it('passa em arvore valida (classesFixas template)', () => {
    expect(() => validateHierarchy(classesFixas)).not.toThrow();
  });

  it('rejeita ciclo direto (A -> B -> A)', () => {
    const classes: DClasseSeed[] = [
      seed(-1, 'ROOT', null, true),
      seed(-200, 'A', -201),
      seed(-201, 'B', -200),
    ];
    expect(() => validateHierarchy(classes)).toThrow(/\[validate-hierarchy\] ciclo detectado/);
  });

  it('rejeita ciclo indireto (A -> B -> C -> A)', () => {
    const classes: DClasseSeed[] = [
      seed(-1, 'ROOT', null, true),
      seed(-300, 'A', -301),
      seed(-301, 'B', -302),
      seed(-302, 'C', -300),
    ];
    expect(() => validateHierarchy(classes)).toThrow(/\[validate-hierarchy\] ciclo detectado/);
  });

  it('rejeita idPai inexistente', () => {
    const classes: DClasseSeed[] = [seed(-1, 'ROOT', null, true), seed(-400, 'ORFA', -9999)];
    expect(() => validateHierarchy(classes)).toThrow(/\[validate-hierarchy\] idPai inexistente/);
  });

  it('rejeita sequestro de chave canonica reservada (-47)', () => {
    // -47 e SELLER do Dinpayz, NAO pode aparecer em seed Scrumban-V2
    const classes: DClasseSeed[] = [...classesFixas, seed(-47, 'USER_FAKE', -43)];
    expect(() => validateHierarchy(classes)).toThrow(
      /\[validate-hierarchy\] sequestro de chave canonica reservada/,
    );
  });

  it('rejeita chave duplicada', () => {
    const classes: DClasseSeed[] = [
      seed(-1, 'ROOT', null, true),
      seed(-500, 'X', -1),
      seed(-500, 'Y', -1),
    ];
    expect(() => validateHierarchy(classes)).toThrow(
      /\[validate-hierarchy\] chave\(s\) duplicada\(s\)/,
    );
  });

  it('rejeita chave positiva (seeds devem ser sempre negativas)', () => {
    const classes: DClasseSeed[] = [seed(-1, 'ROOT', null, true), seed(100, 'POS', -1)];
    expect(() => validateHierarchy(classes)).toThrow(/\[validate-hierarchy\] chaves nao-negativas/);
  });

  it('rejeita root duplicado (mais de uma classe com idPai=null)', () => {
    const classes: DClasseSeed[] = [seed(-1, 'ROOT', null, true), seed(-2, 'ROOT2', null, true)];
    expect(() => validateHierarchy(classes)).toThrow(
      /\[validate-hierarchy\] deve haver exatamente 1 root/,
    );
  });

  it('rejeita root com chave diferente de -1', () => {
    const classes: DClasseSeed[] = [seed(-99, 'NOT_ROOT', null, true)];
    expect(() => validateHierarchy(classes)).toThrow(
      /\[validate-hierarchy\] root deve ter chave=-1/,
    );
  });

  it('exporta CANONICAL_RESERVED com as 5 chaves protegidas', () => {
    expect(CANONICAL_RESERVED).toEqual([-40n, -45n, -47n, -49n, -50n]);
  });

  it('rejeita array vazio', () => {
    expect(() => validateHierarchy([])).toThrow(/\[validate-hierarchy\] array de classes vazio/);
  });

  it('expoe FIXED_RANGE_MIN/MAX e isInFixedRange para validacoes externas', () => {
    expect(FIXED_RANGE_MIN).toBe(-110n);
    expect(FIXED_RANGE_MAX).toBe(-1n);
    // chaves no range fixo Devari-Core
    expect(isInFixedRange(-1)).toBe(true);
    expect(isInFixedRange(-43)).toBe(true);
    expect(isInFixedRange(-110)).toBe(true);
    expect(isInFixedRange(-43n)).toBe(true);
    // chaves fora do range fixo (especificas Scrumban-V2 ou runtime)
    expect(isInFixedRange(-150)).toBe(false);
    expect(isInFixedRange(-300)).toBe(false);
    expect(isInFixedRange(-527)).toBe(false);
    expect(isInFixedRange(0)).toBe(false);
    expect(isInFixedRange(100)).toBe(false);
    expect(isInFixedRange(-111)).toBe(false);
  });
});

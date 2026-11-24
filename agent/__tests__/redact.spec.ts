/** security/redact.ts — Ciclo 2 / M3 (ADR-V2-083). */
import { buildRedactor, redactDeep, REDACTED } from '../src/security/redact';

describe('buildRedactor', () => {
  it('redige tokens conhecidos do ambiente e segredos da config', () => {
    const r = buildRedactor(
      { GITHUB_TOKEN: 'ghp_aaaaaaaaaaaa', GH_TOKEN: 'gho_bbbbbbbbbbbb', ANTHROPIC_API_KEY: 'sk-ant-cccccccc' },
      ['agent-api-key-123456'],
    );
    expect(r('a ghp_aaaaaaaaaaaa b gho_bbbbbbbbbbbb c sk-ant-cccccccc d agent-api-key-123456')).toBe(
      `a ${REDACTED} b ${REDACTED} c ${REDACTED} d ${REDACTED}`,
    );
  });

  it('pega qualquer variável cujo NOME termina em TOKEN/SECRET/KEY/PASSWORD', () => {
    const r = buildRedactor({ NPM_TOKEN: 'npm_xxxxxxxxxx', DB_PASSWORD: 'senha-forte-1', MY_SECRET: 'segredo-xyz' });
    expect(r('npm_xxxxxxxxxx senha-forte-1 segredo-xyz')).toBe(`${REDACTED} ${REDACTED} ${REDACTED}`);
  });

  it('ignora valores curtos e variáveis comuns (não apaga "true"/PATH)', () => {
    const r = buildRedactor({ CI_TOKEN: 'true', PATH: '/usr/bin:/bin', HOME: '/home/x' });
    expect(r('true /usr/bin:/bin /home/x')).toBe('true /usr/bin:/bin /home/x');
  });

  it('segredo que contém outro: o mais longo é redigido inteiro', () => {
    const r = buildRedactor({ A_TOKEN: 'abcdefgh', B_TOKEN: 'abcdefgh-ijkl' });
    expect(r('abcdefgh-ijkl')).toBe(REDACTED);
  });

  it('sem segredos ⇒ identidade', () => {
    expect(buildRedactor({})('nada')).toBe('nada');
  });
});

describe('redactDeep', () => {
  it('redige todas as strings de um payload aninhado (cópia, não muta)', () => {
    const r = buildRedactor({ GITHUB_TOKEN: 'ghp_zzzzzzzzzz' });
    const payload = { a: 'x ghp_zzzzzzzzzz', b: [{ c: 'ghp_zzzzzzzzzz' }], n: 1, z: null, ok: true };
    const out = redactDeep(payload, r);
    expect(out).toEqual({ a: `x ${REDACTED}`, b: [{ c: REDACTED }], n: 1, z: null, ok: true });
    expect(payload.a).toBe('x ghp_zzzzzzzzzz');
  });
});

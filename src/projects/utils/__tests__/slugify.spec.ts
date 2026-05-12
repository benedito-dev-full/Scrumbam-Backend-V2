import { fallbackSlug, MAX_SLUG_LENGTH, slugify } from '../slugify';

describe('slugify()', () => {
  describe('casos básicos', () => {
    it('converte espaços em hífens e força lowercase', () => {
      expect(slugify('Scrumban Backend V2')).toBe('scrumban-backend-v2');
    });

    it('remove acentos (NFD normalize) preservando letras base', () => {
      expect(slugify('Produção')).toBe('producao');
      expect(slugify('Ação Município')).toBe('acao-municipio');
      expect(slugify('ñandú')).toBe('nandu');
    });

    it('substitui símbolos não-alfanuméricos por hífen', () => {
      expect(slugify('Sistema de Produção / Fintech')).toBe('sistema-de-producao-fintech');
      expect(slugify('foo@bar.com')).toBe('foo-bar-com');
      expect(slugify('a+b=c')).toBe('a-b-c');
    });

    it('colapsa múltiplos hífens consecutivos', () => {
      expect(slugify('---a---b---')).toBe('a-b');
      expect(slugify('   espaços  múltiplos  ')).toBe('espacos-multiplos');
    });

    it('remove hífens das pontas (trim)', () => {
      expect(slugify('-foo-')).toBe('foo');
      expect(slugify('-bar-baz-')).toBe('bar-baz');
    });

    it('preserva dígitos', () => {
      expect(slugify('Projeto 2026 V2')).toBe('projeto-2026-v2');
    });
  });

  describe('edge cases', () => {
    it('string vazia retorna string vazia', () => {
      expect(slugify('')).toBe('');
    });

    it('apenas símbolos retorna string vazia (caller decide fallback)', () => {
      expect(slugify('!!!!!!')).toBe('');
      expect(slugify('@@@')).toBe('');
      expect(slugify('   ')).toBe('');
    });

    it('input não-string retorna string vazia (defensivo)', () => {
      // @ts-expect-error — intencional: testar guard runtime
      expect(slugify(null)).toBe('');
      // @ts-expect-error — intencional: testar guard runtime
      expect(slugify(undefined)).toBe('');
      // @ts-expect-error — intencional: testar guard runtime
      expect(slugify(123)).toBe('');
    });

    it('trunca em 50 caracteres', () => {
      const long = 'a'.repeat(100);
      const out = slugify(long);
      expect(out.length).toBe(50);
      expect(out).toBe('a'.repeat(50));
    });

    it('remove hífen final que possa surgir após truncar', () => {
      // Nome desenhado para truncar em posição que cai num hífen.
      // 48 chars + ' xx' → após replace e antes do trim: 'aaaa...a-xx', 51 chars.
      const nome = 'a'.repeat(48) + ' xx';
      const out = slugify(nome);
      expect(out).toBe('a'.repeat(48) + '-x');
      expect(out.length).toBe(50);
      // Garantir que não terminou em hífen.
      expect(out.endsWith('-')).toBe(false);
    });

    it('respeita MAX_SLUG_LENGTH constante', () => {
      const long = 'b'.repeat(200);
      expect(slugify(long).length).toBeLessThanOrEqual(MAX_SLUG_LENGTH);
    });
  });

  describe('idempotência', () => {
    it.each([
      'Scrumban Backend V2',
      'Sistema de Produção / Fintech',
      '   espaços  múltiplos  ',
      'Projeto 2026',
      'a'.repeat(100),
    ])('slugify(slugify(%j)) === slugify(%j)', (input) => {
      const once = slugify(input);
      const twice = slugify(once);
      expect(twice).toBe(once);
    });
  });
});

describe('fallbackSlug()', () => {
  it('produz slug com prefixo untitled-', () => {
    expect(fallbackSlug()).toMatch(/^untitled-[a-z0-9]+$/);
  });

  it('passa pela própria função slugify sem alterar (estável)', () => {
    const f = fallbackSlug();
    expect(slugify(f)).toBe(f);
  });
});

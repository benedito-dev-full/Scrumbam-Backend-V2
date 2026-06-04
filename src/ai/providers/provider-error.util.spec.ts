import {
  BadGatewayException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';
import {
  classifyProviderError,
  httpExceptionFor,
  timeoutExceptionFor,
  translateProviderError,
} from './provider-error.util';

/** Padroes de chave de cada vendor — usados nos testes de nao-vazamento. */
const KEY_PATTERNS = [/sk-ant-/, /sk-[A-Za-z0-9]/, /AIza[A-Za-z0-9]/];

describe('provider-error.util', () => {
  describe('classifyProviderError', () => {
    it('401 → auth', () => {
      expect(classifyProviderError({ status: 401 })).toBe('auth');
    });

    it('429 sem code → rate_limit', () => {
      expect(classifyProviderError({ status: 429 })).toBe('rate_limit');
    });

    it('429 com code rate_limit_exceeded → rate_limit', () => {
      expect(classifyProviderError({ status: 429, code: 'rate_limit_exceeded' })).toBe(
        'rate_limit',
      );
    });

    it('429 com code insufficient_quota → quota (distinto)', () => {
      expect(classifyProviderError({ status: 429, code: 'insufficient_quota' })).toBe('quota');
    });

    it('429 com type insufficient_quota → quota (distinto)', () => {
      expect(classifyProviderError({ status: 429, type: 'insufficient_quota' })).toBe('quota');
    });

    it('529 → overloaded', () => {
      expect(classifyProviderError({ status: 529 })).toBe('overloaded');
    });

    it('500 → upstream', () => {
      expect(classifyProviderError({ status: 500 })).toBe('upstream');
    });

    it('status null (desconhecido) → upstream', () => {
      expect(classifyProviderError({ status: null })).toBe('upstream');
    });
  });

  describe('httpExceptionFor', () => {
    it('auth → BadGatewayException (502)', () => {
      const ex = httpExceptionFor('auth', 'claude');
      expect(ex).toBeInstanceOf(BadGatewayException);
      expect(ex.getStatus()).toBe(502);
    });

    it('rate_limit → ServiceUnavailableException (503)', () => {
      const ex = httpExceptionFor('rate_limit', 'openai');
      expect(ex).toBeInstanceOf(ServiceUnavailableException);
      expect(ex.getStatus()).toBe(503);
    });

    it('quota → ServiceUnavailableException (503) com mensagem distinta de rate_limit', () => {
      const quota = httpExceptionFor('quota', 'openai');
      const rate = httpExceptionFor('rate_limit', 'openai');
      expect(quota).toBeInstanceOf(ServiceUnavailableException);
      expect(quota.getStatus()).toBe(503);
      expect(quota.message).not.toBe(rate.message);
      expect(quota.message.toLowerCase()).toContain('cota');
    });

    it('timeout → GatewayTimeoutException (504)', () => {
      const ex = httpExceptionFor('timeout', 'gemini');
      expect(ex).toBeInstanceOf(GatewayTimeoutException);
      expect(ex.getStatus()).toBe(504);
    });

    it('overloaded → ServiceUnavailableException (503)', () => {
      const ex = httpExceptionFor('overloaded', 'claude');
      expect(ex).toBeInstanceOf(ServiceUnavailableException);
      expect(ex.getStatus()).toBe(503);
      expect(ex.message.toLowerCase()).toContain('sobrecarregado');
    });

    it('upstream → BadGatewayException (502)', () => {
      const ex = httpExceptionFor('upstream', 'claude');
      expect(ex).toBeInstanceOf(BadGatewayException);
      expect(ex.getStatus()).toBe(502);
    });
  });

  describe('translateProviderError (classify + httpExceptionFor)', () => {
    it('401 → BadGateway, 429 → ServiceUnavailable, 529 → ServiceUnavailable, 500 → BadGateway', () => {
      expect(translateProviderError({ status: 401 }, 'openai')).toBeInstanceOf(BadGatewayException);
      expect(translateProviderError({ status: 429 }, 'openai')).toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(translateProviderError({ status: 529 }, 'claude')).toBeInstanceOf(
        ServiceUnavailableException,
      );
      expect(translateProviderError({ status: 500 }, 'gemini')).toBeInstanceOf(
        BadGatewayException,
      );
    });

    it('insufficient_quota (OpenAI) produz mensagem de cota, distinta do rate limit', () => {
      const quota = translateProviderError(
        { status: 429, code: 'insufficient_quota' },
        'openai',
      );
      const rate = translateProviderError({ status: 429, code: 'rate_limit_exceeded' }, 'openai');
      expect(quota.message).not.toBe(rate.message);
    });
  });

  describe('nao-vazamento de detalhe do vendor / chave', () => {
    const categories = ['auth', 'rate_limit', 'quota', 'timeout', 'overloaded', 'upstream'] as const;

    it.each(categories)('categoria %s nao vaza chave nem detalhe cru do vendor', (cat) => {
      // Simula um contexto "sujo" com chave e corpo bruto — nada disso deve
      // aparecer na mensagem amigavel.
      const ex = httpExceptionFor(cat, 'claude');
      for (const pat of KEY_PATTERNS) {
        expect(ex.message).not.toMatch(pat);
      }
      expect(ex.message).not.toMatch(/sk-ant-test-key/);
      expect(ex.message).not.toMatch(/stack/i);
      // Mensagem e amigavel em PT-BR (cita "provedor de IA").
      expect(ex.message.toLowerCase()).toContain('provedor de ia');
    });
  });

  describe('timeoutExceptionFor', () => {
    it('retorna GatewayTimeoutException (504) com mensagem amigavel', () => {
      const ex = timeoutExceptionFor('gemini');
      expect(ex).toBeInstanceOf(GatewayTimeoutException);
      expect(ex.getStatus()).toBe(504);
      expect(ex.message.toLowerCase()).toContain('demorou');
    });
  });
});

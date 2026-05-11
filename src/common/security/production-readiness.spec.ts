import { assertProductionReady, validateProductionEnvironment } from './production-readiness';

describe('production-readiness', () => {
  it('nao bloqueia fora de producao', () => {
    expect(
      validateProductionEnvironment({
        NODE_ENV: 'development',
      } as NodeJS.ProcessEnv),
    ).toHaveLength(0);
  });

  it('rejeita ambiente de producao com variaveis obrigatorias ausentes', () => {
    const issues = validateProductionEnvironment({
      NODE_ENV: 'production',
    } as NodeJS.ProcessEnv);

    expect(issues.map((issue) => issue.key)).toEqual(
      expect.arrayContaining(['DATABASE_URL', 'CORS_ORIGIN', 'REDIS_URL', 'JWT_SECRET']),
    );
  });

  it('rejeita segredos fracos e endpoints locais em producao', () => {
    const issues = validateProductionEnvironment({
      NODE_ENV: 'production',
      DATABASE_URL: 'postgresql://user:pass@localhost:5432/app',
      CORS_ORIGIN: 'http://localhost:3001',
      REDIS_URL: 'redis://127.0.0.1:6379',
      JWT_SECRET: 'change-me-in-production',
    } as NodeJS.ProcessEnv);

    expect(issues.some((issue) => issue.key === 'JWT_SECRET')).toBe(true);
    expect(issues.some((issue) => issue.key === 'DATABASE_URL')).toBe(true);
    expect(issues.some((issue) => issue.key === 'CORS_ORIGIN')).toBe(true);
    expect(issues.some((issue) => issue.key === 'REDIS_URL')).toBe(true);
  });

  it('aceita ambiente de producao com configuracao forte', () => {
    expect(() =>
      assertProductionReady({
        NODE_ENV: 'production',
        DATABASE_URL: 'postgresql://user:pass@db.internal:5432/app',
        CORS_ORIGIN: 'https://app.example.com',
        REDIS_URL: 'redis://redis.internal:6379',
        JWT_SECRET: 'a-very-long-production-secret-value-123456',
      } as NodeJS.ProcessEnv),
    ).not.toThrow();
  });
});

import { UnauthorizedException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { classifyInfraError } from '../infra-error.util';

describe('classifyInfraError (F0 — separa infra de credencial)', () => {
  it('classifica pool timeout do Prisma (P2024) como INFRA', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Timed out fetching a connection', {
      code: 'P2024',
      clientVersion: '5.7.0',
    });

    const info = classifyInfraError(err);

    expect(info.isInfra).toBe(true);
    expect(info.code).toBe('P2024');
    expect(info.kind).toBe('prisma_known');
  });

  it('classifica banco inalcançável (P1001) como INFRA', () => {
    const err = new Prisma.PrismaClientKnownRequestError("Can't reach database server", {
      code: 'P1001',
      clientVersion: '5.7.0',
    });

    expect(classifyInfraError(err).isInfra).toBe(true);
  });

  it('NÃO classifica erro de dado (P2025 — registro inexistente) como infra', () => {
    const err = new Prisma.PrismaClientKnownRequestError('Record not found', {
      code: 'P2025',
      clientVersion: '5.7.0',
    });

    const info = classifyInfraError(err);

    expect(info.isInfra).toBe(false);
    expect(info.code).toBe('P2025');
  });

  it('classifica UnauthorizedException como CREDENCIAL (não infra)', () => {
    const info = classifyInfraError(new UnauthorizedException('Token inválido'));

    expect(info.isInfra).toBe(false);
    expect(info.kind).toBe('credential');
  });

  it('classifica falha de rede/Redis pela mensagem como INFRA', () => {
    expect(classifyInfraError(new Error('connect ECONNREFUSED 127.0.0.1:6379')).isInfra).toBe(true);
    expect(classifyInfraError(new Error('Redis connection is closed')).isInfra).toBe(true);
  });

  it('não quebra com valor não-Error', () => {
    const info = classifyInfraError('string solta');

    expect(info.isInfra).toBe(false);
    expect(info.kind).toBe('unknown');
  });
});

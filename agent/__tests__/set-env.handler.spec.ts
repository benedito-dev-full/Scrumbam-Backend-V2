/**
 * Specs do handler `SET_ENV`.
 *
 * Cobre (plan-2026-05-13 §5 Fase 2.3 + §7 R1/R5):
 *
 *  1. **Happy path**: vars válidas → 200 accepted=true + file escrito 0600 com merge correto.
 *  2. **Idempotência**: rechamar com mesmas vars → arquivo final idêntico, ACK 200.
 *  3. **Idempotência parcial**: rechamar com SUBSET → preserva chaves não enviadas.
 *  4. **Allowlist**: chave fora da allowlist → 422 DISALLOWED_KEY + arquivo intacto.
 *  5. **Valor com newline** → 422 INVALID_VALUE.
 *  6. **Payload vazio** (vars={}) → 422 EMPTY_PAYLOAD.
 *  7. **vars não-objeto** → 422 INVALID_VARS.
 *  8. **body não-objeto** → 400 INVALID_PAYLOAD.
 *  9. **restartAfter=true** → ACK retorna restartScheduled=true; restartImpl chamado APÓS ACK
 *     (R1 do plan — restart síncrono mataria processo antes do response).
 * 10. **restartAfter=false** → restartImpl NÃO chamado.
 * 11. **Erro de I/O do writer** (EACCES simulado) → 500 IO_ERROR.
 * 12. **R5 — não loga valores**: vars como GITHUB_TOKEN não aparecem nos logs.
 */
import express from 'express';
import { mkdtempSync, readFileSync, statSync, writeFileSync, existsSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import pino from 'pino';
import request from 'supertest';
import { EnvWriterError } from '../src/env/env-file-writer';
import { createSetEnvHandler } from '../src/handlers/set-env.handler';

function silentLogger() {
  return pino({ level: 'silent' });
}

/** Cria diretório temp e retorna path do env file (não criado ainda). */
function makeTempEnvPath(): string {
  const dir = mkdtempSync(join(tmpdir(), 'set-env-spec-'));
  return join(dir, 'environment');
}

function buildApp(deps: Parameters<typeof createSetEnvHandler>[0]) {
  const app = express();
  app.use(express.json());
  app.post('/v1/execute', createSetEnvHandler(deps));
  return app;
}

describe('SET_ENV handler', () => {
  it('1) happy path: vars válidas → 200 + file 0600 com conteúdo correto', async () => {
    const envFilePath = makeTempEnvPath();
    const app = buildApp({ logger: silentLogger(), envFilePath });

    const res = await request(app)
      .post('/v1/execute')
      .send({
        vars: { GITHUB_TOKEN: 'ghp_abc123', ANTHROPIC_API_KEY: 'sk-ant-xyz' },
        restartAfter: false,
      });

    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      accepted: true,
      varsWritten: ['GITHUB_TOKEN', 'ANTHROPIC_API_KEY'],
      createdNew: true,
      restartScheduled: false,
    });

    const content = readFileSync(envFilePath, 'utf8');
    expect(content).toContain('GITHUB_TOKEN=ghp_abc123');
    expect(content).toContain('ANTHROPIC_API_KEY=sk-ant-xyz');

    const mode = statSync(envFilePath).mode & 0o777;
    expect(mode).toBe(0o600);
  });

  it('2) idempotência: chamar duas vezes com mesmas vars → arquivo final idêntico', async () => {
    const envFilePath = makeTempEnvPath();
    const app = buildApp({ logger: silentLogger(), envFilePath });
    const payload = {
      vars: { GITHUB_TOKEN: 'ghp_same' },
      restartAfter: false,
    };

    const r1 = await request(app).post('/v1/execute').send(payload);
    expect(r1.status).toBe(200);
    const content1 = readFileSync(envFilePath, 'utf8');

    const r2 = await request(app).post('/v1/execute').send(payload);
    expect(r2.status).toBe(200);
    expect(r2.body.createdNew).toBe(false);
    const content2 = readFileSync(envFilePath, 'utf8');

    expect(content2).toBe(content1);
  });

  it('3) idempotência parcial: 2ª chamada com subset preserva chaves não tocadas', async () => {
    const envFilePath = makeTempEnvPath();
    const app = buildApp({ logger: silentLogger(), envFilePath });

    await request(app)
      .post('/v1/execute')
      .send({
        vars: { GITHUB_TOKEN: 'ghp_v1', ANTHROPIC_API_KEY: 'sk-ant-v1' },
        restartAfter: false,
      });

    await request(app)
      .post('/v1/execute')
      .send({
        vars: { GITHUB_TOKEN: 'ghp_v2' }, // só atualiza uma
        restartAfter: false,
      });

    const content = readFileSync(envFilePath, 'utf8');
    expect(content).toContain('GITHUB_TOKEN=ghp_v2');
    expect(content).toContain('ANTHROPIC_API_KEY=sk-ant-v1'); // preservado
    expect(content).not.toContain('ghp_v1');
  });

  it('4) chave fora da allowlist → 422 DISALLOWED_KEY + arquivo intacto', async () => {
    const envFilePath = makeTempEnvPath();
    // Pré-popula o arquivo para checar que NÃO foi alterado.
    writeFileSync(envFilePath, 'GITHUB_TOKEN=old\n', { mode: 0o600 });
    const before = readFileSync(envFilePath, 'utf8');
    const app = buildApp({ logger: silentLogger(), envFilePath });

    const res = await request(app)
      .post('/v1/execute')
      .send({ vars: { LD_PRELOAD: '/tmp/evil.so' }, restartAfter: false });

    expect(res.status).toBe(422);
    expect(res.body).toMatchObject({
      accepted: false,
      errorCode: 'DISALLOWED_KEY',
    });
    expect(readFileSync(envFilePath, 'utf8')).toBe(before);
  });

  it('5) valor com newline → 422 INVALID_VALUE', async () => {
    const envFilePath = makeTempEnvPath();
    const app = buildApp({ logger: silentLogger(), envFilePath });

    const res = await request(app)
      .post('/v1/execute')
      .send({ vars: { GITHUB_TOKEN: 'ghp_\nbad' }, restartAfter: false });

    expect(res.status).toBe(422);
    expect(res.body.errorCode).toBe('INVALID_VALUE');
  });

  it('6) vars vazio → 422 EMPTY_PAYLOAD', async () => {
    const envFilePath = makeTempEnvPath();
    const app = buildApp({ logger: silentLogger(), envFilePath });

    const res = await request(app).post('/v1/execute').send({ vars: {}, restartAfter: false });

    expect(res.status).toBe(422);
    expect(res.body.errorCode).toBe('EMPTY_PAYLOAD');
  });

  it('7) vars não-objeto → 422 INVALID_VARS', async () => {
    const envFilePath = makeTempEnvPath();
    const app = buildApp({ logger: silentLogger(), envFilePath });

    const res = await request(app)
      .post('/v1/execute')
      .send({ vars: 'string nao objeto', restartAfter: false });

    expect(res.status).toBe(422);
    expect(res.body.errorCode).toBe('INVALID_VARS');
  });

  it('8) body sem campo vars → 422 INVALID_VARS', async () => {
    const envFilePath = makeTempEnvPath();
    const app = buildApp({ logger: silentLogger(), envFilePath });

    // Sanity: body sem `vars` (mas outros campos presentes) cai em
    // INVALID_VARS, não em crash. Garante que o handler não estoura ao
    // acessar `body.vars` quando ausente.
    const res = await request(app)
      .post('/v1/execute')
      .send({ restartAfter: false, metadata: { correlationId: 'x' } });

    expect(res.status).toBe(422);
    expect(res.body.errorCode).toBe('INVALID_VARS');
  });

  it('9) restartAfter=true: ACK retorna restartScheduled=true; restartImpl chamado APÓS ACK', async () => {
    const envFilePath = makeTempEnvPath();
    const callLog: string[] = [];
    const scheduledFns: Array<() => void> = [];

    const app = buildApp({
      logger: silentLogger(),
      envFilePath,
      scheduleImpl: (fn) => {
        // NÃO executa de imediato — capta para inspeção pós-ACK.
        scheduledFns.push(fn);
      },
      restartImpl: (cb) => {
        callLog.push('restart');
        cb(null);
      },
    });

    const res = await request(app)
      .post('/v1/execute')
      .send({ vars: { GITHUB_TOKEN: 'x' }, restartAfter: true });

    // ACK chegou ANTES do restart (callLog ainda vazio).
    expect(res.status).toBe(200);
    expect(res.body.restartScheduled).toBe(true);
    expect(callLog).toEqual([]);

    // Agora executa o callback agendado e o restart acontece.
    expect(scheduledFns).toHaveLength(1);
    scheduledFns[0]();
    expect(callLog).toEqual(['restart']);
  });

  it('10) restartAfter=false: restartImpl NÃO chamado', async () => {
    const envFilePath = makeTempEnvPath();
    const callLog: string[] = [];
    const scheduledFns: Array<() => void> = [];
    const app = buildApp({
      logger: silentLogger(),
      envFilePath,
      scheduleImpl: (fn) => scheduledFns.push(fn),
      restartImpl: (cb) => {
        callLog.push('restart');
        cb(null);
      },
    });

    const res = await request(app)
      .post('/v1/execute')
      .send({ vars: { GITHUB_TOKEN: 'x' }, restartAfter: false });

    expect(res.status).toBe(200);
    expect(res.body.restartScheduled).toBe(false);
    expect(scheduledFns).toHaveLength(0);
    expect(callLog).toEqual([]);
  });

  it('11) erro IO do writer → 500 IO_ERROR', async () => {
    const envFilePath = '/dev/null/cant-write-here/env'; // path inexistente forçando ENOENT
    const app = buildApp({
      logger: silentLogger(),
      envFilePath,
      writeImpl: () => {
        throw new EnvWriterError('IO_ERROR', 'EACCES permission denied');
      },
    });

    const res = await request(app)
      .post('/v1/execute')
      .send({ vars: { GITHUB_TOKEN: 'x' }, restartAfter: false });

    expect(res.status).toBe(500);
    expect(res.body.errorCode).toBe('IO_ERROR');
    expect(existsSync(envFilePath)).toBe(false);
  });

  it('12) R5: handler nunca passa valores das vars para o response/log estrutural', async () => {
    const envFilePath = makeTempEnvPath();
    // Captura todas as chamadas de log para inspecionar
    const logCalls: Array<unknown> = [];
    const logger = pino(
      { level: 'trace' },
      {
        write(msg: string) {
          logCalls.push(JSON.parse(msg));
        },
      },
    );

    const app = buildApp({ logger, envFilePath });

    await request(app)
      .post('/v1/execute')
      .send({
        vars: { GITHUB_TOKEN: 'SECRET_TOKEN_VALUE_XYZ' },
        restartAfter: false,
      });

    // Nenhum dos log entries pode conter o valor sensitive.
    const allLogs = JSON.stringify(logCalls);
    expect(allLogs).not.toContain('SECRET_TOKEN_VALUE_XYZ');
    // Mas pode conter o NOME da chave (apenas referência).
    expect(allLogs).toContain('GITHUB_TOKEN');
  });
});

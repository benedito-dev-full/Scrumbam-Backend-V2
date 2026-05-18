/**
 * Specs do `createDispatcher` em `agent/src/server/dispatcher.ts`.
 *
 * Foco DUPLO desta suite:
 *
 *  - **Regressão (R11 do plan 2026-05-13):** garantir que a adição dos
 *    novos `type`s `SET_ENV` e `GENERATE_DEPLOY_KEY` NÃO quebra `PING`
 *    nem o roteamento para `RUN_CLAUDE_CODE`. Argus está em produção
 *    rodando `RUN_CLAUDE_CODE` real — qualquer regressão silenciosa
 *    aqui bricka o canário.
 *
 *  - **Sanity dos novos types:** roteamento mínimo (request com `type`
 *    novo cai no handler novo injetado). Validação profunda dos
 *    handlers fica nas specs `set-env.handler.spec.ts` e
 *    `generate-deploy-key.handler.spec.ts`.
 *
 * Bypass do HMAC middleware via app Express mínimo — o foco aqui é o
 * dispatcher, não a cadeia de auth (já coberta em http.server.spec.ts).
 *
 * @see plan-2026-05-13-vps-project-config-via-frontend §7 R11
 */
import express from 'express';
import pino from 'pino';
import request from 'supertest';
import type { AgentConfig } from '../src/config/schema';
import { createDispatcher, SUPPORTED_TYPES_LIST } from '../src/server/dispatcher';
import { createProjectMutex } from '../src/handlers/run-claude-code.handler';
import type { BackendClient } from '../src/outbound/backend-client';

const TEST_CONFIG: AgentConfig = {
  agentId: 'agent-test-1',
  agentApiKey: 'api-test',
  agentCommandSecret: 'secret-test-hmac',
  backendBaseUrl: 'https://api.test.local',
  backendTunnelHost: 'tunnel.test.local',
  backendTunnelPort: 22,
  tunnelPort: 39999,
  bindHost: '127.0.0.1',
  allowedProjectRoots: ['/home/dev/projetos'],
  claudeMdPath: '/home/dev/.claude/CLAUDE.md',
  agentSshKeyPath: '/etc/scrumban-agent/ssh_key',
  logLevel: 'error',
};

function silentLogger() {
  return pino({ level: 'silent' });
}

function noopBackend(): BackendClient {
  return {
    async sendHeartbeat() {
      /* noop */
    },
    async sendExecutionResult() {
      /* noop */
    },
  };
}

/**
 * Constrói app Express mínimo só com o dispatcher (bypass HMAC). Permite
 * injetar handlers spy para verificar roteamento.
 */
function buildApp(overrides?: {
  runClaudeCodeHandler?: ReturnType<typeof jest.fn>;
  setEnvHandler?: ReturnType<typeof jest.fn>;
  generateDeployKeyHandler?: ReturnType<typeof jest.fn>;
  unprovisionProjectHandler?: ReturnType<typeof jest.fn>;
}) {
  const app = express();
  app.use(express.json());
  app.post(
    '/v1/execute',
    createDispatcher({
      config: TEST_CONFIG,
      logger: silentLogger(),
      backendClient: noopBackend(),
      mutex: createProjectMutex(),
      runClaudeCodeHandler: overrides?.runClaudeCodeHandler,
      setEnvHandler: overrides?.setEnvHandler,
      generateDeployKeyHandler: overrides?.generateDeployKeyHandler,
      unprovisionProjectHandler: overrides?.unprovisionProjectHandler,
    }),
  );
  return app;
}

describe('Dispatcher /v1/execute', () => {
  describe('PING (regressão)', () => {
    it('PING com executionId → 200 accepted=true message=pong', async () => {
      const app = buildApp();
      const res = await request(app)
        .post('/v1/execute')
        .send({ type: 'PING', executionId: 'exec-ping-1' });

      expect(res.status).toBe(200);
      expect(res.body).toEqual({
        accepted: true,
        executionId: 'exec-ping-1',
        message: 'pong',
      });
    });

    it('PING sem executionId → executionId=null', async () => {
      const app = buildApp();
      const res = await request(app).post('/v1/execute').send({ type: 'PING' });

      expect(res.status).toBe(200);
      expect(res.body.executionId).toBeNull();
    });
  });

  describe('RUN_CLAUDE_CODE (regressão — R11 plan 2026-05-13)', () => {
    it('roteia para o handler injetado exatamente UMA vez', async () => {
      const handler = jest.fn((_req, res) => {
        res.status(200).json({ accepted: true, executionId: 'exec-rcc-1', delegated: true });
      });
      const app = buildApp({ runClaudeCodeHandler: handler });

      const res = await request(app).post('/v1/execute').send({
        type: 'RUN_CLAUDE_CODE',
        executionId: 'exec-rcc-1',
        projectSlug: 'foo',
        prompt: 'p',
      });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ accepted: true, delegated: true });
    });

    it('NÃO chama set-env nem generate-deploy-key handlers', async () => {
      const rcc = jest.fn((_req, res) => res.status(200).json({ ok: true }));
      const setEnv = jest.fn();
      const genKey = jest.fn();
      const app = buildApp({
        runClaudeCodeHandler: rcc,
        setEnvHandler: setEnv,
        generateDeployKeyHandler: genKey,
      });

      await request(app).post('/v1/execute').send({
        type: 'RUN_CLAUDE_CODE',
        executionId: 'exec-rcc-2',
        projectSlug: 'foo',
        prompt: 'p',
      });

      expect(rcc).toHaveBeenCalledTimes(1);
      expect(setEnv).not.toHaveBeenCalled();
      expect(genKey).not.toHaveBeenCalled();
    });
  });

  describe('SET_ENV (novo type — sanity)', () => {
    it('roteia para setEnvHandler injetado', async () => {
      const handler = jest.fn((_req, res) =>
        res.status(200).json({ accepted: true, varsWritten: ['GITHUB_TOKEN'] }),
      );
      const app = buildApp({ setEnvHandler: handler });

      const res = await request(app)
        .post('/v1/execute')
        .send({ type: 'SET_ENV', vars: { GITHUB_TOKEN: 'ghp_x' }, restartAfter: false });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ accepted: true });
    });

    it('NÃO chama RUN_CLAUDE_CODE handler', async () => {
      const rcc = jest.fn();
      const setEnv = jest.fn((_req, res) => res.status(200).json({ accepted: true }));
      const app = buildApp({ runClaudeCodeHandler: rcc, setEnvHandler: setEnv });

      await request(app)
        .post('/v1/execute')
        .send({ type: 'SET_ENV', vars: {}, restartAfter: false });

      expect(rcc).not.toHaveBeenCalled();
      expect(setEnv).toHaveBeenCalledTimes(1);
    });
  });

  describe('GENERATE_DEPLOY_KEY (novo type — sanity)', () => {
    it('roteia para generateDeployKeyHandler injetado', async () => {
      const handler = jest.fn((_req, res) =>
        res.status(200).json({
          accepted: true,
          publicKey: 'ssh-ed25519 AAAA...',
          fingerprint: 'SHA256:abcd',
        }),
      );
      const app = buildApp({ generateDeployKeyHandler: handler });

      const res = await request(app)
        .post('/v1/execute')
        .send({ type: 'GENERATE_DEPLOY_KEY', projectSlug: 'dinpayz-backend' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ accepted: true, publicKey: expect.any(String) });
    });
  });

  describe('UNPROVISION_PROJECT (novo type — sanity)', () => {
    it('roteia para unprovisionProjectHandler injetado', async () => {
      const handler = jest.fn((_req, res) =>
        res.status(200).json({ accepted: true }),
      );
      const app = buildApp({ unprovisionProjectHandler: handler });

      const res = await request(app)
        .post('/v1/execute')
        .send({ type: 'UNPROVISION_PROJECT', projectSlug: 'meu-proj' });

      expect(handler).toHaveBeenCalledTimes(1);
      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({ accepted: true });
    });
  });

  describe('Erros padronizados (regressão)', () => {
    it('MISSING_TYPE quando body sem campo type', async () => {
      const app = buildApp();
      const res = await request(app).post('/v1/execute').send({ executionId: 'x' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        accepted: false,
        errorCode: 'MISSING_TYPE',
      });
      expect(res.body.supportedTypes).toEqual(
        expect.arrayContaining([
          'PING',
          'RUN_CLAUDE_CODE',
          'SET_ENV',
          'GENERATE_DEPLOY_KEY',
          'PROVISION_PROJECT',
          'UNPROVISION_PROJECT',
        ]),
      );
    });

    it('UNKNOWN_COMMAND_TYPE quando type desconhecido', async () => {
      const app = buildApp();
      const res = await request(app).post('/v1/execute').send({ type: 'DELETE_EVERYTHING' });

      expect(res.status).toBe(400);
      expect(res.body).toMatchObject({
        accepted: false,
        errorCode: 'UNKNOWN_COMMAND_TYPE',
      });
    });

    it('SUPPORTED_TYPES_LIST exposto contém todos os 6 tipos', () => {
      expect(SUPPORTED_TYPES_LIST).toEqual(
        expect.arrayContaining([
          'PING',
          'RUN_CLAUDE_CODE',
          'SET_ENV',
          'GENERATE_DEPLOY_KEY',
          'PROVISION_PROJECT',
          'UNPROVISION_PROJECT',
        ]),
      );
      expect(SUPPORTED_TYPES_LIST).toHaveLength(6);
    });
  });
});

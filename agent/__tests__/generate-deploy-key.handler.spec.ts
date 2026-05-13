/**
 * Specs do handler `GENERATE_DEPLOY_KEY`.
 *
 * Cobre (plan-2026-05-13 §5 Fase 2.4 + §7 R3 + §10 itens 6/10):
 *
 *  1. **Happy path**: slug válido → 200 com publicKey + fingerprint + alreadyExisted=false.
 *  2. **Idempotência**: 2ª chamada com mesmo slug → alreadyExisted=true; mesma pubkey/fingerprint.
 *  3. **Slug inválido (regex)**: `Foo!`, `../etc`, `WITH_CAP` → 422 INVALID_SLUG.
 *  4. **Slug ausente** → 422 INVALID_SLUG.
 *  5. **Slug muito longo (>64)** → 422 INVALID_SLUG.
 *  6. **Comment com newline** → 422 INVALID_COMMENT.
 *  7. **Comment muito longo (>256)** → 422 INVALID_COMMENT.
 *  8. **Privada nunca aparece no response**: stub generator coloca dados; checa que body só tem pubkey + fingerprint.
 *  9. **R3 path-injection**: handler delega ao generator que faz realpath check (validado em deploy-key-generator.spec).
 *     Aqui validamos que slug com chars permitidos pela regex (`-`, lowercase, digits) chega íntegro ao generator.
 */
import express from 'express';
import pino from 'pino';
import request from 'supertest';
import { DeployKeyError } from '../src/ssh/deploy-key-generator';
import { createGenerateDeployKeyHandler } from '../src/handlers/generate-deploy-key.handler';

function silentLogger() {
  return pino({ level: 'silent' });
}

function buildApp(deps: Parameters<typeof createGenerateDeployKeyHandler>[0]) {
  const app = express();
  app.use(express.json());
  app.post('/v1/execute', createGenerateDeployKeyHandler(deps));
  return app;
}

describe('GENERATE_DEPLOY_KEY handler', () => {
  it('1) happy path: slug válido → 200 + pubkey + fingerprint + alreadyExisted=false', async () => {
    const fakeGenerate = jest.fn(() => ({
      publicKey: 'ssh-ed25519 AAAAfake scrumban-agent@dinpayz-backend',
      fingerprint: 'SHA256:abc123def456',
      publicKeyPath: '/tmp/fake/dinpayz-backend.pub',
      alreadyExisted: false,
    }));

    const app = buildApp({
      logger: silentLogger(),
      generateImpl: fakeGenerate as never,
    });

    const res = await request(app).post('/v1/execute').send({ projectSlug: 'dinpayz-backend' });

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      accepted: true,
      publicKey: 'ssh-ed25519 AAAAfake scrumban-agent@dinpayz-backend',
      fingerprint: 'SHA256:abc123def456',
      alreadyExisted: false,
    });
    expect(fakeGenerate).toHaveBeenCalledTimes(1);
    expect(fakeGenerate).toHaveBeenCalledWith('dinpayz-backend', {
      baseDir: undefined,
      comment: undefined,
    });
  });

  it('2) idempotência: generator retorna alreadyExisted=true → handler propaga', async () => {
    const fakeGenerate = jest.fn(() => ({
      publicKey: 'ssh-ed25519 AAAAcached comment',
      fingerprint: 'SHA256:cached',
      publicKeyPath: '/tmp/fake/x.pub',
      alreadyExisted: true,
    }));

    const app = buildApp({
      logger: silentLogger(),
      generateImpl: fakeGenerate as never,
    });

    const res = await request(app).post('/v1/execute').send({ projectSlug: 'cached-project' });

    expect(res.status).toBe(200);
    expect(res.body.alreadyExisted).toBe(true);
  });

  it('3) slug inválido (regex) → 422 INVALID_SLUG (várias formas)', async () => {
    const fakeGenerate = jest.fn();
    const app = buildApp({
      logger: silentLogger(),
      generateImpl: fakeGenerate as never,
    });

    const badSlugs = ['Foo!', '../etc', 'WITH_CAP', 'has spaces', 'a/b', '.dotfile', 'x.y'];

    for (const slug of badSlugs) {
      const res = await request(app).post('/v1/execute').send({ projectSlug: slug });
      expect(res.status).toBe(422);
      expect(res.body.errorCode).toBe('INVALID_SLUG');
    }

    // Generator nunca chamado para slugs inválidos.
    expect(fakeGenerate).not.toHaveBeenCalled();
  });

  it('4) projectSlug ausente → 422 INVALID_SLUG', async () => {
    const app = buildApp({ logger: silentLogger() });

    const res = await request(app).post('/v1/execute').send({});
    expect(res.status).toBe(422);
    expect(res.body.errorCode).toBe('INVALID_SLUG');
  });

  it('5) slug com 65 chars → 422 INVALID_SLUG', async () => {
    const app = buildApp({ logger: silentLogger() });

    const longSlug = 'a'.repeat(65);
    const res = await request(app).post('/v1/execute').send({ projectSlug: longSlug });

    expect(res.status).toBe(422);
    expect(res.body.errorCode).toBe('INVALID_SLUG');
  });

  it('6) comment com newline → 422 INVALID_COMMENT', async () => {
    const app = buildApp({ logger: silentLogger() });

    const res = await request(app)
      .post('/v1/execute')
      .send({ projectSlug: 'ok', comment: 'evil\nentry' });

    expect(res.status).toBe(422);
    expect(res.body.errorCode).toBe('INVALID_COMMENT');
  });

  it('7) comment com >256 chars → 422 INVALID_COMMENT', async () => {
    const app = buildApp({ logger: silentLogger() });

    const res = await request(app)
      .post('/v1/execute')
      .send({ projectSlug: 'ok', comment: 'a'.repeat(257) });

    expect(res.status).toBe(422);
    expect(res.body.errorCode).toBe('INVALID_COMMENT');
  });

  it('8) response body NÃO contém privada nem path em disco', async () => {
    const fakeGenerate = jest.fn(() => ({
      publicKey: 'ssh-ed25519 AAAApub',
      fingerprint: 'SHA256:fp',
      publicKeyPath: '/etc/scrumban-agent/ssh-keys/secret-project.pub',
      alreadyExisted: false,
    }));

    const app = buildApp({
      logger: silentLogger(),
      generateImpl: fakeGenerate as never,
    });

    const res = await request(app).post('/v1/execute').send({ projectSlug: 'secret-project' });

    expect(res.status).toBe(200);
    // Whitelist explícita de campos. Nem privateKey, nem publicKeyPath, nem privatePath.
    expect(Object.keys(res.body).sort()).toEqual(
      ['accepted', 'alreadyExisted', 'fingerprint', 'publicKey'].sort(),
    );
    const bodyStr = JSON.stringify(res.body);
    expect(bodyStr).not.toContain('privateKey');
    expect(bodyStr).not.toContain('publicKeyPath');
    expect(bodyStr).not.toContain('/etc/scrumban-agent/');
  });

  it('9) generator lança INVALID_SLUG → 422 (defesa em profundidade)', async () => {
    // Cenário improvável (regex do handler já filtra), mas o handler
    // precisa propagar corretamente caso o generator rejeite.
    const fakeGenerate = jest.fn(() => {
      throw new DeployKeyError('INVALID_SLUG', 'slug rejeitado pelo generator');
    });

    const app = buildApp({
      logger: silentLogger(),
      generateImpl: fakeGenerate as never,
    });

    const res = await request(app).post('/v1/execute').send({ projectSlug: 'valid-slug-here' });

    expect(res.status).toBe(422);
    expect(res.body.errorCode).toBe('INVALID_SLUG');
  });

  it('10) generator lança PATH_ESCAPE → 422 PATH_ESCAPE', async () => {
    const fakeGenerate = jest.fn(() => {
      throw new DeployKeyError('PATH_ESCAPE', 'path escapou de baseDir');
    });

    const app = buildApp({
      logger: silentLogger(),
      generateImpl: fakeGenerate as never,
    });

    const res = await request(app).post('/v1/execute').send({ projectSlug: 'a-valid-slug' });

    expect(res.status).toBe(422);
    expect(res.body.errorCode).toBe('PATH_ESCAPE');
  });

  it('11) generator lança SSH_KEYGEN_MISSING → 500', async () => {
    const fakeGenerate = jest.fn(() => {
      throw new DeployKeyError('SSH_KEYGEN_MISSING', 'ssh-keygen ausente');
    });

    const app = buildApp({
      logger: silentLogger(),
      generateImpl: fakeGenerate as never,
    });

    const res = await request(app).post('/v1/execute').send({ projectSlug: 'foo' });

    expect(res.status).toBe(500);
    expect(res.body.errorCode).toBe('SSH_KEYGEN_MISSING');
  });

  it('12) generator lança Error genérico (não DeployKeyError) → 500 INTERNAL_ERROR', async () => {
    const fakeGenerate = jest.fn(() => {
      throw new Error('eep something else broke');
    });

    const app = buildApp({
      logger: silentLogger(),
      generateImpl: fakeGenerate as never,
    });

    const res = await request(app).post('/v1/execute').send({ projectSlug: 'foo' });

    expect(res.status).toBe(500);
    expect(res.body.errorCode).toBe('INTERNAL_ERROR');
    // Mensagem não expõe internals.
    expect(res.body.message).not.toContain('eep something else broke');
  });

  it('13) comment válido é repassado ao generator', async () => {
    const fakeGenerate = jest.fn(() => ({
      publicKey: 'ssh-ed25519 AAAA',
      fingerprint: 'SHA256:x',
      publicKeyPath: '/tmp/x.pub',
      alreadyExisted: false,
    }));

    const app = buildApp({
      logger: silentLogger(),
      generateImpl: fakeGenerate as never,
    });

    await request(app).post('/v1/execute').send({ projectSlug: 'foo', comment: 'custom@host' });

    expect(fakeGenerate).toHaveBeenCalledWith('foo', {
      baseDir: undefined,
      comment: 'custom@host',
    });
  });
});

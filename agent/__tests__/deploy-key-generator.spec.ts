/**
 * Specs do `generateDeployKey` com `ssh-keygen` mockado.
 *
 * Razão do mock: CI (e o ambiente do reviewer) pode rodar como user sem
 * permissão de escrita em `/etc/scrumban-agent/`, e mesmo um keygen real
 * em `/tmp` introduziria flakiness de filesystem. O fake escreve arquivos
 * com conteúdos canônicos no path esperado pelo generator e retorna saída
 * `ssh-keygen -lf` igual à real.
 *
 * Cobre (plan §7 R3 + §10 itens 6/10):
 *
 *  1. **Happy path**: gera chave nova, lê pubkey, retorna fingerprint.
 *  2. **Permissões finais**: privada 0600, pública 0644.
 *  3. **Idempotência**: 2ª chamada com mesmo slug NÃO chama ssh-keygen.
 *  4. **Slug inválido**: regex barra `Foo!`, `../etc`, etc.
 *  5. **Comment passado**: vai como `-C <comment>` ao ssh-keygen.
 *  6. **Comment default**: `scrumban-agent@<slug>` se omitido.
 *  7. **Fingerprint extraído**: token `SHA256:...` do output canônico.
 *  8. **baseDir não-existente**: cria recursivo com 0700.
 *  9. **ssh-keygen ENOENT** → SSH_KEYGEN_MISSING.
 * 10. **ssh-keygen exit !=0** → SSH_KEYGEN_FAILED.
 */
import { execFileSync } from 'child_process';
import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { DeployKeyError, generateDeployKey } from '../src/ssh/deploy-key-generator';

function tempBase(): string {
  return mkdtempSync(join(tmpdir(), 'deploykey-'));
}

/**
 * Constrói um mock de `execFileSync` que:
 *  - Para `ssh-keygen -t ed25519 -f <path> -N '' -C <comment> -q`:
 *    cria os arquivos pub + priv no path.
 *  - Para `ssh-keygen -lf <pubPath>`: retorna fingerprint canônico.
 */
function buildExecFileMock(opts?: {
  pubContent?: string;
  fingerprint?: string;
  failKeygen?: boolean;
  enoent?: boolean;
}): typeof execFileSync {
  const pubContent = opts?.pubContent ?? 'ssh-ed25519 AAAAFAKEPUBKEY scrumban-agent@test';
  const fingerprint = opts?.fingerprint ?? 'SHA256:FAKEFP123';

  return ((cmd: string, args: readonly string[]) => {
    if (opts?.enoent) {
      const e = new Error('spawn ssh-keygen ENOENT') as NodeJS.ErrnoException;
      e.code = 'ENOENT';
      throw e;
    }
    if (cmd !== 'ssh-keygen') {
      throw new Error(`unexpected cmd ${cmd}`);
    }

    if (args[0] === '-t') {
      // geração
      if (opts?.failKeygen) {
        throw new Error('ssh-keygen exit 1');
      }
      const fIdx = args.indexOf('-f');
      const path = args[fIdx + 1];
      writeFileSync(path, 'fake-private-key-content', { mode: 0o600 });
      writeFileSync(`${path}.pub`, pubContent, { mode: 0o644 });
      return Buffer.from('');
    }
    if (args[0] === '-lf') {
      return Buffer.from(`256 ${fingerprint} comment (ED25519)\n`);
    }
    throw new Error(`unexpected args ${args.join(' ')}`);
  }) as never;
}

describe('generateDeployKey', () => {
  it('1) happy path: cria chave, retorna pubkey + fingerprint', () => {
    const baseDir = tempBase();
    const exec = buildExecFileMock({
      pubContent: 'ssh-ed25519 AAAA scrumban-agent@dinpayz',
      fingerprint: 'SHA256:ABC123',
    });

    const r = generateDeployKey('dinpayz', { baseDir, execFile: exec });

    expect(r.alreadyExisted).toBe(false);
    expect(r.publicKey).toBe('ssh-ed25519 AAAA scrumban-agent@dinpayz');
    expect(r.fingerprint).toBe('SHA256:ABC123');
    expect(existsSync(join(baseDir, 'dinpayz'))).toBe(true);
    expect(existsSync(join(baseDir, 'dinpayz.pub'))).toBe(true);
  });

  it('2) permissões: privada 0600, pública 0644', () => {
    const baseDir = tempBase();
    const exec = buildExecFileMock();
    generateDeployKey('proj', { baseDir, execFile: exec });

    const privMode = statSync(join(baseDir, 'proj')).mode & 0o777;
    const pubMode = statSync(join(baseDir, 'proj.pub')).mode & 0o777;
    expect(privMode).toBe(0o600);
    expect(pubMode).toBe(0o644);
  });

  it('3) idempotência: 2ª chamada NÃO invoca ssh-keygen para gerar', () => {
    const baseDir = tempBase();
    const calls: string[][] = [];
    const exec = ((cmd: string, args: readonly string[]) => {
      calls.push([cmd, ...args]);
      if (args[0] === '-t') {
        const fIdx = args.indexOf('-f');
        const path = args[fIdx + 1];
        writeFileSync(path, 'priv', { mode: 0o600 });
        writeFileSync(`${path}.pub`, 'ssh-ed25519 AAAA cmt', { mode: 0o644 });
        return Buffer.from('');
      }
      return Buffer.from('256 SHA256:FP cmt (ED25519)\n');
    }) as never;

    const r1 = generateDeployKey('proj', { baseDir, execFile: exec });
    expect(r1.alreadyExisted).toBe(false);

    const r2 = generateDeployKey('proj', { baseDir, execFile: exec });
    expect(r2.alreadyExisted).toBe(true);
    expect(r2.publicKey).toBe(r1.publicKey);
    expect(r2.fingerprint).toBe(r1.fingerprint);

    // Geração (-t) só uma vez no total.
    const generations = calls.filter((c) => c.includes('-t'));
    expect(generations).toHaveLength(1);
  });

  it('4) slug inválido → INVALID_SLUG (sem tocar fs)', () => {
    const baseDir = tempBase();
    const exec = buildExecFileMock();

    const cases = ['Foo!', '../etc', 'WITH_CAP', 'a/b', '.dot', 'has space'];
    for (const slug of cases) {
      expect(() => generateDeployKey(slug, { baseDir, execFile: exec })).toThrow(DeployKeyError);
    }
  });

  it('5) comment customizado é passado ao ssh-keygen via -C', () => {
    const baseDir = tempBase();
    const calls: string[][] = [];
    const exec = ((cmd: string, args: readonly string[]) => {
      calls.push([cmd, ...args]);
      if (args[0] === '-t') {
        const fIdx = args.indexOf('-f');
        const path = args[fIdx + 1];
        writeFileSync(path, 'p', { mode: 0o600 });
        writeFileSync(`${path}.pub`, 'pub', { mode: 0o644 });
        return Buffer.from('');
      }
      return Buffer.from('256 SHA256:FP cmt (ED25519)\n');
    }) as never;

    generateDeployKey('proj', { baseDir, execFile: exec, comment: 'custom@host' });

    const genCall = calls.find((c) => c.includes('-t'));
    expect(genCall).toBeDefined();
    const cIdx = genCall!.indexOf('-C');
    expect(genCall![cIdx + 1]).toBe('custom@host');
  });

  it('6) comment default é scrumban-agent@<slug>', () => {
    const baseDir = tempBase();
    const calls: string[][] = [];
    const exec = ((cmd: string, args: readonly string[]) => {
      calls.push([cmd, ...args]);
      if (args[0] === '-t') {
        const fIdx = args.indexOf('-f');
        const path = args[fIdx + 1];
        writeFileSync(path, 'p', { mode: 0o600 });
        writeFileSync(`${path}.pub`, 'pub', { mode: 0o644 });
        return Buffer.from('');
      }
      return Buffer.from('256 SHA256:FP (ED25519)\n');
    }) as never;

    generateDeployKey('foo-bar', { baseDir, execFile: exec });

    const genCall = calls.find((c) => c.includes('-t'));
    const cIdx = genCall!.indexOf('-C');
    expect(genCall![cIdx + 1]).toBe('scrumban-agent@foo-bar');
  });

  it('7) fingerprint extraído corretamente do output canônico', () => {
    const baseDir = tempBase();
    const exec = buildExecFileMock({
      fingerprint: 'SHA256:VeryLongFingerprintBase64=',
    });

    const r = generateDeployKey('p', { baseDir, execFile: exec });
    expect(r.fingerprint).toBe('SHA256:VeryLongFingerprintBase64=');
  });

  it('8) baseDir não-existente é criado recursivo', () => {
    const root = tempBase();
    const baseDir = join(root, 'nested', 'ssh-keys');
    expect(existsSync(baseDir)).toBe(false);

    const exec = buildExecFileMock();
    generateDeployKey('p', { baseDir, execFile: exec });
    expect(existsSync(baseDir)).toBe(true);
  });

  it('9) ssh-keygen ENOENT → SSH_KEYGEN_MISSING', () => {
    const baseDir = tempBase();
    const exec = buildExecFileMock({ enoent: true });

    expect(() => generateDeployKey('p', { baseDir, execFile: exec })).toThrow(
      /SSH_KEYGEN_MISSING|ssh-keygen.*nao encontrado/,
    );
  });

  it('10) ssh-keygen exit !=0 → SSH_KEYGEN_FAILED', () => {
    const baseDir = tempBase();
    const exec = buildExecFileMock({ failKeygen: true });

    expect(() => generateDeployKey('p', { baseDir, execFile: exec })).toThrow(
      /SSH_KEYGEN_FAILED|ssh-keygen falhou/,
    );
  });

  it('11) só pub OU só priv presente (estado quebrado) → regera (não considera idempotente)', () => {
    const baseDir = tempBase();
    // Pré-cria SÓ a privada (sem .pub) — simula estado corrompido.
    writeFileSync(join(baseDir, 'broken'), 'orphan-priv', { mode: 0o600 });
    expect(existsSync(join(baseDir, 'broken'))).toBe(true);
    expect(existsSync(join(baseDir, 'broken.pub'))).toBe(false);

    const exec = buildExecFileMock();
    const r = generateDeployKey('broken', { baseDir, execFile: exec });
    expect(r.alreadyExisted).toBe(false);
    // Após regeneração: ambos existem.
    expect(existsSync(join(baseDir, 'broken'))).toBe(true);
    expect(existsSync(join(baseDir, 'broken.pub'))).toBe(true);
    // Pubkey nova do mock (não 'orphan-priv').
    expect(readFileSync(join(baseDir, 'broken.pub'), 'utf8')).toContain('ssh-ed25519');
  });
});

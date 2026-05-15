/**
 * Specs do `writeEnvVars` (escrita atômica do env file).
 *
 * Foco em propriedades CRÍTICAS do contrato (plan §10):
 *
 *  1. **Atomicidade**: arquivo final aparece de uma vez (sem temp residual).
 *  2. **Permissões 0600**: enforced via chmodSync após rename (umask-resistant).
 *  3. **Preservação byte-a-byte** de linhas não tocadas (comentários, vars manuais).
 *  4. **Allowlist** rejeita chaves estranhas.
 *  5. **Allowlist** específica: `ANTHROPIC_AUTH_TOKEN`, `GIT_BOT_NAME`, `GIT_BOT_EMAIL` aceitos.
 *  6. **Newline / null byte no valor** rejeitados.
 *  7. **Ordem** de varsWritten reflete ordem do input.
 *  8. **Atualização ordenada** preserva ordem das linhas pré-existentes.
 */
import { mkdtempSync, readdirSync, readFileSync, statSync, writeFileSync } from 'fs';
import { tmpdir } from 'os';
import { join } from 'path';
import { ALLOWED_KEYS, EnvWriterError, writeEnvVars } from '../src/env/env-file-writer';

/** Unix-only: chmod é no-op no Windows — stat retorna 0o666 para qualquer arquivo. */
const itUnix = process.platform === 'win32' ? it.skip : it;

function tempEnvPath(): { dir: string; path: string } {
  const dir = mkdtempSync(join(tmpdir(), 'envwriter-'));
  return { dir, path: join(dir, 'environment') };
}

describe('writeEnvVars', () => {
  it('1) escrita atômica: nenhum temp file residual após sucesso', () => {
    const { dir, path } = tempEnvPath();
    writeEnvVars({ GITHUB_TOKEN: 'tok' }, { path });

    const files = readdirSync(dir);
    // Apenas o env file, nenhum `.tmp.*`.
    expect(files).toEqual(['environment']);
  });

  itUnix('2) modo final é 0600 mesmo com umask permissivo', () => {
    const { path } = tempEnvPath();
    const originalUmask = process.umask(0o022);
    try {
      writeEnvVars({ GITHUB_TOKEN: 'x' }, { path });
      const mode = statSync(path).mode & 0o777;
      expect(mode).toBe(0o600);
    } finally {
      process.umask(originalUmask);
    }
  });

  it('3) preserva linhas não tocadas (comentários + chaves manuais)', () => {
    const { path } = tempEnvPath();
    const original = [
      '# comentario topo',
      'CHAVE_MANUAL=valor-mantido',
      '',
      '# bloco 2',
      'GITHUB_TOKEN=old',
      '',
    ].join('\n');
    writeFileSync(path, original, { mode: 0o600 });

    writeEnvVars({ GITHUB_TOKEN: 'new' }, { path });

    const content = readFileSync(path, 'utf8');
    expect(content).toContain('# comentario topo');
    expect(content).toContain('CHAVE_MANUAL=valor-mantido');
    expect(content).toContain('# bloco 2');
    expect(content).toContain('GITHUB_TOKEN=new');
    expect(content).not.toContain('GITHUB_TOKEN=old');
  });

  it('4) rejeita chave fora da allowlist', () => {
    const { path } = tempEnvPath();
    expect(() => writeEnvVars({ LD_PRELOAD: '/evil.so' } as never, { path })).toThrow(
      EnvWriterError,
    );
  });

  it('5) aceita todas as chaves da allowlist', () => {
    const { path } = tempEnvPath();
    const vars: Record<string, string> = {};
    for (const k of ALLOWED_KEYS) {
      vars[k] = `valor-${k}`;
    }
    const result = writeEnvVars(vars, { path });
    expect(result.varsWritten).toEqual([...ALLOWED_KEYS]);
    const content = readFileSync(path, 'utf8');
    for (const k of ALLOWED_KEYS) {
      expect(content).toContain(`${k}=valor-${k}`);
    }
  });

  it('6) rejeita newline no valor', () => {
    const { path } = tempEnvPath();
    expect(() => writeEnvVars({ GITHUB_TOKEN: 'a\nb' }, { path })).toThrow(EnvWriterError);
  });

  it('6b) rejeita null byte no valor', () => {
    const { path } = tempEnvPath();
    expect(() => writeEnvVars({ GITHUB_TOKEN: 'a\0b' }, { path })).toThrow(EnvWriterError);
  });

  it('6c) rejeita CR no valor', () => {
    const { path } = tempEnvPath();
    expect(() => writeEnvVars({ GITHUB_TOKEN: 'a\rb' }, { path })).toThrow(EnvWriterError);
  });

  it('7) varsWritten preserva ordem do input', () => {
    const { path } = tempEnvPath();
    const result = writeEnvVars(
      {
        ANTHROPIC_API_KEY: 'sk',
        GITHUB_TOKEN: 'gh',
        GIT_BOT_EMAIL: 'b@b',
      },
      { path },
    );
    expect(result.varsWritten).toEqual(['ANTHROPIC_API_KEY', 'GITHUB_TOKEN', 'GIT_BOT_EMAIL']);
  });

  it('8) atualização in-place: linha mantém posição original', () => {
    const { path } = tempEnvPath();
    writeFileSync(
      path,
      ['# top', 'GITHUB_TOKEN=old', 'GIT_BOT_NAME=Bot', '# bottom'].join('\n') + '\n',
      { mode: 0o600 },
    );
    writeEnvVars({ GITHUB_TOKEN: 'new' }, { path });
    const lines = readFileSync(path, 'utf8').split('\n');
    expect(lines[0]).toBe('# top');
    expect(lines[1]).toBe('GITHUB_TOKEN=new'); // posição preservada
    expect(lines[2]).toBe('GIT_BOT_NAME=Bot');
    expect(lines[3]).toBe('# bottom');
  });

  it('9) chave nova: aparece no final do arquivo', () => {
    const { path } = tempEnvPath();
    writeFileSync(path, ['# topo', 'GITHUB_TOKEN=keep'].join('\n') + '\n', { mode: 0o600 });
    writeEnvVars({ ANTHROPIC_API_KEY: 'sk' }, { path });
    const content = readFileSync(path, 'utf8');
    expect(content.endsWith('ANTHROPIC_API_KEY=sk\n')).toBe(true);
    expect(content).toContain('GITHUB_TOKEN=keep'); // não tocada
  });

  it('10) payload vazio → EMPTY_PAYLOAD', () => {
    const { path } = tempEnvPath();
    expect(() => writeEnvVars({}, { path })).toThrow(/EMPTY_PAYLOAD|vars vazio/);
  });

  it('11) arquivo termina com newline sempre', () => {
    const { path } = tempEnvPath();
    writeEnvVars({ GITHUB_TOKEN: 'x' }, { path });
    const content = readFileSync(path, 'utf8');
    expect(content.endsWith('\n')).toBe(true);
  });

  it('12) createdNew=true na primeira chamada, false depois', () => {
    const { path } = tempEnvPath();
    const r1 = writeEnvVars({ GITHUB_TOKEN: 'a' }, { path });
    expect(r1.createdNew).toBe(true);
    const r2 = writeEnvVars({ GITHUB_TOKEN: 'b' }, { path });
    expect(r2.createdNew).toBe(false);
  });
});

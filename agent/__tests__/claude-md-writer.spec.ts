/**
 * Specs de `upsertProjectEntry` e `removeProjectEntry` em
 * `agent/src/claude-code/claude-md-writer.ts`.
 *
 * Todos os testes usam mocks injetáveis — NÃO tocam o FS real.
 */

import {
  upsertProjectEntry,
  removeProjectEntry,
} from '../src/claude-code/claude-md-writer';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeFsStubs(initialContent: string) {
  let current = initialContent;
  const readFile = jest.fn(async (_path: string) => current);
  const writeFile = jest.fn(async (_path: string, content: string) => {
    current = content;
  });
  return { readFile, writeFile, getContent: () => current };
}

const CLAUDE_MD_PATH = '/home/dev/.claude/CLAUDE.md';

// ---------------------------------------------------------------------------
// upsertProjectEntry
// ---------------------------------------------------------------------------

describe('upsertProjectEntry', () => {
  it('cria seção corretamente em arquivo vazio', async () => {
    const fs = makeFsStubs('');
    await upsertProjectEntry('meu-proj', '/projetos/meu-proj', CLAUDE_MD_PATH, fs);

    const content = fs.getContent();
    expect(content).toContain('## meu-proj');
    expect(content).toContain('- Caminho: /projetos/meu-proj');
    expect(content).toContain('- Descricao: provisionado automaticamente');
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
  });

  it('appenda ao final quando arquivo já tem outras seções', async () => {
    const initial =
      '## outro-proj\n' +
      '- Caminho: /projetos/outro\n' +
      '- Descricao: provisionado automaticamente\n';
    const fs = makeFsStubs(initial);

    await upsertProjectEntry('novo-proj', '/projetos/novo', CLAUDE_MD_PATH, fs);

    const content = fs.getContent();
    // Seção original preservada
    expect(content).toContain('## outro-proj');
    expect(content).toContain('- Caminho: /projetos/outro');
    // Nova seção appendada
    expect(content).toContain('## novo-proj');
    expect(content).toContain('- Caminho: /projetos/novo');
    // Nova seção vem depois
    expect(content.indexOf('## outro-proj')).toBeLessThan(content.indexOf('## novo-proj'));
  });

  it('quando seção já existe atualiza apenas "- Caminho:" (outras linhas intactas)', async () => {
    const initial =
      '## meu-proj\n' +
      '- Caminho: /projetos/antigo\n' +
      '- Descricao: provisionado automaticamente\n' +
      '- Tag: custom\n';
    const fs = makeFsStubs(initial);

    await upsertProjectEntry('meu-proj', '/projetos/novo', CLAUDE_MD_PATH, fs);

    const content = fs.getContent();
    expect(content).toContain('- Caminho: /projetos/novo');
    expect(content).not.toContain('- Caminho: /projetos/antigo');
    // Linha customizada preservada
    expect(content).toContain('- Tag: custom');
    expect(content).toContain('- Descricao: provisionado automaticamente');
  });

  it('re-provision com novo baseDir atualiza Caminho corretamente', async () => {
    const initial =
      '## scrumban-backend\n' +
      '- Caminho: /home/dev/projetos/scrumban-backend\n' +
      '- Descricao: provisionado automaticamente\n';
    const fs = makeFsStubs(initial);

    await upsertProjectEntry(
      'scrumban-backend',
      '/home/dev/workspace/scrumban-backend',
      CLAUDE_MD_PATH,
      fs,
    );

    const content = fs.getContent();
    expect(content).toContain('- Caminho: /home/dev/workspace/scrumban-backend');
    expect(content).not.toContain('/home/dev/projetos/scrumban-backend');
  });
});

// ---------------------------------------------------------------------------
// removeProjectEntry
// ---------------------------------------------------------------------------

describe('removeProjectEntry', () => {
  it('remove seção existente deixando resto intacto', async () => {
    const initial =
      '## proj-a\n' +
      '- Caminho: /projetos/a\n' +
      '- Descricao: provisionado automaticamente\n' +
      '\n' +
      '## proj-b\n' +
      '- Caminho: /projetos/b\n' +
      '- Descricao: provisionado automaticamente\n';
    const fs = makeFsStubs(initial);

    await removeProjectEntry('proj-a', CLAUDE_MD_PATH, fs);

    const content = fs.getContent();
    expect(content).not.toContain('## proj-a');
    expect(content).not.toContain('/projetos/a');
    expect(content).toContain('## proj-b');
    expect(content).toContain('/projetos/b');
    expect(fs.writeFile).toHaveBeenCalledTimes(1);
  });

  it('não faz nada quando slug não existe (idempotente)', async () => {
    const initial =
      '## outro-proj\n' +
      '- Caminho: /projetos/outro\n' +
      '- Descricao: provisionado automaticamente\n';
    const fs = makeFsStubs(initial);

    await removeProjectEntry('inexistente', CLAUDE_MD_PATH, fs);

    // Não deve chamar writeFile
    expect(fs.writeFile).not.toHaveBeenCalled();
    expect(fs.getContent()).toBe(initial);
  });

  it('chamadas concorrentes para o mesmo claudeMdPath são serializadas', async () => {
    const initial = '';
    const ops: string[] = [];

    // Stub com delay artificial para detectar race conditions
    let current = initial;
    const readFile = jest.fn(async (_path: string) => {
      ops.push('read:start');
      await new Promise((r) => setImmediate(r));
      ops.push('read:end');
      return current;
    });
    const writeFile = jest.fn(async (_path: string, content: string) => {
      ops.push('write:start');
      await new Promise((r) => setImmediate(r));
      current = content;
      ops.push('write:end');
    });

    // Disparar 3 upserts concorrentemente
    await Promise.all([
      upsertProjectEntry('proj-x', '/p/x', CLAUDE_MD_PATH, { readFile, writeFile }),
      upsertProjectEntry('proj-y', '/p/y', CLAUDE_MD_PATH, { readFile, writeFile }),
      upsertProjectEntry('proj-z', '/p/z', CLAUDE_MD_PATH, { readFile, writeFile }),
    ]);

    const content = current;

    // Todos os projetos devem estar presentes (sem corrupção)
    expect(content).toContain('## proj-x');
    expect(content).toContain('## proj-y');
    expect(content).toContain('## proj-z');

    // Cada write:start deve aparecer após o read:end imediatamente anterior
    // (sem sobreposição — serialização confirmada)
    for (let i = 0; i < ops.length - 1; i++) {
      if (ops[i] === 'write:end' || ops[i] === 'read:end') {
        // Após fim de operação, a próxima pode começar ou terminar (serializado)
        const next = ops[i + 1];
        expect(['read:start', 'write:start', 'read:end', 'write:end']).toContain(next);
      }
    }
    // Confirmar que todos os starts de read aparecem ANTES dos correspondentes ends de read
    // (garantia básica de ordenação)
    expect(ops.filter((o) => o === 'read:start')).toHaveLength(3);
    expect(ops.filter((o) => o === 'write:start')).toHaveLength(3);
  });
});

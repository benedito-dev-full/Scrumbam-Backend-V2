/**
 * Utilitário para manter o `CLAUDE.md` global do agente atualizado com os
 * projetos provisionados.
 *
 * Cada projeto provisionado possui uma seção `## <slug>` no arquivo:
 *
 * ```markdown
 * ## meu-projeto
 * - Caminho: /home/dev/projetos/meu-projeto
 * - Descricao: provisionado automaticamente
 * ```
 *
 * `upsertProjectEntry` cria ou atualiza a seção. `removeProjectEntry` remove.
 * Ambas as funções são thread-safe via mutex de módulo (não por chamada).
 */

import { readFile as fsReadFile, writeFile as fsWriteFile } from 'fs/promises';

// ---------------------------------------------------------------------------
// Mutex de módulo (singleton) — garante serialização por claudeMdPath
// ---------------------------------------------------------------------------

const locks = new Map<string, Promise<void>>();

async function withLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(key) ?? Promise.resolve();
  let resolve!: () => void;
  const next = new Promise<void>((res) => {
    resolve = res;
  });
  locks.set(key, next);
  try {
    await prev;
    return await fn();
  } finally {
    resolve();
    if (locks.get(key) === next) locks.delete(key);
  }
}

// ---------------------------------------------------------------------------
// Tipos públicos
// ---------------------------------------------------------------------------

export interface ClaudeMdWriterOptions {
  readFile?: (path: string) => Promise<string>;
  writeFile?: (path: string, content: string) => Promise<void>;
}

// ---------------------------------------------------------------------------
// Helpers internos
// ---------------------------------------------------------------------------

function defaultReadFile(path: string): Promise<string> {
  return fsReadFile(path, 'utf-8').catch((err: unknown) => {
    if (typeof err === 'object' && err !== null && (err as NodeJS.ErrnoException).code === 'ENOENT') {
      return '';
    }
    throw err;
  });
}

function defaultWriteFile(path: string, content: string): Promise<void> {
  return fsWriteFile(path, content, 'utf-8');
}

function normalizeLf(content: string): string {
  return content.replace(/\r\n/g, '\n');
}

/**
 * Retorna regex que detecta o início de uma seção `## <slug>` (linha exata).
 */
function sectionStartRegex(slug: string): RegExp {
  const escaped = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`^##\\s+${escaped}\\s*$`, 'm');
}

// ---------------------------------------------------------------------------
// API pública
// ---------------------------------------------------------------------------

/**
 * Cria ou atualiza a entrada do projeto `slug` no `CLAUDE.md`.
 *
 * - Se a seção `## <slug>` já existir, apenas a linha `- Caminho:` é
 *   atualizada; as demais linhas da seção ficam intactas.
 * - Se não existir, a seção é appendada ao final do arquivo.
 */
export async function upsertProjectEntry(
  slug: string,
  projectPath: string,
  claudeMdPath: string,
  options: ClaudeMdWriterOptions = {},
): Promise<void> {
  const read = options.readFile ?? defaultReadFile;
  const write = options.writeFile ?? defaultWriteFile;

  await withLock(claudeMdPath, async () => {
    const raw = await read(claudeMdPath);
    const content = normalizeLf(raw);

    const startRegex = sectionStartRegex(slug);
    const match = startRegex.exec(content);

    if (match === null) {
      // Seção não existe — append
      const separator = content.length > 0 && !content.endsWith('\n') ? '\n' : '';
      const newSection =
        `${separator}\n## ${slug}\n` +
        `- Caminho: ${projectPath}\n` +
        `- Descricao: provisionado automaticamente\n`;
      await write(claudeMdPath, content + newSection);
      return;
    }

    // Seção existe — encontrar os limites e atualizar linha `- Caminho:`
    const sectionStart = match.index;
    // Próxima seção `##` após o início (ou EOF)
    const afterHeader = sectionStart + match[0].length;
    const nextSectionRegex = /^##\s/m;
    const nextMatch = nextSectionRegex.exec(content.slice(afterHeader));
    const sectionEnd =
      nextMatch !== null ? afterHeader + nextMatch.index : content.length;

    const sectionBody = content.slice(sectionStart, sectionEnd);
    const updatedBody = sectionBody.replace(
      /^- Caminho:.*$/m,
      `- Caminho: ${projectPath}`,
    );

    const result =
      content.slice(0, sectionStart) + updatedBody + content.slice(sectionEnd);
    await write(claudeMdPath, result);
  });
}

/**
 * Remove a seção `## <slug>` do `CLAUDE.md` (idempotente — se não existir,
 * não faz nada).
 */
export async function removeProjectEntry(
  slug: string,
  claudeMdPath: string,
  options: ClaudeMdWriterOptions = {},
): Promise<void> {
  const read = options.readFile ?? defaultReadFile;
  const write = options.writeFile ?? defaultWriteFile;

  await withLock(claudeMdPath, async () => {
    const raw = await read(claudeMdPath);
    if (raw === '') return; // arquivo vazio ou inexistente — nada a fazer

    const content = normalizeLf(raw);

    const startRegex = sectionStartRegex(slug);
    const match = startRegex.exec(content);
    if (match === null) return; // seção não existe — idempotente

    const sectionStart = match.index;
    const afterHeader = sectionStart + match[0].length;
    const nextSectionRegex = /^##\s/m;
    const nextMatch = nextSectionRegex.exec(content.slice(afterHeader));
    const sectionEnd =
      nextMatch !== null ? afterHeader + nextMatch.index : content.length;

    // Remover a seção (incluindo qualquer \n antes do próximo ## ou EOF)
    let result = content.slice(0, sectionStart) + content.slice(sectionEnd);

    // Normalizar múltiplas linhas em branco consecutivas para no máximo 1
    result = result.replace(/\n{3,}/g, '\n\n');

    await write(claudeMdPath, result);
  });
}

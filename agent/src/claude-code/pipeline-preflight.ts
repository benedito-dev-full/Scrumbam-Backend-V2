/**
 * Preflight da esteira headless (ADR-V2-083).
 *
 * Duas fases:
 *  - **Síncrona, antes do ACK** ({@link isPipelineInstalled}): só `fs.existsSync`
 *    do comando `.claude/commands/scrumban-executar.md` no repo. Ausente ⇒ o
 *    handler responde 422 `PIPELINE_NOT_INSTALLED` e o backend marca FAILED
 *    com motivo canônico em < 5s (decisão CEO P1: parar e avisar, todos os tipos).
 *  - **Assíncrona, depois do ACK** ({@link checkPreconditions}): `gh` disponível,
 *    token do GitHub no ambiente, repo git com remoto `origin`. Falha ⇒
 *    `errorCode=PIPELINE_PRECONDITION_FAILED` no callback.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { GitExec } from '../git/pipeline-git';

/** Caminho do comando headless da esteira, relativo à raiz do repo. */
export const PIPELINE_COMMAND_RELATIVE_PATH = '.claude/commands/scrumban-executar.md';

/** Nome do comando (sem barra) — usado para montar o prompt. */
export const PIPELINE_COMMAND_NAME = 'scrumban-executar';

/**
 * O repo tem a esteira headless instalada?
 *
 * @param cwd - Raiz do repo (já validada pelo allowlist)
 * @param existsImpl - Override de `fs.existsSync` (testes)
 * @returns true se o comando existe
 */
export function isPipelineInstalled(
  cwd: string,
  existsImpl: (p: string) => boolean = existsSync,
): boolean {
  return existsImpl(join(cwd, PIPELINE_COMMAND_RELATIVE_PATH));
}

/** Resultado do preflight assíncrono. */
export type PreconditionResult = { ok: true } | { ok: false; message: string };

/**
 * Pré-condições para a esteira abrir PR: token do GitHub, `gh` e remoto `origin`.
 * Nunca lança — erro vira `{ ok:false, message }` (sem segredos na mensagem).
 *
 * @param input.cwd - Raiz do repo
 * @param input.env - Ambiente do processo (lê `GITHUB_TOKEN`/`GH_TOKEN`)
 * @param input.exec - Executor de comandos (injetável)
 * @returns ok ou motivo legível
 */
export async function checkPreconditions(input: {
  cwd: string;
  env: NodeJS.ProcessEnv;
  exec: GitExec;
}): Promise<PreconditionResult> {
  const token = input.env.GITHUB_TOKEN ?? input.env.GH_TOKEN;
  if (!token || token.trim() === '') {
    return {
      ok: false,
      message: 'GITHUB_TOKEN/GH_TOKEN ausente no ambiente do agente (SET_ENV ou /etc/scrumban-agent/environment)',
    };
  }
  try {
    await input.exec('gh', ['--version'], { cwd: input.cwd, timeoutMs: 15_000 });
  } catch {
    return { ok: false, message: 'GitHub CLI (gh) indisponível no PATH do agente' };
  }
  try {
    await input.exec('git', ['rev-parse', '--git-dir'], { cwd: input.cwd, timeoutMs: 15_000 });
    await input.exec('git', ['remote', 'get-url', 'origin'], { cwd: input.cwd, timeoutMs: 15_000 });
  } catch {
    return { ok: false, message: 'diretório do projeto não é repo git com remoto "origin"' };
  }
  return { ok: true };
}

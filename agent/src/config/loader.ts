/**
 * Loader da config do agente — `/etc/scrumban-agent/config.json`.
 *
 * Validações DEFENSIVAS aplicadas em ordem:
 * 1. Arquivo existe.
 * 2. Permissão é exatamente `0600` (impede leak de secrets em VPS compartilhada).
 * 3. JSON parse válido.
 * 4. Schema zod válido (vide `schema.ts`).
 *
 * Qualquer falha lança `Error` com mensagem em português pronta para `journalctl`.
 *
 * Override para testes: env `SCRUMBAN_AGENT_CONFIG_PATH`.
 */
import * as fs from 'fs';
import { AgentConfig, AgentConfigSchema } from './schema';

const DEFAULT_CONFIG_PATH = '/etc/scrumban-agent/config.json';
const REQUIRED_MODE = 0o600;

/**
 * Carrega e valida a config do agente.
 *
 * @param explicitPath Caminho explícito (override). Se omitido, usa env
 *   `SCRUMBAN_AGENT_CONFIG_PATH` ou o default `/etc/scrumban-agent/config.json`.
 * @returns Configuração validada e tipada.
 * @throws Error com mensagem clara se: arquivo ausente, modo incorreto,
 *   JSON inválido, ou schema rejeita.
 *
 * @example
 *   const cfg = loadConfig();
 *   console.log(cfg.agentId);
 *
 * @example
 *   // Teste com path temporário:
 *   const cfg = loadConfig('/tmp/test-config.json');
 */
export function loadConfig(explicitPath?: string): AgentConfig {
  const path = explicitPath ?? process.env.SCRUMBAN_AGENT_CONFIG_PATH ?? DEFAULT_CONFIG_PATH;

  // 1. Arquivo existe?
  let stat: fs.Stats;
  try {
    stat = fs.statSync(path);
  } catch (err) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ENOENT') {
      throw new Error(`config nao encontrado em ${path}`);
    }
    throw new Error(`falha ao ler stat de ${path}: ${(err as Error).message}`);
  }

  if (!stat.isFile()) {
    throw new Error(`${path} nao e um arquivo regular`);
  }

  // 2. Permissão deve ser exatamente 0600.
  // Mascaramos apenas os 9 bits de permissão (rwxrwxrwx) — ignorando bits especiais (setuid/setgid/sticky).
  const mode = stat.mode & 0o777;
  if (mode !== REQUIRED_MODE) {
    const actualOctal = mode.toString(8).padStart(3, '0');
    throw new Error(
      `config.json deve ter modo 0600 (atual: 0${actualOctal}) — corrija com: chmod 600 ${path}`,
    );
  }

  // 3. JSON parse.
  const raw = fs.readFileSync(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new Error(`config.json invalido (JSON malformado): ${(err as Error).message}`);
  }

  // 4. Validação zod.
  const result = AgentConfigSchema.safeParse(parsed);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `${i.path.join('.') || '(root)'}: ${i.message}`)
      .join('; ');
    throw new Error(`config.json invalido (schema): ${issues}`);
  }

  return result.data;
}

/**
 * Zod schema da configuração persistida em `/etc/scrumban-agent/config.json`.
 *
 * IMPORTANTE: o `agentCommandSecret` é gravado em texto PLANO no arquivo de
 * config (que vive em modo `0600`). Quem decifra do envelope AES-256-GCM
 * vindo do backend é o `install.sh` — o agente NÃO decifra em runtime.
 *
 * Toda violação do schema lança erro detalhado (zod) antes do bootstrap.
 */
import { z } from 'zod';

export const AgentConfigSchema = z.object({
  /** Identificador do agente (DEntidade.chave idClasse=-156) — emitido pelo backend no handshake. */
  agentId: z.string().min(1, 'agentId obrigatório'),

  /** API key do agente (usada para autenticar requisições outbound agent→backend). */
  agentApiKey: z.string().min(1, 'agentApiKey obrigatório'),

  /** Secret HMAC-SHA256 usado para assinar (outbound) e validar (inbound) requisições. */
  agentCommandSecret: z.string().min(1, 'agentCommandSecret obrigatório'),

  /** Base URL do backend V2 (ex: 'https://api.scrumban.com.br'). */
  backendBaseUrl: z.string().url('backendBaseUrl deve ser URL válida'),

  /**
   * Host do servidor backend para o reverse tunnel (autossh).
   * Pode diferir de `backendBaseUrl` (DNS interno vs URL pública).
   */
  backendTunnelHost: z.string().min(1, 'backendTunnelHost obrigatório'),

  /** Porta SSH no host do backend para autossh (default: 22). */
  backendTunnelPort: z.number().int().positive().default(22),

  /**
   * Porta local no agente (127.0.0.1) onde o servidor HTTP escuta.
   * Backend chega via reverse tunnel SSH.
   */
  tunnelPort: z.number().int().positive(),

  /**
   * Lista de raízes onde projetos podem viver. Toda execução de Claude Code
   * é validada contra esta allowlist após resolução via CLAUDE.md.
   * Defesa contra path injection (ver risco #1 do plano).
   */
  allowedProjectRoots: z.array(z.string().min(1)).min(1, 'allowedProjectRoots não pode ser vazio'),

  /**
   * Caminho do `CLAUDE.md` global onde o CEO mapeia slugs → paths.
   * Default: `/root/.claude/CLAUDE.md`. install.sh deve resolver para o
   * usuário correto (`~/.claude/CLAUDE.md`).
   */
  claudeMdPath: z.string().min(1).default('/root/.claude/CLAUDE.md'),

  /** Caminho da chave SSH usada pelo autossh. */
  agentSshKeyPath: z.string().min(1).default('/etc/scrumban-agent/ssh_key'),

  /** Nível de log mínimo. */
  logLevel: z.enum(['error', 'warn', 'info', 'debug']).default('info'),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;

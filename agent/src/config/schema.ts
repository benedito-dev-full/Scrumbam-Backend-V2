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
   * Interface no host do backend onde o `-R` faz bind. Default `127.0.0.1`.
   * Use `172.17.0.1` (gateway docker0) quando o backend roda em container
   * Docker e precisa alcançar o tunnel via a interface bridge do host.
   * Requer `GatewayPorts clientspecified` (ou `yes`) no sshd do backend.
   */
  bindHost: z.string().min(1).default('127.0.0.1'),

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

  /**
   * Configuração opcional do Cache Warmer.
   *
   * Quando habilitado, o agente dispara periodicamente sessões fantasma
   * do CLI claude para renovar o TTL=1h do prompt cache do Anthropic API
   * (que cacheia o conteúdo de ~58k tokens do `--system-prompt` enviado
   * com cada execução real).
   *
   * Mecânica: a cada `intervalMinutes` (default 40min, margem 20min
   * antes do TTL de 60min), itera sequencialmente `projects[]`, executa
   * o mesmo pipeline de validação (resolveProjectPath → validateWorkspace
   * → leitura CLAUDE.md → buildClaudeArgs) e dispara o CLI com
   * mensagem fixa minúscula + flags `--permission-mode=plan --max-turns=1`.
   *
   * Telemetria de cada execução é log estruturado pino (stage
   * `cache-warmer.report`). Observabilidade via SSH + journalctl +
   * Anthropic Console (sem persistência no backend).
   *
   * Bloco INTEIRAMENTE opcional — agentes em produção sem este bloco
   * (ou com `enabled=false`) operam idêntico ao agente sem a feature.
   */
  cacheWarmer: z
    .object({
      /** Liga/desliga o loop. Se false, agente não dispara nenhum warm. */
      enabled: z.boolean().default(false),

      /**
       * Intervalo entre ciclos do loop, em minutos.
       *
       * Mínimo 5min como defesa contra config absurda (R4 — loop tight).
       * Default 40min: margem segura antes do TTL=60min do prompt cache.
       * Máximo 60min: passar disso significa que cada ciclo já encontra
       * cache expirado, anulando o propósito do warmer.
       */
      intervalMinutes: z.number().int().min(5).max(60).default(40),

      /**
       * Slugs dos projetos a aquecer (NÃO paths absolutos — ADR-V2-035).
       * Cada slug deve estar mapeado no `CLAUDE.md` global (mesma
       * resolução usada pelo handler real).
       *
       * Se `enabled=true`, este array DEVE ser não-vazio (validação
       * cruzada no `.refine()` abaixo).
       */
      projects: z.array(z.string().min(1)).default([]),

      /**
       * Mensagem que vai como `-p <warmupPrompt>`. Curtíssima por design
       * (não fazemos trabalho útil — só queremos o cache hit do
       * --system-prompt acima).
       */
      warmupPrompt: z.string().min(1).default('responda apenas ok. nao use ferramentas.'),

      /**
       * Flags extras inseridas APÓS as flags-base. Default inclui
       * `--permission-mode=plan` (impede qualquer tool call) e
       * `--max-turns=1` (resposta única, sem follow-up).
       */
      claudeFlags: z.array(z.string().min(1)).default(['--permission-mode=plan', '--max-turns=1']),

      /** Timeout por warm individual (segundos). Default 30s. */
      timeoutSeconds: z.number().int().positive().max(120).default(30),

      /**
       * Cap diário de custo (USD) por agente. Quando atingido, loop
       * pausa até o próximo dia operacional (reset no restart).
       *
       * Default conservador: 1.0 USD/dia. Custo real esperado de 5
       * projetos × 36 warms/dia × $0.003 ≈ $0.54/dia → cap em $1.00
       * dá 2x folga. Defesa contra R4 (loop tight) e R6 (desvio de
       * pricing Anthropic).
       *
       * Se 0 ou ausente, kill switch DESLIGADO (não recomendado em
       * produção).
       */
      dailyCostCapUsd: z.number().nonnegative().default(1.0),
    })
    .optional()
    .refine(
      (cfg) => {
        if (cfg === undefined) return true;
        if (cfg.enabled === false) return true;
        return cfg.projects.length > 0;
      },
      {
        message: 'cacheWarmer.projects não pode ser vazio quando cacheWarmer.enabled=true',
        path: ['projects'],
      },
    ),
});

export type AgentConfig = z.infer<typeof AgentConfigSchema>;
export type CacheWarmerConfig = NonNullable<AgentConfig['cacheWarmer']>;

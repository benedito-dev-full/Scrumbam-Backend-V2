/**
 * Specs do config loader.
 *
 * Cobertura:
 *  1. Config válido em modo 0600 → AgentConfig parseado.
 *  2. Modo errado (0644) → erro com "0600".
 *  3. JSON malformado → erro de parse.
 *  4. Faltando campo obrigatório → erro mencionando o campo.
 *  5. URL inválida em backendBaseUrl → erro zod.
 *  6. allowedProjectRoots vazio → erro zod.
 *  7. Path inexistente → erro "config nao encontrado".
 */
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { loadConfig } from '../src/config/loader';

/** Config válido base reutilizado nos testes. */
const VALID_CONFIG = {
  agentId: 'agent-123',
  agentApiKey: 'api-key-xyz',
  agentCommandSecret: 'secret-hmac',
  backendBaseUrl: 'https://api.scrumban.com.br',
  backendTunnelHost: 'tunnel.scrumban.com.br',
  backendTunnelPort: 2222,
  tunnelPort: 20000,
  allowedProjectRoots: ['/home/dev/projetos'],
  claudeMdPath: '/home/dev/.claude/CLAUDE.md',
  agentSshKeyPath: '/etc/scrumban-agent/ssh_key',
  logLevel: 'info',
};

describe('loadConfig', () => {
  let tmpDir: string;
  let cfgPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'scrumban-agent-cfg-'));
    cfgPath = path.join(tmpDir, 'config.json');
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  /**
   * Helper: escreve arquivo de config com conteúdo arbitrário e força modo 0600.
   */
  function writeConfig(content: string, mode = 0o600): void {
    fs.writeFileSync(cfgPath, content);
    fs.chmodSync(cfgPath, mode);
  }

  it('1) config válido em modo 0600 retorna AgentConfig parseado', () => {
    writeConfig(JSON.stringify(VALID_CONFIG), 0o600);

    const cfg = loadConfig(cfgPath);

    expect(cfg.agentId).toBe('agent-123');
    expect(cfg.agentApiKey).toBe('api-key-xyz');
    expect(cfg.agentCommandSecret).toBe('secret-hmac');
    expect(cfg.backendBaseUrl).toBe('https://api.scrumban.com.br');
    expect(cfg.backendTunnelPort).toBe(2222);
    expect(cfg.tunnelPort).toBe(20000);
    expect(cfg.allowedProjectRoots).toEqual(['/home/dev/projetos']);
    expect(cfg.logLevel).toBe('info');
  });

  it('1b) usa defaults quando campos opcionais ausentes', () => {
    // Remove campos opcionais — zod deve aplicar defaults.
    const minimal = {
      agentId: 'a1',
      agentApiKey: 'k1',
      agentCommandSecret: 's1',
      backendBaseUrl: 'https://api.test',
      backendTunnelHost: 'tunnel.test',
      tunnelPort: 30000,
      allowedProjectRoots: ['/home/dev'],
    };
    writeConfig(JSON.stringify(minimal), 0o600);

    const cfg = loadConfig(cfgPath);

    expect(cfg.backendTunnelPort).toBe(22);
    expect(cfg.claudeMdPath).toBe('/root/.claude/CLAUDE.md');
    expect(cfg.agentSshKeyPath).toBe('/etc/scrumban-agent/ssh_key');
    expect(cfg.logLevel).toBe('info');
  });

  it('2) modo 0644 → erro mencionando "0600"', () => {
    writeConfig(JSON.stringify(VALID_CONFIG), 0o644);

    expect(() => loadConfig(cfgPath)).toThrow(/0600/);
    expect(() => loadConfig(cfgPath)).toThrow(/0644/);
  });

  it('2b) modo 0640 também é rejeitado', () => {
    writeConfig(JSON.stringify(VALID_CONFIG), 0o640);

    expect(() => loadConfig(cfgPath)).toThrow(/0600/);
  });

  it('3) JSON malformado → erro de parse', () => {
    writeConfig('{ "agentId": "abc", invalid json', 0o600);

    expect(() => loadConfig(cfgPath)).toThrow(/JSON malformado/);
  });

  it('4) faltando agentId → erro zod mencionando "agentId"', () => {
    const invalid = { ...VALID_CONFIG };
    delete (invalid as Record<string, unknown>).agentId;
    writeConfig(JSON.stringify(invalid), 0o600);

    expect(() => loadConfig(cfgPath)).toThrow(/agentId/);
  });

  it('4b) faltando agentCommandSecret → erro zod mencionando o campo', () => {
    const invalid = { ...VALID_CONFIG };
    delete (invalid as Record<string, unknown>).agentCommandSecret;
    writeConfig(JSON.stringify(invalid), 0o600);

    expect(() => loadConfig(cfgPath)).toThrow(/agentCommandSecret/);
  });

  it('5) backendBaseUrl inválida → erro zod', () => {
    const invalid = { ...VALID_CONFIG, backendBaseUrl: 'not-a-url' };
    writeConfig(JSON.stringify(invalid), 0o600);

    expect(() => loadConfig(cfgPath)).toThrow(/backendBaseUrl/);
    expect(() => loadConfig(cfgPath)).toThrow(/URL/);
  });

  it('6) allowedProjectRoots vazio → erro zod', () => {
    const invalid = { ...VALID_CONFIG, allowedProjectRoots: [] };
    writeConfig(JSON.stringify(invalid), 0o600);

    expect(() => loadConfig(cfgPath)).toThrow(/allowedProjectRoots/);
  });

  it('7) path inexistente → erro "config nao encontrado"', () => {
    const missing = path.join(tmpDir, 'inexistente.json');

    expect(() => loadConfig(missing)).toThrow(/config nao encontrado/);
    expect(() => loadConfig(missing)).toThrow(missing);
  });

  it('7b) override via env SCRUMBAN_AGENT_CONFIG_PATH é respeitado', () => {
    writeConfig(JSON.stringify(VALID_CONFIG), 0o600);
    const prev = process.env.SCRUMBAN_AGENT_CONFIG_PATH;
    process.env.SCRUMBAN_AGENT_CONFIG_PATH = cfgPath;
    try {
      const cfg = loadConfig();
      expect(cfg.agentId).toBe('agent-123');
    } finally {
      if (prev === undefined) {
        delete process.env.SCRUMBAN_AGENT_CONFIG_PATH;
      } else {
        process.env.SCRUMBAN_AGENT_CONFIG_PATH = prev;
      }
    }
  });
});

import { ApiProperty } from '@nestjs/swagger';

/**
 * Response DTO de `POST /projects/:id/agent/:agentId/deploy-key` e
 * `GET /projects/:id/agent/:agentId/deploy-key`.
 *
 * Privada NUNCA aparece aqui (decisao do CEO + ADR-V2-042): apenas a
 * pubkey + fingerprint + instrucoes para o operador colar em
 * Settings → Deploy Keys do GitHub.
 *
 * @see ADR-V2-042 (Deploy Key Automation pull-only)
 */
export class DeployKeyResponseDto {
  /**
   * Public key OpenSSH (`ssh-ed25519 AAAA... comment`).
   * Operador copia para GitHub → repo → Settings → Deploy keys → Add deploy key.
   */
  @ApiProperty({
    description: 'Public key OpenSSH (ed25519)',
    example: 'ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAA... scrumban-agent@my-project',
  })
  publicKey!: string;

  /**
   * Fingerprint SHA256 da public key.
   */
  @ApiProperty({
    description: 'Fingerprint SHA256 da public key',
    example: 'SHA256:abc123def456...',
  })
  fingerprint!: string;

  /**
   * Snippet pronto para colar em `~/.ssh/config` da VPS (caso o operador
   * queira testar manualmente). NAO e estritamente necessario — o agente
   * ja configura `core.sshCommand` no `~/.gitconfig/<slug>/config`.
   */
  @ApiProperty({
    description: 'Snippet ~/.ssh/config (referencia — opcional)',
    example:
      'Host github.com-my-project\n  HostName github.com\n  User git\n  IdentityFile /etc/scrumban-agent/ssh-keys/my-project\n  IdentitiesOnly yes',
  })
  sshConfigSnippet!: string;

  /**
   * Lista de instrucoes (markdown) para o operador adicionar a chave no
   * GitHub. Renderizada na UI.
   */
  @ApiProperty({
    description: 'Passos numerados (markdown) para adicionar deploy key no GitHub',
    example: [
      'Abra https://github.com/<org>/<repo>/settings/keys',
      'Clique em "Add deploy key"',
      'Cole a publicKey acima no campo "Key"',
      'Marque "Allow write access" para permitir PR automatico',
      'Salve',
    ],
    type: [String],
  })
  instructions!: string[];

  /**
   * Timestamp ISO8601 do momento em que a chave foi gerada (ou da ultima
   * regeneracao).
   */
  @ApiProperty({
    description: 'ISO8601 do momento da geracao',
    example: '2026-05-13T18:50:00.000Z',
  })
  generatedAt!: string;

  /**
   * `true` se a chave ja existia no agent (idempotencia) e foi lida em
   * vez de regenerada. `false` se foi criada agora.
   */
  @ApiProperty({
    description: 'true se a chave ja existia no agent (idempotencia)',
    example: false,
  })
  alreadyExisted!: boolean;
}

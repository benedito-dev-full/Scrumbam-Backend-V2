import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MaxLength, MinLength } from 'class-validator';

/**
 * DTO para `PUT /agents/:id/env` — escreve credenciais sensiveis no env file
 * do agente via HMAC outbound (`SET_ENV`).
 *
 * Backend NUNCA persiste plaintext: apenas dispara escrita atomica no agente
 * (que reescreve `/etc/scrumban-agent/environment` 0600 owner=scrumban-agent)
 * e atualiza `dados.envStatus` (booleanos + lastEnvUpdatedAt) na DEntidade -156.
 *
 * Todos os 3 campos sao opcionais: o caller envia apenas as chaves a atualizar.
 * Se todos vierem undefined, o handler rejeita (422). A allowlist da chave
 * (e os tamanhos minimos/maximos abaixo) e replicada no agent (defesa em
 * profundidade) — qualquer chave fora da allowlist falha no env-file-writer.
 *
 * Padroes V2:
 *  - PAT do GitHub `ghp_...` (40 chars) ou `github_pat_...` ate ~256 chars.
 *  - ANTHROPIC_API_KEY `sk-ant-...` ate ~256 chars.
 *  - ANTHROPIC_AUTH_TOKEN para console.anthropic — mesma limitacao.
 *
 * @example
 * ```typescript
 * const dto: SetAgentEnvDto = {
 *   githubToken: 'ghp_abcdef1234567890...',
 *   anthropicApiKey: 'sk-ant-api03-xxx',
 * };
 * ```
 *
 * @see ADR-V2-041 (Env Management via API outbound HMAC)
 */
export class SetAgentEnvDto {
  /**
   * Personal Access Token do GitHub (scope `repo` para PR write).
   *
   * Escrito no env file como `GITHUB_TOKEN=<valor>`. Consumido por
   * `claude -p` e (futuramente) por `git push` automatico no fim de
   * `RUN_CLAUDE_CODE`.
   *
   * Backend NUNCA persiste plaintext. Operador rotaciona no GitHub e
   * reentra aqui.
   */
  @ApiPropertyOptional({
    description: 'PAT do GitHub (scope repo). Enviado para o agent via HMAC; NAO persistido no DB.',
    example: 'ghp_abcdef1234567890ABCDEFGH',
    minLength: 8,
    maxLength: 256,
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  githubToken?: string;

  /**
   * Chave da Anthropic API (formato `sk-ant-...`).
   *
   * Escrito como `ANTHROPIC_API_KEY=<valor>`. Consumido pelo `claude -p`
   * em todas as execucoes do agente.
   */
  @ApiPropertyOptional({
    description: 'ANTHROPIC_API_KEY (sk-ant-...). Enviado via HMAC; NAO persistido no DB.',
    example: 'sk-ant-api03-xxxxxxxxxxxxxxxx',
    minLength: 8,
    maxLength: 256,
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(256)
  anthropicApiKey?: string;

  /**
   * Token alternativo (Claude Console / OAuth) para autenticacao do
   * `claude` CLI. Mutuamente compatibilidade com `anthropicApiKey` — o
   * agente aceita ambos; o `claude` consome qualquer um deles.
   *
   * Escrito como `ANTHROPIC_AUTH_TOKEN=<valor>`.
   */
  @ApiPropertyOptional({
    description:
      'ANTHROPIC_AUTH_TOKEN (claude setup-token). Enviado via HMAC; NAO persistido no DB.',
    example: 'sk-ant-oat01-xxxxxxxxxxxxxxxx',
    minLength: 8,
    maxLength: 1024,
  })
  @IsOptional()
  @IsString()
  @MinLength(8)
  @MaxLength(1024)
  anthropicAuthToken?: string;
}

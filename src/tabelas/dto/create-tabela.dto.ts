import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, IsOptional, IsNumberString } from 'class-validator';

/**
 * DTO para criação de tabela lookup/config (POST /tabelas).
 *
 * Cria um novo registro DTabela de qualquer tipo via idClasse.
 * Usado para criar: sprints, statuses customizados, prioridades, webhooks,
 * API keys, configurações por entidade, etc.
 *
 * @example
 * ```json
 * // Criar sprint
 * { "idClasse": "-400", "nome": "Sprint 1", "codigo": "SPR-001" }
 *
 * // Criar webhook vinculado a um projeto
 * { "idClasse": "-470", "nome": "Deploy Hook", "dEntidadeId": "100",
 *   "dados": { "url": "https://hooks.example.com", "secret": "..." } }
 * ```
 */
export class CreateTabelaDto {
  /**
   * ID da DClasse que define o tipo.
   * Ex: -400 (Sprint), -440 (Status V3), -420 (Priority), -470 (Webhook).
   */
  @ApiProperty({
    description: 'ID da DClasse. Ex: -440 (Status V3), -400 (Sprint)',
    example: '-440',
  })
  @IsNotEmpty()
  @IsNumberString({}, { message: 'idClasse deve ser um número inteiro' })
  idClasse!: string;

  /**
   * Nome do lookup/config.
   */
  @ApiProperty({
    description: 'Nome',
    example: 'Sprint 1',
  })
  @IsNotEmpty()
  @IsString()
  nome!: string;

  /**
   * Código único do lookup.
   */
  @ApiPropertyOptional({
    description: 'Código único',
    example: 'SPR-001',
  })
  @IsOptional()
  @IsString()
  codigo?: string;

  /**
   * Descrição textual.
   */
  @ApiPropertyOptional({
    description: 'Descrição',
    example: 'Primeiro sprint do projeto',
  })
  @IsOptional()
  @IsString()
  descricao?: string;

  /**
   * Entidade dona deste registro (config por organização/projeto).
   * Null/ausente para catálogos globais.
   */
  @ApiPropertyOptional({
    description: 'Chave da DEntidade dona (para configs por entidade)',
    example: '100',
  })
  @IsOptional()
  @IsNumberString({}, { message: 'dEntidadeId deve ser um número inteiro' })
  dEntidadeId?: string;

  /**
   * Dados polimórficos específicos do tipo.
   */
  @ApiPropertyOptional({
    description: 'Dados adicionais (Json)',
    example: { url: 'https://hooks.example.com', events: ['task.created'] },
  })
  @IsOptional()
  dados?: Record<string, unknown>;
}

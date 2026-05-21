import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Métricas agregadas opcionais de um nó da árvore (apenas para fases).
 *
 * Anexadas quando `GET /tasks/:id/tree?includeMetrics=true` é solicitado.
 * Estrutura paralela a `PhaseMetricsResponseDto` para reuso de campos
 * em payloads aninhados.
 *
 * @see PhaseMetricsResponseDto
 */
export class PhaseTreeNodeMetricsDto {
  @ApiProperty({ description: 'Total de descendentes (excluindo a própria fase)', example: 50 })
  total!: number;

  @ApiProperty({ description: 'Tasks em estado DONE', example: 20 })
  done!: number;

  @ApiProperty({ description: 'Tasks em estado FAILED', example: 2 })
  failed!: number;

  @ApiProperty({ description: 'Tasks em estado EXECUTING', example: 5 })
  inProgress!: number;

  @ApiProperty({ description: 'Percentual concluído (0-100)', example: 40 })
  percent!: number;
}

/**
 * Nó da árvore retornada por `GET /tasks/:id/tree`.
 *
 * Representação recursiva — cada nó tem `children[]` com outros
 * `PhaseTreeNodeDto`. Folhas têm `children: []`.
 *
 * Em Fase 4 a árvore é montada por `PhaseTreeService.buildTree`
 * (implementação real em Fase 5). Até lá, o endpoint responde 501.
 *
 * @see PhaseTreeService
 */
export class PhaseTreeNodeDto {
  @ApiProperty({ description: 'ID da task/fase (chave DTask)', example: '7' })
  id!: string;

  @ApiProperty({ description: 'Nome/título da task', example: 'Implementar JWT' })
  nome!: string;

  @ApiProperty({
    description: 'idClasse polimórfica. -200=PHASE; -154=SCRUMBAN_TASK',
    example: '-200',
  })
  idClasse!: string;

  @ApiPropertyOptional({
    description: 'idPai (chave do nó pai); null se raiz',
    nullable: true,
    example: null,
  })
  idPai!: string | null;

  @ApiPropertyOptional({
    description: 'Estado V3 atual (apenas para tasks executáveis; fases não usam V3)',
    nullable: true,
    example: 'INBOX',
  })
  status!: string | null;

  @ApiProperty({ description: 'Profundidade na árvore (0=raiz)', example: 0 })
  depth!: number;

  @ApiProperty({
    description: 'Filhas diretas (recursivo)',
    type: () => [PhaseTreeNodeDto],
  })
  children!: PhaseTreeNodeDto[];

  @ApiPropertyOptional({
    description: 'Métricas agregadas — anexadas quando `includeMetrics=true`',
    type: () => PhaseTreeNodeMetricsDto,
    nullable: true,
  })
  metrics?: PhaseTreeNodeMetricsDto | null;
}

/**
 * Resposta de `GET /tasks/:id/tree`.
 *
 * Envelopa a árvore com metadados (raiz + total de nós, depth máxima
 * atingida). Útil para o frontend dimensionar o componente recursivo.
 */
export class PhaseTreeResponseDto {
  @ApiProperty({
    description: 'Árvore a partir da task/fase raiz',
    type: () => PhaseTreeNodeDto,
  })
  root!: PhaseTreeNodeDto;

  @ApiProperty({
    description: 'Total de nós retornados (incluindo a raiz)',
    example: 12,
  })
  totalNodes!: number;

  @ApiProperty({
    description: 'Profundidade máxima atingida (0=apenas a raiz)',
    example: 3,
  })
  maxDepthReached!: number;
}

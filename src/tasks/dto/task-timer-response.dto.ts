import { ApiProperty } from '@nestjs/swagger';

/**
 * Total de tempo manual acumulado por um usuário em uma task (ADR-V2-057).
 *
 * É o somatório server-side de `durationMs` de todas as sessões **fechadas**
 * (`manualTimers[]` com `endedAt` definido) daquele `userId`. O nome do usuário
 * é hidratado em batch a partir de `DEntidade.nome` (1 query para todo o lote —
 * ZERO N+1).
 *
 * @example
 * ```json
 * { "userId": "42", "userName": "Fulano da Silva", "totalMs": 9900000 }
 * ```
 */
export class TaskTimerUserTotalDto {
  @ApiProperty({
    description: 'DEntidade.chave (string) do humano dono das sessões.',
    example: '42',
  })
  userId!: string;

  @ApiProperty({
    description:
      'Nome do usuário hidratado de DEntidade.nome. Null se a entidade não ' +
      'for encontrada (usuário removido/desconhecido).',
    nullable: true,
    example: 'Fulano da Silva',
  })
  userName!: string | null;

  @ApiProperty({
    description:
      'Soma server-side (em milissegundos) das durações de todas as sessões ' +
      'fechadas deste usuário. Calculado a partir de Date do servidor — ' +
      'anti-fraude (ADR-V2-057).',
    example: 9900000,
    minimum: 0,
  })
  totalMs!: number;
}

/**
 * Estado agregado do timer manual de uma task (ADR-V2-057).
 *
 * Exposto em `TaskResponseDto.timer`. Deriva inteiramente de
 * `DTask.dados.telemetry.manualTimers[]` (Json em coluna existente — ZERO
 * tabela nova). Toda a aritmética (`totalMs` por usuário) é computada
 * server-side; o cronômetro do frontend é puramente visual e usa
 * `runningStartedAt` como offset.
 *
 * Quando uma task nunca teve timer (sem `manualTimers`), o campo
 * `TaskResponseDto.timer` é `null` em vez de um estado vazio.
 *
 * @example
 * ```json
 * {
 *   "running": true,
 *   "runningUserId": "42",
 *   "runningStartedAt": "2026-06-01T13:00:00.000Z",
 *   "totalsByUser": [
 *     { "userId": "42", "userName": "Fulano", "totalMs": 9900000 },
 *     { "userId": "43", "userName": "Beltrano", "totalMs": 2700000 }
 *   ]
 * }
 * ```
 */
export class TaskTimerStateDto {
  @ApiProperty({
    description: 'true se há uma sessão aberta (sem endedAt) na task.',
    example: true,
  })
  running!: boolean;

  @ApiProperty({
    description:
      'DEntidade.chave (string) do usuário com a sessão aberta. Null se não ' +
      'há timer em andamento.',
    nullable: true,
    example: '42',
  })
  runningUserId!: string | null;

  @ApiProperty({
    description:
      'ISO 8601 do início da sessão aberta. O frontend usa como offset para o ' +
      'cronômetro visual (anti-fraude — o valor gravado é sempre server-side). ' +
      'Null se não há timer em andamento.',
    nullable: true,
    example: '2026-06-01T13:00:00.000Z',
  })
  runningStartedAt!: string | null;

  @ApiProperty({
    description:
      'Total de tempo manual por usuário (sessões fechadas). Ordenado por ' +
      'userId crescente para resposta determinística.',
    type: () => [TaskTimerUserTotalDto],
  })
  totalsByUser!: TaskTimerUserTotalDto[];
}

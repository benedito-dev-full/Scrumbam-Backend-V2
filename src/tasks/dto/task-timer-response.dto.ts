import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Sessão manual **crua** de timer de uma task (ADR-V2-057).
 *
 * Espelho 1:1 de um item de `DTask.dados.telemetry.manualTimers[]` — o registro
 * individual de um intervalo cronometrado por um humano (start → pause/stop). É a
 * FONTE para o cliente recortar tempo focado por intervalo de datas (ex.: "quanto
 * foi trabalhado nesta task nesta semana"), algo que o agregado
 * {@link TaskTimerStateDto} (total por usuário, sem quebra por data) não permite.
 *
 * **Anti-fraude (ADR-V2-057):** `endedAt` e `durationMs` são gravados server-side
 * no momento do pause/stop (`Date` do servidor). O cliente NUNCA envia duração; a
 * aritmética é sempre do servidor. O front deve exibir/somar estes valores, não
 * recalculá-los a partir de relógio local.
 *
 * Uma sessão **aberta** (timer em andamento) tem `endedAt` e `durationMs` iguais a
 * `null`.
 *
 * @example
 * ```json
 * {
 *   "userId": "42",
 *   "startedAt": "2026-06-01T13:00:00.000Z",
 *   "endedAt": "2026-06-01T13:45:00.000Z",
 *   "durationMs": 2700000
 * }
 * ```
 *
 * @see TaskTimerStateDto — agregado total por usuário (sem recorte por data)
 * @see ADR-V2-057 — timer manual via dados.telemetry.manualTimers
 */
export class TaskTimerSessionDto {
  @ApiProperty({
    description: 'DEntidade.chave (string) do humano dono da sessão.',
    example: '42',
  })
  userId!: string;

  @ApiProperty({
    description:
      'ISO 8601 do início da sessão (gravado server-side no start/resume). ' +
      'É a âncora temporal usada pelo cliente para recorte por intervalo de datas.',
    example: '2026-06-01T13:00:00.000Z',
  })
  startedAt!: string;

  @ApiPropertyOptional({
    description:
      'ISO 8601 do fim da sessão (gravado server-side no pause/stop). ' +
      'Null quando a sessão ainda está aberta (timer em andamento).',
    nullable: true,
    example: '2026-06-01T13:45:00.000Z',
  })
  endedAt!: string | null;

  @ApiPropertyOptional({
    description:
      'Duração em milissegundos (endedAt − startedAt), calculada server-side ' +
      '(anti-fraude — ADR-V2-057). Null quando a sessão ainda está aberta.',
    nullable: true,
    example: 2700000,
    minimum: 0,
  })
  durationMs!: number | null;
}

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

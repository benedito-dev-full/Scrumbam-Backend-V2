/**
 * Backfill de DADOS (não-DDL, não é migration) da baixa canônica de execuções
 * Claude Code — ADR-V2-082 (Task 2, Fase 7).
 *
 * ## Contexto
 * Até a ADR-V2-082 nenhum caminho gravava `DPedido.baixado=true` em execuções
 * (-301/-302/-303). `TasksService.findActiveExecutionsForTasks` usa
 * `baixado=false` como "execução ativa" → TODA execução terminada virou lock
 * "zumbi" (`activeExecution != null` para sempre; REJECTED/EXPIRED apareciam
 * como `awaiting_approval`). Além disso, execuções presas em RUNNING (-518)
 * nunca foram fechadas (não existia sweeper).
 *
 * ## O que o script faz
 * 1. **Baixa de terminais (sempre):** `baixado=true` em execuções com
 *    `statusCode` ∈ {-517 REJECTED, -519 SUCCESS, -520 FAILED, -521 EXPIRED,
 *    -522 ROLLED_BACK} e `baixado=false`.
 * 2. **`--close-stale-running` (decisão CEO P3 — fechar em silêncio):** fecha
 *    as RUNNING vencidas pelo MESMO critério de deadline do sweeper
 *    (`COALESCE(runtime.startedAt, atualizadoEm) + COALESCE(timeoutSec,1800)
 *    + 300s < NOW()`), gravando o mesmo formato do sweeper (statusCode -520,
 *    baixado=true, claude.finishedAt, claude.exitCode=-1,
 *    `audit.outcome={success:false, source:'system', reason:'BACKFILL_STALE'}`).
 *    **SEM eventos** (sem execution.failed / notificação / webhook / DEvento):
 *    é limpeza de dívida, não falha nova. Como `source='system'`, um callback
 *    tardio ainda substitui o desfecho (P1). Rodar IMEDIATAMENTE antes do
 *    deploy do backend novo → o 1º ciclo do sweeper não encontra rajada.
 * 3. **`--release-tasks`:** tasks vinculadas às execuções fechadas no passo 2
 *    que ainda estão EXECUTING → FAILED via `TasksService.updateStatus`
 *    (contexto Nest — preserva workSession/telemetria/eventos de STATUS da task;
 *    o silêncio é só sobre a execução).
 *
 * ## Segurança
 * - **Dry-run é o padrão** — sem `--apply`, ZERO escrita; só relata contagens.
 * - **Idempotente** — rodar 2x: a 2ª encontra 0 linhas.
 * - **Rollback:** `--apply` grava `backfill-execution-baixado.<timestamp>.json`
 *   (no diretório corrente, permissão 0600, ignorado pelo `.gitignore` — contém
 *   `dados` completos com stdout/prompt; descartar após o deploy) ANTES de escrever, com as chaves baixadas e o
 *   `dados`/`baixado` anteriores das RUNNING fechadas. `--revert <arquivo>`
 *   restaura (`baixado=false` nas baixadas; `dados`+`baixado` originais nas
 *   fechadas — somente se ainda estiverem com `reason='BACKFILL_STALE'`, i.e.
 *   nenhum callback real chegou depois).
 * - **Backup obrigatório em produção:** `pg_dump -t '"DPedido"'` (ou snapshot
 *   do provedor) ANTES do `--apply`. O Implementer NÃO roda este script contra
 *   banco algum — execução é do CEO/ops (protocolo de migration).
 *
 * ## Uso
 * ```bash
 * npx ts-node prisma/scripts/backfill-execution-baixado.ts                     # dry-run
 * npx ts-node prisma/scripts/backfill-execution-baixado.ts --close-stale-running  # dry-run + RUNNING
 * npx ts-node prisma/scripts/backfill-execution-baixado.ts --apply --close-stale-running --release-tasks
 * npx ts-node prisma/scripts/backfill-execution-baixado.ts --revert backfill-execution-baixado.<ts>.json
 * ```
 *
 * Opções: `--margin-sec <n>` (default 300) e `--default-timeout-sec <n>`
 * (default 1800) — devem casar com o sweeper (EXECUTION_DEADLINE_MARGIN_SEC /
 * EXECUTION_DEFAULT_TIMEOUT_SEC).
 *
 * @see ADR-V2-082 — ciclo de vida terminal de execuções
 * @see src/executions/execution-running-sweeper.service.ts
 * @see src/engine/lib/operacao/OperacaoExecucaoClaude.ts (sqlDadosFalhaSistemica)
 */
import { Logger } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import OperacaoExecucaoClaude from '../../src/engine/lib/operacao/OperacaoExecucaoClaude';

const logger = new Logger('backfill-execution-baixado');
const prisma = new PrismaClient();

const EXECUTION_CLASSES = [BigInt(-301), BigInt(-302), BigInt(-303)];
const TERMINAL_STATUS = ['-517', '-519', '-520', '-521', '-522'];
const REASON_BACKFILL = 'BACKFILL_STALE';

interface Args {
  apply: boolean;
  closeStaleRunning: boolean;
  releaseTasks: boolean;
  revert?: string;
  marginSec: number;
  defaultTimeoutSec: number;
}

interface SnapshotFile {
  createdAt: string;
  marginSec: number;
  defaultTimeoutSec: number;
  baixados: string[];
  closedStale: Array<{ chave: string; baixado: boolean; dados: unknown; taskId: string | null }>;
}

/**
 * Interpreta as flags da CLI. Sem `--apply` o script só reporta (dry-run).
 *
 * @param argv - Argumentos após o nome do script
 * @returns Argumentos tipados; lança erro se inteiros inválidos
 *
 * @example
 * parseArgs(['--apply', '--close-stale-running']); // apply=true, closeStaleRunning=true
 */
function parseArgs(argv: string[]): Args {
  const num = (flag: string, fallback: number): number => {
    const i = argv.indexOf(flag);
    if (i < 0) return fallback;
    const n = Number(argv[i + 1]);
    if (!Number.isInteger(n) || n <= 0) throw new Error(`${flag} exige inteiro positivo`);
    return n;
  };
  const revertIdx = argv.indexOf('--revert');
  return {
    apply: argv.includes('--apply'),
    closeStaleRunning: argv.includes('--close-stale-running'),
    releaseTasks: argv.includes('--release-tasks'),
    revert: revertIdx >= 0 ? argv[revertIdx + 1] : undefined,
    marginSec: num('--margin-sec', 300),
    defaultTimeoutSec: num('--default-timeout-sec', 1800),
  };
}

/** Linhas terminais ainda com baixado=false (zumbis). */
async function findTerminaisNaoBaixados(): Promise<bigint[]> {
  const rows = await prisma.$queryRaw<Array<{ chave: bigint }>>(Prisma.sql`
    SELECT chave FROM "DPedido"
     WHERE "idClasse" IN (${Prisma.join(EXECUTION_CLASSES)})
       AND baixado = false
       AND dados->>'statusCode' IN (${Prisma.join(TERMINAL_STATUS)})
     ORDER BY chave
  `);
  return rows.map((r) => r.chave);
}

/** RUNNING vencidas pelo critério de deadline do sweeper. */
async function findRunningVencidas(
  args: Args,
): Promise<Array<{ chave: bigint; baixado: boolean; dados: Prisma.JsonValue }>> {
  return prisma.$queryRaw<Array<{ chave: bigint; baixado: boolean; dados: Prisma.JsonValue }>>(
    Prisma.sql`
      SELECT chave, baixado, dados FROM "DPedido" p
       WHERE p."idClasse" IN (${Prisma.join(EXECUTION_CLASSES)})
         AND p.excluido = false
         AND p.dados->>'statusCode' = '-518'
         AND p.dados->'audit'->'outcome' IS NULL
         AND COALESCE((p.dados->'runtime'->>'startedAt')::timestamptz, p."atualizadoEm")
             + make_interval(secs => ((CASE WHEN p.dados->>'timeoutSec' ~ '^[0-9]+$'
                                            THEN (p.dados->>'timeoutSec')::int
                                            ELSE ${args.defaultTimeoutSec}::int END)
                                      + ${args.marginSec}::int)::double precision) < NOW()
       ORDER BY chave
    `,
  );
}

/**
 * Extrai o `DTask.chave` de `dados.task.id` (string numérica), ou null.
 *
 * @param dados - Campo `dados` (Json) de uma execução
 * @returns ID da task vinculada ou null
 */
function taskIdOf(dados: unknown): string | null {
  const task = (dados as { task?: { id?: unknown } } | null)?.task;
  return typeof task?.id === 'string' && /^\d+$/.test(task.id) ? task.id : null;
}

/** Tasks (dentre as informadas) cujo estado V3 é EXECUTING. */
async function findExecutingTasks(taskIds: string[]): Promise<string[]> {
  if (taskIds.length === 0) return [];
  const tasks = await prisma.dTask.findMany({
    where: { chave: { in: taskIds.map((id) => BigInt(id)) }, excluido: false },
    select: { chave: true, dados: true },
  });
  return tasks
    .filter((t) => (t.dados as { v3?: { state?: string } } | null)?.v3?.state === 'EXECUTING')
    .map((t) => t.chave.toString());
}

/** Move tasks EXECUTING → FAILED via TasksService (contexto Nest, carregado sob demanda). */
async function releaseTasks(taskIds: string[]): Promise<void> {
  if (taskIds.length === 0) return;
  // Import dinâmico: só sobe o contexto Nest quando realmente necessário.
  const { NestFactory } = await import('@nestjs/core');
  const { AppModule } = await import('../../src/app.module');
  const { TasksService } = await import('../../src/tasks/tasks.service');
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn'] });
  try {
    const tasksService = app.get(TasksService);
    for (const taskId of taskIds) {
      try {
        await tasksService.updateStatus(taskId, { status: 'FAILED' });
        logger.log(`task ${taskId} EXECUTING → FAILED`);
      } catch (err) {
        logger.warn(`task ${taskId} não movida: ${(err as Error).message}`);
      }
    }
  } finally {
    await app.close();
  }
}

/**
 * Modo forward: baixa terminais, opcionalmente fecha RUNNING vencidas e libera
 * tasks EXECUTING. Em dry-run apenas imprime contagens; com `--apply` grava o
 * snapshot `backfill-execution-baixado.<ts>.json` antes de escrever.
 *
 * @param args - Flags já interpretadas
 */
async function runForward(args: Args): Promise<void> {
  const terminais = await findTerminaisNaoBaixados();
  const vencidas = args.closeStaleRunning ? await findRunningVencidas(args) : [];
  const vencidasTaskIds = Array.from(
    new Set(vencidas.map((v) => taskIdOf(v.dados)).filter((id): id is string => id !== null)),
  );
  const tasksExecuting = await findExecutingTasks(vencidasTaskIds);

  logger.log(`modo=${args.apply ? 'APPLY' : 'DRY-RUN'}`);
  logger.log(`terminais com baixado=false (zumbis): ${terminais.length}`);
  if (args.closeStaleRunning) {
    logger.log(
      `RUNNING vencidas (deadline = timeoutSec|${args.defaultTimeoutSec} + ${args.marginSec}s): ${vencidas.length}`,
    );
    logger.log(
      `tasks vinculadas ainda EXECUTING: ${tasksExecuting.length}${tasksExecuting.length ? ` [${tasksExecuting.join(', ')}]` : ''}`,
    );
  }

  if (!args.apply) {
    logger.log('DRY-RUN: nada foi escrito. Rode com --apply para aplicar.');
    return;
  }

  // Snapshot de rollback ANTES de escrever.
  const snapshot: SnapshotFile = {
    createdAt: new Date().toISOString(),
    marginSec: args.marginSec,
    defaultTimeoutSec: args.defaultTimeoutSec,
    baixados: terminais.map((c) => c.toString()),
    closedStale: vencidas.map((v) => ({
      chave: v.chave.toString(),
      baixado: v.baixado,
      dados: v.dados,
      taskId: taskIdOf(v.dados),
    })),
  };
  const file = join(
    process.cwd(),
    `backfill-execution-baixado.${snapshot.createdAt.replace(/[:.]/g, '-')}.json`,
  );
  // L4: contém DPedido.dados completos (stdout/prompt) → 0600 e fora do git
  // (`.gitignore`: backfill-execution-baixado.*.json). Descartar após o deploy.
  writeFileSync(file, JSON.stringify(snapshot, null, 2), { mode: 0o600 });
  logger.log(`snapshot de rollback gravado (0600, ignorado pelo git): ${file}`);

  const [baixadas, fechadas] = await prisma.$transaction(async (tx) => {
    const b =
      terminais.length === 0
        ? 0
        : await tx.$executeRaw(Prisma.sql`
            UPDATE "DPedido" SET baixado = true, "atualizadoEm" = NOW()
             WHERE chave = ANY(${terminais}::bigint[])
               AND baixado = false
               AND dados->>'statusCode' IN (${Prisma.join(TERMINAL_STATUS)})
          `);
    const chavesVencidas = vencidas.map((v) => v.chave);
    const f =
      chavesVencidas.length === 0
        ? 0
        : await tx.$executeRaw(Prisma.sql`
            UPDATE "DPedido"
               SET dados = ${OperacaoExecucaoClaude.sqlDadosFalhaSistemica(
                 Prisma.sql`${REASON_BACKFILL}::text`,
                 Prisma.sql`${REASON_BACKFILL}::text`,
                 Prisma.sql`${REASON_BACKFILL}::text`,
               )},
                   baixado = true,
                   "atualizadoEm" = NOW()
             WHERE chave = ANY(${chavesVencidas}::bigint[])
               AND dados->>'statusCode' = '-518'
               AND dados->'audit'->'outcome' IS NULL
          `);
    return [b, f];
  });
  logger.log(`aplicado: baixadas=${baixadas} RUNNING fechadas=${fechadas} (sem eventos)`);

  if (args.releaseTasks) {
    // Relê: só move tasks ainda EXECUTING (não pisa em humano).
    await releaseTasks(await findExecutingTasks(vencidasTaskIds));
  } else if (tasksExecuting.length > 0) {
    logger.warn('tasks vinculadas seguem EXECUTING — rode novamente com --release-tasks se desejar');
  }
}

/**
 * Rollback: restaura `baixado`/`dados` das linhas do snapshot que ainda estão
 * no estado gravado pelo backfill (só reverte o que o backfill alterou).
 *
 * @param file - Caminho do snapshot JSON gerado por `--apply`
 */
async function runRevert(file: string): Promise<void> {
  const snapshot = JSON.parse(readFileSync(file, 'utf8')) as SnapshotFile;
  logger.log(
    `revert de ${file}: baixados=${snapshot.baixados.length} closedStale=${snapshot.closedStale.length}`,
  );
  await prisma.$transaction(async (tx) => {
    if (snapshot.baixados.length > 0) {
      const chaves = snapshot.baixados.map((c) => BigInt(c));
      const n = await tx.$executeRaw(Prisma.sql`
        UPDATE "DPedido" SET baixado = false, "atualizadoEm" = NOW()
         WHERE chave = ANY(${chaves}::bigint[])
           AND dados->>'statusCode' IN (${Prisma.join(TERMINAL_STATUS)})
      `);
      logger.log(`revert baixa: ${n} linha(s)`);
    }
    let restauradas = 0;
    for (const row of snapshot.closedStale) {
      restauradas += await tx.$executeRaw(Prisma.sql`
        UPDATE "DPedido"
           SET dados = ${JSON.stringify(row.dados)}::jsonb, baixado = ${row.baixado}, "atualizadoEm" = NOW()
         WHERE chave = ${BigInt(row.chave)}
           AND dados->'audit'->'outcome'->>'reason' = ${REASON_BACKFILL}
      `);
    }
    logger.log(`revert RUNNING fechadas: ${restauradas} linha(s) (callbacks reais posteriores preservados)`);
  });
}

/**
 * Entrypoint do script: despacha para `--revert` ou para o modo forward.
 */
async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (args.revert) {
    await runRevert(args.revert);
    return;
  }
  await runForward(args);
}

main()
  .catch((err) => {
    logger.error(`backfill falhou: ${(err as Error).message}`, (err as Error).stack);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

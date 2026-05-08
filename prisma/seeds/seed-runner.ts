/**
 * Runner do seed canonico de DClasses — Scrumban-Backend-V2 (Pilar 3 — F1).
 *
 * Entrypoint chamado por:
 *   - `npm run seed:classes`
 *   - `npx prisma db seed` (configurado em `package.json#prisma.seed`)
 *
 * Garantias (ADR-V2-020):
 *   - **Idempotencia forte:** UPSERT por chave (`prisma.dClasse.upsert`).
 *     Re-execucao restaura drift de campos editaveis para o canonico.
 *   - **Atomicidade total:** todos os UPSERTs dentro de `prisma.$transaction`.
 *     Se um falha, todos voltam (consistencia 0-ou-N).
 *   - **Validacao previa:** `classes.seed.ts` chama `validateHierarchy()` em
 *     time de import — falha em ciclo/orfao/sequestro acontece ANTES do
 *     primeiro round-trip ao banco.
 *
 * Modos:
 *   - default: conecta no banco e aplica UPSERTs em transacao.
 *   - `--dry-run`: importa o seed (validacao roda), conta classes, e sai
 *     sem tocar o banco. Util para CI offline e smoke local sem Postgres.
 *
 * Logging (ADR-V2-024):
 *   - Permite `console.log/error` neste arquivo (script CLI fora do Nest).
 *     Override ESLint declarado em `eslint.config.js` para
 *     `prisma/seeds/seed-runner.ts`.
 *
 * @see prisma/seeds/classes.seed.ts (origem dos dados)
 * @see prisma/seeds/validate-hierarchy.ts (validador)
 * @see docs/decisions/ADR-V2-020-upsert-idempotente.md
 * @see docs/decisions/ADR-V2-024-console-log-em-seeds.md
 */

import { Prisma, PrismaClient } from '@prisma/client';
import { classes, COUNTS } from './classes.seed';

/**
 * Codigo de saida usado quando o seed falha por motivo nao recuperavel.
 * Convenciona-se 1 (POSIX standard) em vez de 2 para diferenciar de
 * `enforce-canonical-tables.sh` (que usa 2 em violacoes de hook).
 */
const EXIT_FAIL = 1;

/**
 * Determina se o runner foi invocado em modo dry-run.
 *
 * Aceita:
 *   - flag CLI: `ts-node seed-runner.ts --dry-run`
 *   - env var:  `SEED_DRY_RUN=true`
 *
 * @returns true se dry-run, false se modo normal (com banco).
 */
function isDryRun(): boolean {
  return (
    process.argv.includes('--dry-run') ||
    process.env.SEED_DRY_RUN === 'true' ||
    process.env.SEED_DRY_RUN === '1'
  );
}

/**
 * Aplica o seed canonico de DClasses no banco via UPSERT atomico.
 *
 * Fluxo:
 *  1. Validacao ja rodou no `import` de `classes.seed`.
 *  2. Abre transacao Prisma.
 *  3. Para cada classe: `upsert` por `chave` (BigInt). `update` espelha o
 *     `create` (drift detection — re-seed restaura canonico).
 *  4. Commit ao final. Em qualquer erro, rollback automatico.
 *  5. Loga sumario `OK — N fixas + M especificas = T classes`.
 *
 * @param prisma - cliente Prisma conectado ao Postgres.
 * @returns total de classes processadas (deve ser igual a COUNTS.total).
 * @throws qualquer erro do Prisma e propagado (transacao ja foi rollback).
 */
async function applyCanonicalSeed(prisma: PrismaClient): Promise<number> {
  const result = await prisma.$transaction(async (tx) => {
    let processed = 0;
    for (const c of classes) {
      const chaveBig = BigInt(c.chave);
      const idPaiBig = c.idPai !== null ? BigInt(c.idPai) : null;
      // tableFields = null usa o sentinel `Prisma.JsonNull` (Prisma 5+
      // distingue JSON SQL NULL de JSON `null` value). Em valores nao-null
      // o cast para `Prisma.InputJsonValue` e seguro porque seed-runner
      // so consome dados serializaveis.
      const tableFieldsValue: Prisma.NullableJsonNullValueInput | Prisma.InputJsonValue =
        c.tableFields === null || c.tableFields === undefined
          ? Prisma.JsonNull
          : (c.tableFields as Prisma.InputJsonValue);
      const data: Prisma.DClasseUncheckedCreateInput = {
        chave: chaveBig,
        codigo: c.codigo,
        nome: c.nome,
        idPai: idPaiBig,
        agrupamento: c.agrupamento,
        inativo: c.inativo,
        excluido: c.excluido,
        excluivel: c.excluivel,
        editavel: c.editavel,
        tableFields: tableFieldsValue,
        baseFields: c.baseFields,
      };
      await tx.dClasse.upsert({
        where: { chave: chaveBig },
        create: data,
        update: data,
      });
      processed++;
    }
    return processed;
  });
  return result;
}

/**
 * Main do runner — orquestra dry-run vs modo normal, gerencia conexao
 * Prisma e codigos de saida.
 */
async function main(): Promise<void> {
  const dry = isDryRun();
  const startedAt = Date.now();

  // eslint-disable-next-line no-console
  console.log(
    `[seed-runner] iniciando ${dry ? 'em DRY-RUN (sem banco)' : 'modo normal (banco)'} — ` +
      `${COUNTS.fixas} fixas + ${COUNTS.especificas} especificas = ${COUNTS.total} classes`,
  );

  if (dry) {
    // eslint-disable-next-line no-console
    console.log(
      `[seed-runner] OK (dry-run) — ${COUNTS.fixas} fixas + ${COUNTS.especificas} especificas = ${COUNTS.total} classes (validacao passou em time de import)`,
    );
    return;
  }

  const prisma = new PrismaClient();
  try {
    await prisma.$connect();
    const processed = await applyCanonicalSeed(prisma);
    const elapsed = Date.now() - startedAt;
    // eslint-disable-next-line no-console
    console.log(
      `[seed-runner] OK — ${COUNTS.fixas} fixas + ${COUNTS.especificas} especificas = ${processed} classes upserted em ${elapsed}ms`,
    );
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error(`[seed-runner] FALHA — ${err instanceof Error ? err.message : String(err)}`);
  if (err instanceof Error && err.stack) {
    // eslint-disable-next-line no-console
    console.error(err.stack);
  }
  process.exit(EXIT_FAIL);
});

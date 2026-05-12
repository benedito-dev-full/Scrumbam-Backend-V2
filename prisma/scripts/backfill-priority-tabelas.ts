/**
 * Backfill idempotente das 4 DTabelas PRIORITY por projeto (V2 F4 — Task 01).
 *
 * Contexto:
 *   Antes deste fix, `SeedBootstrapService.seedProject()` criava apenas
 *   9 statuses V3 + 1 sprint. Projetos criados nesse período NÃO têm as
 *   DTabelas PRIORITY (idClasse=-421..-424) necessárias para que
 *   `TasksService` resolva `idPriority` via lookup
 *   `(idClasse, dEntidadeId=projectId)`.
 *
 * Este script:
 *   1. Lista todos os DProject não-excluídos.
 *   2. Para cada projeto, verifica quais das 4 priorities estão ausentes.
 *   3. Cria as DTabelas faltantes (HIGH/MEDIUM/LOW/URGENT).
 *
 * Idempotente: rodar 2x não duplica nada.
 *
 * Uso:
 *   npx ts-node prisma/scripts/backfill-priority-tabelas.ts
 *
 * Saída: relatório em stdout com totais (projetos visitados, priorities criadas).
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const PRIORITY_DEFAULTS: Array<{ idClasse: bigint; nome: string; codigo: string }> = [
  { idClasse: BigInt(-421), nome: 'HIGH', codigo: 'HIGH' },
  { idClasse: BigInt(-422), nome: 'MEDIUM', codigo: 'MEDIUM' },
  { idClasse: BigInt(-423), nome: 'LOW', codigo: 'LOW' },
  { idClasse: BigInt(-424), nome: 'URGENT', codigo: 'URGENT' },
];

/**
 * Aplica backfill em um único projeto. Idempotente.
 *
 * @returns número de priorities criadas (0 se todas já existiam)
 */
async function backfillProject(projectId: bigint): Promise<number> {
  // 1 query para todas as priorities existentes do projeto
  const existing = await prisma.dTabela.findMany({
    where: {
      idClasse: { in: PRIORITY_DEFAULTS.map((p) => p.idClasse) },
      dEntidadeId: projectId,
      excluido: false,
    },
    select: { idClasse: true },
  });

  const existingClasses = new Set(existing.map((e) => e.idClasse.toString()));
  let created = 0;

  for (const priority of PRIORITY_DEFAULTS) {
    if (existingClasses.has(priority.idClasse.toString())) continue;
    await prisma.dTabela.create({
      data: {
        idClasse: priority.idClasse,
        nome: priority.nome,
        codigo: priority.codigo,
        dEntidadeId: projectId,
        metaDados: { v3Priority: true, backfilled: true } as Prisma.InputJsonValue,
      },
    });
    created++;
  }

  return created;
}

async function main(): Promise<void> {
  // eslint-disable-next-line no-console
  console.log('[backfill-priority-tabelas] iniciando…');

  const projects = await prisma.dProject.findMany({
    where: { excluido: false },
    select: { chave: true, nome: true },
    orderBy: { chave: 'asc' },
  });

  // eslint-disable-next-line no-console
  console.log(`[backfill-priority-tabelas] ${projects.length} projetos a verificar`);

  let totalCreated = 0;
  let projectsAffected = 0;

  for (const project of projects) {
    const created = await backfillProject(project.chave);
    if (created > 0) {
      projectsAffected++;
      totalCreated += created;
      // eslint-disable-next-line no-console
      console.log(
        `  ✓ projeto ${project.chave} ("${project.nome}"): ${created} priorities criadas`,
      );
    }
  }

  // eslint-disable-next-line no-console
  console.log(
    `[backfill-priority-tabelas] concluído: ${totalCreated} DTabelas criadas em ${projectsAffected} projeto(s)`,
  );
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[backfill-priority-tabelas] erro:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

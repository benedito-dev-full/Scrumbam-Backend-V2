/**
 * Backfill idempotente do folder default "Projetos" para orgs existentes
 * (V2 — ADR-V2-FOLDERS-001, CEO Q5).
 *
 * Contexto:
 *   No cutover do MVP de Folders, orgs já criadas têm N projects mas zero
 *   DEntidade -155 (FOLDER). O frontend de `/workspace` espera ver pelo
 *   menos uma pasta hardcoded "Projetos". Sem esse backfill, usuários
 *   atuais veriam workspace vazio (visualização confusa) ou todos os
 *   projects no "limbo".
 *
 * Política (CEO Q5):
 *   Para cada org existente:
 *     - SE org NÃO tem nenhuma folder ativa (DEntidade -155 não excluída)
 *       E tem ≥1 project ativo (DProject -153 não excluído):
 *         - cria DEntidade idClasse=-155, nome="Projetos", idEstab=orgId
 *         - vincula TODOS os projects da org via DVincula -183
 *
 * Idempotência forte (rodar 2x não duplica):
 *   - Check inicial garante zero folders → se já há qualquer folder
 *     ativa, pula. Não recria nem dedup.
 *   - Vínculos -183 só são criados para projects que ainda NÃO têm
 *     vínculo -183 ativo (qualquer pasta).
 *
 * Uso:
 *   npx ts-node prisma/scripts/backfill-default-folders.ts [--dry-run]
 *
 * Saída: relatório em stdout com totais (orgs visitadas, folders criadas,
 * vínculos criados).
 *
 * @see ADR-V2-FOLDERS-001
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

const ID_CLASSE_ORGANIZATION = BigInt(-152);
const ID_CLASSE_FOLDER = BigInt(-155);
const ID_CLASSE_SCRUMBAN_PROJECT = BigInt(-153);
const ID_CLASSE_FOLDER_PROJECT_LINK = BigInt(-183);

const DEFAULT_FOLDER_NAME = 'Projetos';

interface BackfillReport {
  orgsVisited: number;
  orgsSkipped: number;
  foldersCreated: number;
  linksCreated: number;
}

function isDryRun(): boolean {
  return process.argv.includes('--dry-run');
}

/**
 * Aplica backfill em uma única organização. Idempotente.
 *
 * @returns relatório parcial daquela org
 */
async function backfillOrg(
  orgId: bigint,
  dryRun: boolean,
): Promise<{ skipped: boolean; folderCreated: boolean; linksCreated: number }> {
  // 1) Verifica se a org já tem alguma folder ativa
  const existingFolder = await prisma.dEntidade.findFirst({
    where: {
      idClasse: ID_CLASSE_FOLDER,
      idEstab: orgId,
      excluido: false,
    },
    select: { chave: true },
  });
  if (existingFolder) {
    return { skipped: true, folderCreated: false, linksCreated: 0 };
  }

  // 2) Verifica se a org tem projects ativos
  const projects = await prisma.dProject.findMany({
    where: {
      idClasse: ID_CLASSE_SCRUMBAN_PROJECT,
      idEstab: orgId,
      excluido: false,
    },
    select: { chave: true },
  });
  if (projects.length === 0) {
    return { skipped: true, folderCreated: false, linksCreated: 0 };
  }

  if (dryRun) {
    return {
      skipped: false,
      folderCreated: true,
      linksCreated: projects.length,
    };
  }

  // 3) Cria folder default + vincula todos os projects em transação
  let linksCreated = 0;
  await prisma.$transaction(async (tx) => {
    const folder = await tx.dEntidade.create({
      data: {
        idClasse: ID_CLASSE_FOLDER,
        nome: DEFAULT_FOLDER_NAME,
        idEstab: orgId,
      },
      select: { chave: true },
    });

    for (const project of projects) {
      // Idempotência extra: pula projects que já têm vínculo -183 ativo
      // (defensivo — não deveria acontecer dado o check do passo 1)
      const existing = await tx.dVincula.findFirst({
        where: {
          idClasse: ID_CLASSE_FOLDER_PROJECT_LINK,
          idEntidade: project.chave,
          excluido: false,
        },
        select: { chave: true },
      });
      if (existing) continue;

      await tx.dVincula.create({
        data: {
          idClasse: ID_CLASSE_FOLDER_PROJECT_LINK,
          idLocEscritu: folder.chave,
          idEntidade: project.chave,
        },
      });
      linksCreated++;
    }
  });

  return { skipped: false, folderCreated: true, linksCreated };
}

async function main(): Promise<void> {
  const dryRun = isDryRun();
  const report: BackfillReport = {
    orgsVisited: 0,
    orgsSkipped: 0,
    foldersCreated: 0,
    linksCreated: 0,
  };

  // eslint-disable-next-line no-console
  console.log(`[backfill-default-folders] início${dryRun ? ' (dry-run, sem escrita)' : ''}`);

  // 1) Lista todas as orgs ativas
  const orgs = await prisma.dEntidade.findMany({
    where: {
      idClasse: ID_CLASSE_ORGANIZATION,
      excluido: false,
    },
    select: { chave: true, nome: true },
    orderBy: { chave: 'asc' },
  });

  // eslint-disable-next-line no-console
  console.log(`[backfill-default-folders] ${orgs.length} organização(ões) ativa(s)`);

  for (const org of orgs) {
    report.orgsVisited++;
    try {
      const result = await backfillOrg(org.chave, dryRun);
      if (result.skipped) {
        report.orgsSkipped++;
      }
      if (result.folderCreated) {
        report.foldersCreated++;
      }
      report.linksCreated += result.linksCreated;

      if (result.folderCreated) {
        // eslint-disable-next-line no-console
        console.log(
          `  org ${org.chave} (${org.nome}): folder "${DEFAULT_FOLDER_NAME}" criado, ${result.linksCreated} project(s) vinculado(s)`,
        );
      }
    } catch (err) {
      console.error(`  org ${org.chave}: erro — ${(err as Error).message}`);
    }
  }

  // eslint-disable-next-line no-console
  console.log('');
  // eslint-disable-next-line no-console
  console.log(`[backfill-default-folders] resumo${dryRun ? ' (dry-run)' : ''}:`);
  // eslint-disable-next-line no-console
  console.log(`  organizações visitadas: ${report.orgsVisited}`);
  // eslint-disable-next-line no-console
  console.log(`  organizações puladas:   ${report.orgsSkipped}`);
  // eslint-disable-next-line no-console
  console.log(`  folders criadas:        ${report.foldersCreated}`);
  // eslint-disable-next-line no-console
  console.log(`  vínculos -183 criados:  ${report.linksCreated}`);
}

main()
  .catch((err) => {
    console.error('[backfill-default-folders] falha:', err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });

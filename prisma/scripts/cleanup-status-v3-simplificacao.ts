/**
 * Saneamento de tasks nos status V3 que serão removidos (simplificação
 * do fluxo de 9 → 5 status: INBOX, READY, EXECUTING, DONE, FAILED).
 *
 * ## Contexto
 * Decisão do CEO (2026-07-14): VALIDATING (-448) e VALIDATED (-449) somem
 * do fluxo — EXECUTING vai direto para DONE/FAILED. CANCELLED (-446) e
 * DISCARDED (-447) também somem — task cancelada/descartada é removida,
 * não fica "pendurada" num status.
 *
 * Este script prepara os dados ANTES da DClasse -446..-449 sair do seed
 * (prisma/seeds/classes.seed.ts). Rodar o seed novo antes deste script
 * deixaria essas tasks com `idStatus` órfão (apontando para DClasse
 * inexistente) — por isso a ordem de deploy é: 1) este script `--apply`,
 * 2) seed novo.
 *
 * ## O que o script faz
 * - VALIDATING (-448) ou VALIDATED (-449) → `idStatus = -444` (DONE).
 * - CANCELLED (-446) ou DISCARDED (-447) → soft-delete (`excluido = true`),
 *   `idStatus` mantido como estava (só auditoria — a task some das listagens
 *   porque toda query do sistema filtra `excluido:false`).
 *
 * Soft-delete (não hard-delete): preserva o registro para auditoria/rollback,
 * consistente com o padrão do sistema (nenhuma tabela usa DELETE físico).
 *
 * ## Idempotência
 * Rodar 2x não tem efeito adicional: os filtros (`idStatus IN (...)` e
 * `excluido:false`) ignoram registros já sanados.
 *
 * ## Dry-run por padrão
 * SEM `--apply`, o script só RELATA quantas tasks seriam afetadas em cada
 * grupo — ZERO escrita. Rode dry-run primeiro, revise a contagem e a lista,
 * e só então rode com `--apply`.
 *
 * ## Uso
 * ```bash
 * # DRY-RUN (padrão — não escreve nada):
 * npx ts-node prisma/scripts/cleanup-status-v3-simplificacao.ts
 *
 * # EFETIVAR (após backup):
 * npx ts-node prisma/scripts/cleanup-status-v3-simplificacao.ts --apply
 * ```
 *
 * Executado MANUALMENTE pelo CEO — NÃO é chamado em runtime.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** idStatus (DClasse) dos status que migram para DONE. */
const STATUS_PARA_DONE = [BigInt(-448), BigInt(-449)]; // VALIDATING, VALIDATED
/** idStatus (DClasse) DONE — destino da migração acima. */
const ID_STATUS_DONE = BigInt(-444);

/** idStatus (DClasse) dos status que viram soft-delete. */
const STATUS_PARA_EXCLUIR = [BigInt(-446), BigInt(-447)]; // CANCELLED, DISCARDED

/** true se o operador passou `--apply` (efetiva a escrita). */
function isApply(): boolean {
  return process.argv.includes('--apply');
}

function log(msg: string): void {
  // eslint-disable-next-line no-console
  console.log(msg);
}

async function main(): Promise<void> {
  const apply = isApply();

  log('[cleanup-status-v3-simplificacao] iniciando…');
  log(apply ? '  Modo: --apply (efetiva as escritas).' : '  Modo padrão: DRY-RUN, NADA é escrito. Use --apply para efetivar.');

  // ---- Grupo 1: VALIDATING/VALIDATED → DONE ----
  const paraDone = await prisma.dTask.findMany({
    where: { idStatus: { in: STATUS_PARA_DONE }, excluido: false },
    select: { chave: true, nome: true, idStatus: true, idProject: true },
    orderBy: { chave: 'asc' },
  });

  log(`\n[grupo VALIDATING/VALIDATED → DONE] ${paraDone.length} task(s) ativa(s) encontrada(s)`);
  for (const t of paraDone) {
    log(`  • chave=${t.chave} idStatus=${t.idStatus} idProject=${t.idProject} nome="${t.nome}"`);
  }

  // ---- Grupo 2: CANCELLED/DISCARDED → soft-delete ----
  const paraExcluir = await prisma.dTask.findMany({
    where: { idStatus: { in: STATUS_PARA_EXCLUIR }, excluido: false },
    select: { chave: true, nome: true, idStatus: true, idProject: true },
    orderBy: { chave: 'asc' },
  });

  log(`\n[grupo CANCELLED/DISCARDED → soft-delete] ${paraExcluir.length} task(s) ativa(s) encontrada(s)`);
  for (const t of paraExcluir) {
    log(`  • chave=${t.chave} idStatus=${t.idStatus} idProject=${t.idProject} nome="${t.nome}"`);
  }

  if (paraDone.length === 0 && paraExcluir.length === 0) {
    log('\n[cleanup-status-v3-simplificacao] nada a sanar — encerrando.');
    return;
  }

  if (!apply) {
    log('\n[cleanup-status-v3-simplificacao] DRY-RUN concluído. Para efetivar, rode novamente com --apply (após backup).');
    return;
  }

  const resultDone = await prisma.dTask.updateMany({
    where: { idStatus: { in: STATUS_PARA_DONE }, excluido: false },
    data: { idStatus: ID_STATUS_DONE },
  });
  log(`\n[cleanup-status-v3-simplificacao] ${resultDone.count} task(s) migrada(s) para DONE (-444).`);

  const resultExcluir = await prisma.dTask.updateMany({
    where: { idStatus: { in: STATUS_PARA_EXCLUIR }, excluido: false },
    data: { excluido: true },
  });
  log(`[cleanup-status-v3-simplificacao] ${resultExcluir.count} task(s) soft-deletada(s) (excluido=true).`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[cleanup-status-v3-simplificacao] erro:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

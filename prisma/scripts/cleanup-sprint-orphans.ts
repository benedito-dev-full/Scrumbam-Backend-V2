/**
 * Saneamento das DTabelas SPRINT (-400) órfãs (ADR-V2-060 — hard delete de Sprint).
 *
 * ## Contexto
 * Antes do ADR-V2-060, `SeedBootstrapService.seedProject()` criava uma DTabela
 * "Sprint 1" default (`idClasse=-400`, `dEntidadeId=projectId`) por projeto LIST.
 * A funcionalidade Sprint foi REMOVIDA por completo do backend V2:
 *   - DClasse -400 fora do seed (range -400..-419 liberado);
 *   - `seed-bootstrap` não cria mais "Sprint 1";
 *   - coluna `DTask.idSprint`, endpoint e módulo removidos (Fases 5-6).
 *
 * Projetos LEGADOS criados antes da remoção ainda têm a DTabela -400 órfã —
 * um lookup sem DClasse correspondente (inerte, mas sujo). Este script faz o
 * **soft-delete** (`excluido=true`) dessas DTabelas.
 *
 * ## O que o script faz
 * Marca `excluido=true` em TODAS as DTabelas com `idClasse=-400` ainda ativas
 * (`excluido=false`). Soft-delete preserva o registro para auditoria/rollback —
 * nenhuma linha é apagada fisicamente.
 *
 * ## Idempotência
 * Rodar 2x não tem efeito adicional: o filtro `excluido=false` garante que
 * registros já sanados são ignorados.
 *
 * ## Dry-run por padrão
 * SEM `--apply`, o script só RELATA quantas DTabelas -400 órfãs existem — ZERO
 * escrita. O CEO roda dry-run primeiro, revisa a contagem, e só então roda com
 * `--apply`.
 *
 * ## Uso
 * ```bash
 * # DRY-RUN (padrão — não escreve nada):
 * npx ts-node prisma/scripts/cleanup-sprint-orphans.ts
 *
 * # EFETIVAR (soft-delete real — após backup):
 * npx ts-node prisma/scripts/cleanup-sprint-orphans.ts --apply
 * ```
 *
 * Saída: relatório em stdout com a contagem de DTabelas -400 órfãs sanadas.
 * Executado MANUALMENTE pelo CEO — NÃO é chamado em runtime.
 */
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

/** idClasse da DTabela SPRINT removida (ADR-V2-060). */
const ID_CLASSE_SPRINT = BigInt(-400);

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

  log('[cleanup-sprint-orphans] iniciando…');
  log(apply ? '  Modo: --apply (efetiva soft-delete).' : '  Modo padrão: DRY-RUN, NADA é escrito. Use --apply para efetivar.');

  // Contar as DTabelas -400 ainda ativas (idempotente: ignora já sanadas).
  const orphans = await prisma.dTabela.findMany({
    where: {
      idClasse: ID_CLASSE_SPRINT,
      excluido: false,
    },
    select: { chave: true, nome: true, dEntidadeId: true },
    orderBy: { chave: 'asc' },
  });

  log(`[cleanup-sprint-orphans] ${orphans.length} DTabela(s) SPRINT (-400) órfã(s) ativa(s) encontrada(s)`);

  for (const o of orphans) {
    log(`  • chave=${o.chave} nome="${o.nome}" projeto(dEntidadeId)=${o.dEntidadeId}`);
  }

  if (orphans.length === 0) {
    log('[cleanup-sprint-orphans] nada a sanar — encerrando.');
    return;
  }

  if (!apply) {
    log('[cleanup-sprint-orphans] DRY-RUN concluído. Para efetivar, rode novamente com --apply (após backup).');
    return;
  }

  const result = await prisma.dTabela.updateMany({
    where: {
      idClasse: ID_CLASSE_SPRINT,
      excluido: false,
    },
    data: { excluido: true },
  });

  log(`[cleanup-sprint-orphans] concluído: ${result.count} DTabela(s) -400 soft-deletada(s) (excluido=true).`);
}

main()
  .catch((err) => {
    // eslint-disable-next-line no-console
    console.error('[cleanup-sprint-orphans] erro:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

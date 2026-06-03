/* eslint-disable no-console -- script de seed roda fora do NestJS; usa console direto */
/**
 * Seed de template GLOBAL — "Implementação Padrão Devari" (ADR-V2-061).
 *
 * Cria um template de LISTA global (visível a TODAS as orgs) com o processo de
 * implementação padrão da Devari: 6 blocos lineares, sem tarefas.
 *
 *   Template = DProject { idClasse: -401 TEMPLATE_LIST, idEstab: NULL (global) }
 *   Blocos   = DTask    { idClasse: -200 PHASE, idProject: <template>,
 *                         dados: { kind:'phase', ordem, cor } }
 *
 * Global = idEstab NULL → o catálogo (`GET /projects?idClasse=-401`) o expõe
 * para qualquer org; a blindagem o mantém fora das visões de trabalho. Ao usar
 * (`POST /projects/:id/from-template`), o `copyPhases` clona os blocos e o
 * `copyTasks` não copia nada (template sem tarefas) — comportamento correto.
 *
 * Idempotente: se já existir um template -401 com este `dados.slug`, não faz
 * nada. Dry-run por padrão; grava apenas com `--apply`.
 *
 * Uso:
 *   npx ts-node prisma/scripts/seed-template-implementacao-devari.ts           # dry-run
 *   npx ts-node prisma/scripts/seed-template-implementacao-devari.ts --apply   # grava
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const APPLY = process.argv.includes('--apply');

const ID_CLASSE_TEMPLATE_LIST = BigInt(-401);
const ID_CLASSE_PHASE = BigInt(-200);

/** Cabeçalho do template (categoria deve casar com o id do nível 1 da galeria). */
const TEMPLATE = {
  nome: 'Implementação Padrão Devari',
  slug: 'implementacao-padrao-devari',
  categoria: 'desenvolvimento', // deve casar com TEMPLATE_CATEGORIES[].id do front (Frontend-V2)
  prefix: 'DEV',
  description:
    'Processo de implementação padrão da Devari — toda implementação passa por estas etapas.',
};

/**
 * Blocos lineares, na ordem. Cores tiradas da paleta oficial do front
 * (`BLOCK_COLORS` em groups-view/columns.tsx).
 */
const BLOCOS: Array<{ nome: string; cor: string }> = [
  { nome: 'Planejamento', cor: '#06b6d4' }, // ciano
  { nome: 'Implementação', cor: '#22c55e' }, // verde claro
  { nome: 'Revisão', cor: '#f59e0b' }, // âmbar
  { nome: 'Teste', cor: '#f97316' }, // laranja
  { nome: 'Documentação', cor: '#7c5cff' }, // roxo
  { nome: 'Deploy', cor: '#10b981' }, // verde (mais escuro que o do Planejamento)
];

async function main(): Promise<void> {
  // Idempotência: já existe um template -401 com este slug?
  const existing = await prisma.dProject.findFirst({
    where: {
      idClasse: ID_CLASSE_TEMPLATE_LIST,
      excluido: false,
      dados: { path: ['slug'], equals: TEMPLATE.slug },
    },
    select: { chave: true },
  });

  if (existing) {
    console.log(
      `[skip] Template "${TEMPLATE.nome}" já existe (chave=${existing.chave}). Nada a fazer.`,
    );
    return;
  }

  console.log(
    `${APPLY ? '[APPLY]' : '[DRY-RUN]'} criar template GLOBAL "${TEMPLATE.nome}" ` +
      `(-401, idEstab=NULL, categoria=${TEMPLATE.categoria}) + ${BLOCOS.length} blocos:`,
  );
  BLOCOS.forEach((b, i) => console.log(`  ${i + 1}. ${b.nome.padEnd(16)} ${b.cor}`));

  if (!APPLY) {
    console.log('\nDry-run: nada foi gravado. Rode novamente com --apply para criar.');
    return;
  }

  await prisma.$transaction(async (tx) => {
    const proj = await tx.dProject.create({
      data: {
        idClasse: ID_CLASSE_TEMPLATE_LIST,
        idEstab: null, // global — visível a todas as orgs
        nome: TEMPLATE.nome,
        descricao: TEMPLATE.description,
        privado: false,
        dados: {
          slug: TEMPLATE.slug,
          prefix: TEMPLATE.prefix,
          categoria: TEMPLATE.categoria,
          description: TEMPLATE.description,
        } as Prisma.InputJsonValue,
      },
      select: { chave: true },
    });

    for (let i = 0; i < BLOCOS.length; i++) {
      const b = BLOCOS[i];
      await tx.dTask.create({
        data: {
          idClasse: ID_CLASSE_PHASE,
          idProject: proj.chave,
          nome: b.nome,
          dados: {
            kind: 'phase',
            ordem: i,
            cor: b.cor,
          } as Prisma.InputJsonValue,
        },
      });
    }

    console.log(`\n[ok] Template criado: chave=${proj.chave} com ${BLOCOS.length} blocos.`);
  });
}

main()
  .catch((e) => {
    console.error('[erro] seed do template falhou:', e);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });

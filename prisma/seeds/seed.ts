/**
 * Seed runner principal.
 *
 * Implementação completa em F1 (Schema + Seed Pilar 3).
 * Por ora, este é um placeholder que apenas valida que o seed runner
 * está configurado corretamente.
 *
 * Em F1, este arquivo:
 *   1. Importa `classesFixas` de `templates/classes-base-template.ts`
 *   2. Importa `classesEspecificas` (~70 classes Scrumban) de `classes.seed.ts`
 *   3. Faz upsert idempotente em DClasse
 *   4. Valida hierarquia idPai (todos apontam para chave existente)
 *   5. Valida total esperado (~120 classes)
 *
 * @see docs/plano/01-FUNDACAO.md (F1)
 * @see templates/classes-base-template.ts
 */

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main(): Promise<void> {
  console.warn('[seed] Placeholder F0 — implementação completa em F1.');
  console.warn('[seed] Seed real virá em F1 com classesFixas + classesEspecificas.');

  // Smoke test: verificar conexão
  const count = await prisma.dClasse.count().catch(() => -1);
  if (count === -1) {
    console.warn('[seed] Aviso: tabela DClasse ainda não existe. Rodar `make migrate` primeiro.');
  } else {
    console.warn(`[seed] DClasse tem ${count} registros (esperado em F1: ~120).`);
  }
}

main()
  .catch((err) => {
    console.error('[seed] Erro:', err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

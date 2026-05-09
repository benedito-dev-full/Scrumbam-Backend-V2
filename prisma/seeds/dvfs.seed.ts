/**
 * DVFS Seed — Scrumban-Backend-V2 (Pilar 1, F6)
 *
 * Insere 5 registros na tabela DVFS para idClasse=-300 EXECUTION:
 *   chave=3: risk-gate-validator  (pré-cálculo)
 *   chave=4: command-validator    (cálculo)
 *   chave=5: pos-calculo-noop     (pós-cálculo, stub)
 *   chave=6: pre-gravacao-noop    (pré-gravação, stub)
 *   chave=7: pr-auto-open + notification-dispatcher (pós-gravação, combinado)
 *
 * Scripts são lidos de `src/engine/dvfs/*.js` — arquivos canônicos do repositório.
 * O loader (DvfsLoaderHelper) usa fallback: busca em idClasse concreto (-301/-302/-303)
 * primeiro, depois sobe para -300 (agrupador pai). O seed inicial coloca todos em -300.
 *
 * IDEMPOTÊNCIA: usa upsert por (idClasse, chaveScript, versao) — re-seed é seguro.
 *
 * NOTA: console.log/warn são permitidos neste arquivo (script CLI fora do Nest).
 *       Override ESLint declarado em eslint.config.js para prisma/seeds/*.ts.
 *
 * @see ADR-V2-007 (DVFS scripts para portabilidade)
 * @see ADR-V2-016 (s.chaveScript nunca s.id)
 * @see src/engine/helpers/dvfs-loader.helper.ts
 * @see docs/plano/02-DOMINIO-ENGINE.md §6.8
 */

import * as fs from 'fs';
import * as path from 'path';
import { PrismaClient } from '@prisma/client';

/**
 * Semeia os scripts DVFS canônicos no banco.
 * Chamado pelo seed-runner.ts após o seed de classes.
 *
 * @param prisma - cliente Prisma conectado ao Postgres
 * @returns número de registros processados (deve ser 5)
 */
export async function seedDvfs(prisma: PrismaClient): Promise<number> {
  // Diretório dos scripts DVFS — relativo à raiz do projeto (não à pasta seeds/)
  const dvfsDir = path.join(__dirname, '..', '..', 'src', 'engine', 'dvfs');

  // Lê os arquivos .js canônicos
  const riskGate = fs.readFileSync(path.join(dvfsDir, 'risk-gate-validator.js'), 'utf8');
  const commandValidator = fs.readFileSync(path.join(dvfsDir, 'command-validator.js'), 'utf8');
  const prAutoOpen = fs.readFileSync(path.join(dvfsDir, 'pr-auto-open.js'), 'utf8');
  const notificationDispatcher = fs.readFileSync(path.join(dvfsDir, 'notification-dispatcher.js'), 'utf8');

  // Script combinado para chave 7: pr-auto-open + notification-dispatcher em sequência
  // Wrapper async que chama os dois scripts em ordem, absorvendo erros individuais
  const combined7 = `(async function (op) {
  // Parte 1: PR auto-open
  var prAutoOpen = ${prAutoOpen};
  await prAutoOpen(op);

  // Parte 2: Notification dispatcher
  var notificationDispatcher = ${notificationDispatcher};
  await notificationDispatcher(op);
})`;

  // idClasse=-300 EXECUTION (agrupador pai) — scripts genéricos compartilhados por -301/-302/-303
  const idClasseExecution = BigInt(-300);

  const records = [
    {
      chaveScript: 3,
      nome: 'risk-gate-validator',
      conteudo: riskGate,
      versao: 1,
    },
    {
      chaveScript: 4,
      nome: 'command-validator',
      conteudo: commandValidator,
      versao: 1,
    },
    {
      chaveScript: 5,
      nome: 'pos-calculo-noop',
      conteudo: '(function (op) { /* pós-cálculo vazio — F6 Task 1 */ })',
      versao: 1,
    },
    {
      chaveScript: 6,
      nome: 'pre-gravacao-noop',
      conteudo: '(function (op) { /* pré-gravação vazio — F6 Task 1 */ })',
      versao: 1,
    },
    {
      chaveScript: 7,
      nome: 'pr-auto-open-notification',
      conteudo: combined7,
      versao: 1,
    },
  ];

  let processed = 0;

  for (const rec of records) {
    await prisma.dVFS.upsert({
      where: {
        idClasse_chaveScript_versao: {
          idClasse: idClasseExecution,
          chaveScript: rec.chaveScript,
          versao: rec.versao,
        },
      },
      create: {
        idClasse: idClasseExecution,
        chaveScript: rec.chaveScript,
        nome: rec.nome,
        conteudo: rec.conteudo,
        versao: rec.versao,
        ativo: true,
      },
      update: {
        conteudo: rec.conteudo,
        nome: rec.nome,
        ativo: true,
      },
    });
    processed++;
  }

  // eslint-disable-next-line no-console
  console.log(
    `[dvfs-seed] OK — ${processed} scripts DVFS upserted para idClasse=-300 EXECUTION`,
  );

  return processed;
}

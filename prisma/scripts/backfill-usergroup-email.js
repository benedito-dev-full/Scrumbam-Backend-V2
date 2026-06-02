// Backfill DUserGroup.email a partir de DUserGroup.usuario — Scrumban-Backend-V2
// Contexto: auth.service e invites.service salvavam o email apenas em `usuario`
// (login), deixando a coluna `email` null. Este script copia usuario->email
// nos registros antigos onde email IS NULL e usuario parece um email.
//
// READ-ONLY por padrao (dry-run). Para aplicar de verdade, passe --apply:
//   node prisma/scripts/backfill-usergroup-email.js          (dry-run)
//   node prisma/scripts/backfill-usergroup-email.js --apply  (executa)
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const APPLY = process.argv.includes('--apply');
const s = (v) => (typeof v === 'bigint' ? v.toString() : v);
const isEmail = (u) => typeof u === 'string' && /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(u);

(async () => {
  try {
    const alvos = await p.dUserGroup.findMany({
      where: { email: null },
      select: { chave: true, usuario: true, nome: true },
    });

    const aplicaveis = alvos.filter((u) => isEmail(u.usuario));
    const ignorados = alvos.filter((u) => !isEmail(u.usuario));

    console.log('DUserGroup com email NULL: ' + alvos.length);
    console.log('  -> usuario e email valido (sera backfilled): ' + aplicaveis.length);
    console.log('  -> usuario NAO e email (ignorado): ' + ignorados.length);
    aplicaveis.forEach((u) => console.log('     [' + s(u.chave) + '] ' + u.usuario + ' (' + u.nome + ')'));
    if (ignorados.length) {
      console.log('  IGNORADOS:');
      ignorados.forEach((u) => console.log('     [' + s(u.chave) + '] usuario=' + u.usuario));
    }

    if (!APPLY) {
      console.log('\nDRY-RUN (nada alterado). Rode com --apply para executar.');
      return;
    }

    let ok = 0;
    await p.$transaction(async (tx) => {
      for (const u of aplicaveis) {
        await tx.dUserGroup.update({ where: { chave: u.chave }, data: { email: u.usuario } });
        ok++;
      }
    });
    console.log('\nAPLICADO: ' + ok + ' registros atualizados.');
  } catch (e) {
    console.error('FALHOU (rollback automatico se em transacao):', e.message);
    process.exitCode = 1;
  } finally {
    await p.$disconnect();
  }
})();

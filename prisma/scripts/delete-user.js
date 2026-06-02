// Hard delete de usuário (anonimizando histórico) — Scrumban-Backend-V2
// Uso:  node prisma/scripts/delete-user.js <email>
// Ex.:  node prisma/scripts/delete-user.js beneditobittencourtt@gmail.com
//
// O que faz (tudo em $transaction — rollback automático se algo falhar):
//   1. Acha o DUserGroup pelo email (login) e a DEntidade-pessoa ligada.
//   2. GUARD: aborta se a entidade for usada como conta/depósito (DMovDispo/DMovDepos).
//   3. Anonimiza histórico (solta ponteiros → NULL): tasks, eventos, pedidos, títulos, tabelas.
//   4. Apaga DVincula do usuário, DPermissao do grupo, a DEntidade-pessoa e o DUserGroup.
require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const p = new PrismaClient();

const EMAIL = process.argv[2];
const s = (v) => (typeof v === 'bigint' ? v.toString() : v);

(async () => {
  if (!EMAIL) {
    console.error('Uso: node prisma/scripts/delete-user.js <email>');
    process.exitCode = 1;
    return;
  }
  try {
    const r = await p.$transaction(async (tx) => {
      const ug = await tx.dUserGroup.findFirst({ where: { email: EMAIL } });
      if (!ug) throw new Error('DUserGroup nao encontrado para email ' + EMAIL);

      const ent = await tx.dEntidade.findFirst({ where: { dUserGroupId: ug.chave } });
      const eid = ent ? ent.chave : null;

      if (eid) {
        const movD = await tx.dMovDispo.count({ where: { idDisponivel: eid } });
        const movE = await tx.dMovDepos.count({ where: { idDeposito: eid } });
        if (movD > 0 || movE > 0) {
          throw new Error(
            'ABORTADO: entidade ' + eid + ' e referenciada como conta/deposito em ' +
            'DMovDispo(' + movD + ')/DMovDepos(' + movE + '). Nao e usuario comum.'
          );
        }
      }

      const out = { userGroup: s(ug.chave), entidade: s(eid) };

      if (eid) {
        out.tasksAssignee = (await tx.dTask.updateMany({ where: { idAssignee: eid }, data: { idAssignee: null } })).count;
        out.tasksCreator  = (await tx.dTask.updateMany({ where: { idCreator: eid },  data: { idCreator: null } })).count;
        out.eventos       = (await tx.dEvento.updateMany({ where: { idEntidade: eid }, data: { idEntidade: null } })).count;
        out.pedidosPessoa = (await tx.dPedido.updateMany({ where: { idPessoa: eid }, data: { idPessoa: null } })).count;
        out.pedidosLocEsc = (await tx.dPedido.updateMany({ where: { idLocEscritu: eid }, data: { idLocEscritu: null } })).count;
        out.titulos       = (await tx.dTitulo.updateMany({ where: { idPessoa: eid }, data: { idPessoa: null } })).count;
        out.tabelas       = (await tx.dTabela.updateMany({ where: { dEntidadeId: eid }, data: { dEntidadeId: null } })).count;
        out.vinculos      = (await tx.dVincula.deleteMany({ where: { OR: [{ idLocEscritu: eid }, { idEntidade: eid }] } })).count;
      }

      out.permissoes = (await tx.dPermissao.deleteMany({ where: { dUserGroupId: ug.chave } })).count;
      if (eid) out.entidadeDeletada = (await tx.dEntidade.deleteMany({ where: { chave: eid } })).count;
      out.userGroupDeletado = (await tx.dUserGroup.deleteMany({ where: { chave: ug.chave } })).count;

      return out;
    });

    console.log('OK — usuario removido:');
    console.log(JSON.stringify(r, (k, v) => s(v), 2));
  } catch (e) {
    console.error('FALHOU (rollback automatico):', e.message);
    process.exitCode = 1;
  } finally {
    await p.$disconnect();
  }
})();

// notification-dispatcher.js — DVFS chave=7 (pós-gravação, parte 2)
// Cria DEvento idClasse=-490 NOTIFICATION para owner do projeto + criador da task.
//
// Recebe `op` (instância OperacaoExecucaoClaude) como contexto.
// Usa op._database diretamente (antes do F7 EventProducer existir).
// NÃO lança Error — absorve falhas de banco silenciosamente (notificação é best-effort).
//
// Executado APÓS INSERT em DPedido (pós-gravação) e APÓS pr-auto-open.
async function notificationDispatcher(op) {
  if (!op || !op._database) {
    return; // Sem banco disponível
  }

  var recipients = new Set();

  // Adicionar owner do projeto como destinatário
  try {
    var project = await op._database.dProject.findFirst({
      where: { chave: op.projectId },
      select: { idOwner: true, nome: true },
    });

    if (project && project.idOwner) {
      recipients.add(project.idOwner);
    }
  } catch (err) {
    // Absorve erro de banco — notificação é best-effort
  }

  // Adicionar criador da task como destinatário (se execution vinculada a task)
  if (op.taskId) {
    try {
      var task = await op._database.dTask.findFirst({
        where: { chave: op.taskId },
        select: { criadoPor: true },
      });

      if (task && task.criadoPor) {
        recipients.add(task.criadoPor);
      }
    } catch (err) {
      // Absorve erro de banco
    }
  }

  // Criar DEvento idClasse=-490 NOTIFICATION para cada destinatário
  var riskLevel = (op.dados && op.dados.risk && op.dados.risk.level) ? op.dados.risk.level : 'LOW';
  var approvalStatus = (op.dados && op.dados.approval && op.dados.approval.status) ? op.dados.approval.status : 'started';
  var correlationId = (op.dados && op.dados.audit && op.dados.audit.correlationId) ? op.dados.audit.correlationId : '';
  var prUrl = (op.dados && op.dados.pullRequest && op.dados.pullRequest.url) ? op.dados.pullRequest.url : null;

  for (var recipientId of recipients) {
    try {
      await op._database.dEvento.create({
        data: {
          idClasse: BigInt(-490), // NOTIFICATION
          idEntidade: recipientId,
          identificadorExterno: correlationId,
          descricao: 'Execution #' + op.chcriacao + ' ' + approvalStatus + ' (' + riskLevel + ')',
          metaDados: {
            executionId: op.chcriacao.toString(),
            projectId: op.projectId ? op.projectId.toString() : null,
            riskLevel: riskLevel,
            status: approvalStatus,
            prUrl: prUrl,
          },
        },
      });
    } catch (err) {
      // Absorve erro por destinatário — tenta próximo
    }
  }
}

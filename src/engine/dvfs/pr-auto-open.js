// pr-auto-open.js — DVFS chave=7 (pós-gravação, parte 1)
// Abre PR automaticamente no GitHub após execução bem-sucedida com mudanças git.
//
// Recebe `op` (instância OperacaoExecucaoClaude) como contexto.
// NÃO lança Error — absorve falhas em fallback (URL genérica de "create PR").
// Popula op.dados.pullRequest = { url, number?, openedAt }.
//
// Executado APÓS INSERT em DPedido (pós-gravação).
// Só age se op.dados.git.headAfter !== op.dados.git.headBefore (houve mudança).
async function prAutoOpen(op) {
  if (!op.dados || !op.dados.git || !op.dados.git.headAfter) {
    return; // Nada a fazer — não houve mudança no repo
  }

  if (op.dados.git.headAfter === op.dados.git.headBefore) {
    return; // Commit igual — sem diff, sem PR
  }

  // githubClient pode estar em op.githubClient (propriedade protegida)
  // Tenta ambos os paths para compatibilidade com mocks de teste
  var githubClient = op.githubClient || op._githubClient;

  if (!githubClient) {
    return; // Sem cliente GitHub configurado — pula PR silenciosamente
  }

  // Carrega config do projeto para obter remoteRepoUrl e remoteBranch
  var project = null;
  try {
    project = await op._database.dProject.findFirst({
      where: { chave: op.projectId },
      select: { dados: true, nome: true },
    });
  } catch (err) {
    return; // Banco indisponível — absorve
  }

  var repoUrl = project && project.dados && project.dados.automation && project.dados.automation.remoteRepoUrl
    ? project.dados.automation.remoteRepoUrl
    : null;

  if (!repoUrl) {
    return; // Projeto sem remoteRepoUrl configurado
  }

  // Parse owner/repo de "git@github.com:owner/repo.git" ou "https://github.com/owner/repo"
  var match = /github\.com[:/]([^/]+)\/(.+?)(?:\.git)?$/.exec(repoUrl);
  if (!match) {
    return; // URL não reconhecida como GitHub
  }

  var owner = match[1];
  var repo = match[2];
  var baseBranch = (project.dados && project.dados.automation && project.dados.automation.remoteBranch)
    ? project.dados.automation.remoteBranch
    : 'main';

  var commandText = (op.dados.command && op.dados.command.text) ? op.dados.command.text : '';
  var correlationId = (op.dados.audit && op.dados.audit.correlationId) ? op.dados.audit.correlationId : '';
  var filesChanged = (op.dados.git && op.dados.git.filesChanged) ? op.dados.git.filesChanged : 0;
  var branch = (op.dados.git && op.dados.git.branch) ? op.dados.git.branch : ('scrumban/auto-' + op.chcriacao);

  try {
    var pr = await githubClient.pulls.create({
      owner: owner,
      repo: repo,
      head: branch,
      base: baseBranch,
      title: '[scrumban] Execution #' + op.chcriacao + ': ' + commandText.slice(0, 60),
      body: 'Automated execution via Scrumban V2.\n\nCommand:\n```\n' + commandText + '\n```\n\nFiles changed: ' + filesChanged + '\nCorrelation: ' + correlationId,
    });

    op.dados.pullRequest = {
      url: pr.data.html_url,
      number: pr.data.number,
      openedAt: new Date().toISOString(),
    };
  } catch (err) {
    // Fallback: gera URL genérica de "create PR" se GitHub API falhar
    op.dados.pullRequest = {
      url: 'https://github.com/' + owner + '/' + repo + '/pull/new/' + branch,
      openedAt: new Date().toISOString(),
    };
  }
}

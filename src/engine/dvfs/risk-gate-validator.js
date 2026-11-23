// risk-gate-validator.js — DVFS chave=3 (pré-cálculo)
// Classifica o risco da execução em LOW, MEDIUM ou HIGH.
//
// validatorVersion: 2 (ADR-V2-081 — Risk Gate avalia o prompt no modo PROMPT)
//
// v1 (F6 Task 2): 40 padrões shell/SQL (25 HIGH + 15 MEDIUM) aplicados SÓ a
//     `op.dados.command.text`. No modo PROMPT (ADR-V2-049) o command.text é o
//     placeholder `claude -p task-built-prompt-placeholder` → toda execução
//     por task caía em LOW (Risk Gate cego).
// v2: varre DUAS fontes — `command` (dados.command.text) e `prompt`
//     (dados.prompt, o texto que o Claude de fato recebe):
//       1. Padrões shell/SQL legados (intactos) sobre o texto bruto de cada fonte.
//       2. Padrões de linguagem natural PT-BR/EN sobre o texto NORMALIZADO
//          (lowercase + remoção de acentos via NFD) — `\b` em JS não trata
//          "ç/ã" como letra, por isso a normalização vem antes.
//     Janelas de proximidade SEMPRE limitadas (`[^.\n]{0,N}`) — proibido `.*`
//     novo (ReDoS / falso positivo).
//
// v2.1 (ciclo 2 pós-review, ainda validatorVersion 2 — contrato inalterado):
//   - M1: normalização anti-bypass Unicode. Antes de QUALQUER padrão o texto
//     passa por NFKC (fullwidth "ａｐａｇｕｅ" → "apague") e remoção de
//     invisíveis (soft hyphen U+00AD, zero-width U+200B-U+200F, U+2060, U+FEFF).
//     Os padrões shell/SQL rodam sobre esse texto "limpo" (ASCII comum fica
//     idêntico → 58 adversariais intactos); os NL rodam sobre limpo + lowercase
//     + NFD sem diacríticos. Só escapes \uXXXX no arquivo (independe de encoding
//     do seed).
//   - M2: padrões extras para falsos negativos simples (diretório inteiro,
//     esvaziar banco/base, "remova os usuários", senha/conta de admin, variáveis
//     de ambiente, prompt-injection, shell: curl|bash, sudo su, chmod 777,
//     rm -r -f, find / -delete, flushall, dropDatabase). Critério de nível:
//     HIGH = perda irreversível / segurança / produção / execução remota;
//     MEDIUM = operação de infra ou release ambígua (deploy, desligar/reiniciar
//     servidor, sudo simples, find -delete local) — ambos exigem aprovação.
//
// v2.2 (ciclo 3): B1 quebra de linha simples e ponto+minúscula não separam
//   verbo/objeto; B2 invisíveis via \p{Cf} (classe aberta) + fillers Hangul;
//   lacunas: shutdown/reboot EN (MEDIUM), ssh root@ e escrita em /etc (HIGH),
//   ler secrets (HIGH), frase elíptica "… . A tabela X também" (HIGH).
//   Limites conhecidos (fora do regex, ver ADR-V2-081): homóglifos cirílicos,
//   letras espaçadas ("a p a g u e"), pontuação intra-palavra ("b.a.n.c.o", "ta-bela").
//
// Contrato de saída (lido por OperacaoExecucaoClaude.calcula()):
//   op.dados.risk = {
//     level, explanation,
//     matchedPatterns: [{ pattern, level, source }],   // NUNCA o trecho casado (R8)
//     scannedSources: ['command', 'prompt'],           // guarda de contrato do Engine
//     validatorVersion: 2,
//     classifiedAt,
//   }
// O Engine eleva para no mínimo MEDIUM quando há dados.prompt e o script não
// declara 'prompt' em scannedSources (drift DVFS banco × arquivo).
//
// Fail-open para LOW apenas quando NADA casa (nunca erro, nunca throw).
// Falsos positivos aceitos (fail-safe): negação ("NÃO apague a tabela") e
// menção informativa a produção sobem para HIGH — ver ADR-V2-081.
//
// ADR-V2-006: risco via idClasse (-301/-302/-303), não campo — este script
// apenas classifica. OperacaoExecucaoClaude.calcula() define _classeBase conforme risk.level.
// Sem require/dependências: roda via eval no Engine (DVFS, ADR-V2-007).
async function riskGateValidator(op) {
  var d = (op && op.dados) || {};
  var sources = [
    { source: 'command', text: d.command && typeof d.command.text === 'string' ? d.command.text : '' },
    { source: 'prompt', text: typeof d.prompt === 'string' ? d.prompt : '' },
  ];

  // M1/B2 (ciclos 2-3): remove TODO caractere Unicode de formatação (\p{Cf}:
  // soft hyphen, zero-width *, word joiner, invisible times/plus, Mongolian
  // vowel separator, Arabic letter mark, BOM, tag chars, bidi…) + fillers Hangul
  // (U+115F, U+1160, U+3164, U+FFA0, que são letras 'Lo' e não Cf). Classe
  // aberta em vez de lista fechada. Requer flag `u` (ES2018 — Node 20 no eval
  // do Engine; se o eval falhasse, o Engine falha fechado: 'DVFS chave 3 não carregado').
  var INVISIBLE_RE = /[\p{Cf}\u115F\u1160\u3164\uFFA0]/gu;
  // Texto "limpo": sem invisíveis + NFKC (fullwidth, ligaduras) + sem invisíveis
  // de novo (NFKC pode mapear U+3164/U+FFA0 para U+1160).
  function clean(s) {
    return s.replace(INVISIBLE_RE, '').normalize('NFKC').replace(INVISIBLE_RE, '');
  }
  // B1 (ciclo 3): quebra de linha SIMPLES vira espaço antes das janelas de
  // proximidade (soft-wrap de markdown não pode separar verbo e objeto).
  // Parágrafo (linha em branco) e item de lista (-, *, \u2022, 1. / 1)) continuam
  // barreira. Lookahead com [ \t]{0,64} limitado (sem \s* — evita O(n^2) em
  // "a\n \n \n…").
  var SOFT_NEWLINE_RE = /([^\r\n])\r?\n(?![ \t]{0,64}([-*\u2022]|\d+[.)]|\r?\n))/g;
  // B1 (ciclo 3): ponto seguido de minúscula não é fim de frase ("apague. a
  // tabela") — vira espaço. Ponto + MAIÚSCULA continua barreira ("Remova o
  // import. A tabela de preços está ok" segue LOW). Precisa rodar ANTES do
  // lowercase.
  var LOWER_CONTINUATION_RE = /\.[ \t]+(?=\p{Ll})/gu;
  // Texto normalizado para padrões NL: limpo + lowercase + sem diacríticos.
  function norm(s) {
    return clean(s)
      .replace(SOFT_NEWLINE_RE, '$1 ')
      .replace(LOWER_CONTINUATION_RE, ' ')
      .toLowerCase()
      .normalize('NFD').replace(/[\u0300-\u036F]/g, '');
  }

  // ================================================================
  // HIGH (shell/SQL — texto bruto): perda irreversível de dados ou
  // comprometimento de segurança (25 patterns — v1, intactos).
  // ================================================================
  const HIGH_PATTERNS = [
    // --- Filesystem destrutivo ---
    /rm\s+-rf/i,                             // destruição recursiva de filesystem
    /rmdir\s+\/s/i,                          // Windows rmdir /s (equivalente ao rm -rf)
    /del\s+\/[sf]/i,                         // Windows del /s /f (forçado recursivo)
    /\bshred\b/i,                            // sobrescreve arquivo antes de deletar
    /\bwipe\b/i,                             // wipe de disco
    /dd\s+if=/i,                             // disk dump/write (sobrescreve disco)

    // --- DDL destrutivo (banco de dados) ---
    /DROP\s+(TABLE|DATABASE|SCHEMA|INDEX|VIEW)/i,    // DDL destrutivo
    /DELETE\s+FROM\s+\w+\s*(;?\s*$|WHERE\s+1\s*=\s*1)/i, // DELETE sem WHERE real (ou WHERE 1=1)
    /TRUNCATE\s+(TABLE\s+)?\w+/i,                    // truncar tabela (perda total)
    /ALTER\s+TABLE\s+\w+\s+DROP\s+(COLUMN|CONSTRAINT)/i, // remoção de coluna/constraint

    // --- Git destrutivo ---
    /git\s+push\s+--force(?!-with-lease)/i,  // force push (reescreve histórico remoto)
    /git\s+filter-branch/i,                  // reescrita de histórico
    /git\s+filter-repo/i,                    // reescrita de histórico (ferramenta moderna)
    /\bBFG\b/i,                              // BFG Repo Cleaner (reescrita de histórico)

    // --- Segurança / credenciais ---
    /\.env\b/i,                              // acesso a arquivo .env
    /private[_\-]?key/i,                     // private key de qualquer tipo
    /id_rsa\b/i,                             // chave SSH RSA
    /\bsecret[_\-]?(key|token|access)/i,     // secret key/token/access
    /\baws[_\-]?(access|secret)[_\-]?key/i,  // credenciais AWS
    /\bcredentials?\b/i,                     // arquivo de credenciais

    // --- Produção / infra ---
    /\bproduction\b/i,                       // qualquer menção a production
    /\bprod\b(?!\w)/i,                       // prod como palavra isolada
    /systemctl\s+(stop|disable|kill)/i,      // parar serviços do sistema
    /kill\s+-9/i,                            // kill forçado de processo
    /format\s+[a-z]:|mkfs/i,                // formatação de volume
  ];

  // ================================================================
  // HIGH (linguagem natural PT-BR/EN — texto normalizado, sem acento).
  // Exigem verbo destrutivo + objeto crítico em janela curta: verbo sozinho
  // ("remover import não usado") NÃO basta.
  // ================================================================
  const NL_HIGH_PATTERNS = [
    // Destruir banco/tabela/schema ("apague a tabela de clientes", "zere o banco")
    /\b(apag|delet|exclu|remov|dropa|drop|destru|zer|limp|trunc|esvazi|elimin)\w*\b[^.\n]{0,40}\b(banco( de dados)?|database|base de dados|base inteir\w*|toda a base|tabelas?|schema|collection)\b/,
    // Apagar dados em massa ("apagar todos os registros", "remova todos os usuários")
    /\b(apag|delet|exclu|remov)\w*\b[^.\n]{0,20}\b(todos|todas|todo|toda|tudo)\b[^.\n]{0,30}\b(registros|dados|usuarios|clientes|arquivos|linhas)\b/,
    // (ciclo 2) Apagar dados em massa com artigo definido ("Remova os usuários",
    // "Elimine os registros de pagamentos"). Singular ("remover usuário
    // duplicado") NÃO casa. "dados"/"arquivos" ficam fora (seed/mocks comuns).
    /\b(apag|delet|exclu|remov|elimin|esvazi)\w*\s+(os|as)\s+(usuarios|clientes|registros|contas|pedidos|pagamentos|transacoes)\b/,
    // (ciclo 2) Diretório/pasta inteira ou raiz ("Apague o diretório inteiro")
    /\b(apag|delet|exclu|remov|limp|esvazi|elimin|destru)\w*\b[^.\n]{0,20}\b(diretorio|pasta|directory|folder)s?\b[^.\n]{0,15}\b(inteir\w*|raiz|root|tod[oa])\b/,
    /\b(apag|delet|exclu|remov|limp|esvazi|elimin|destru)\w*\b[^.\n]{0,10}\b(tod[oa]|inteir\w*)\b[^.\n]{0,10}\b(diretorio|pasta)\b/,
    // Force push / reescrever histórico ("force push na main", "push forçado")
    /\bforce[\s-]?push\b|\bpush\b[^.\n]{0,20}(--force(?![-\w])|\s-f\b|forcad)|\breescrev\w*\b[^.\n]{0,20}\bhistorico\b/,
    // Apagar repositório / branch principal ("delete a branch main", "exclua o repositório")
    /\b(apag|delet|exclu|remov)\w*\b[^.\n]{0,25}\b(repositorio|repo|branch (main|master)|a (main|master))\b/,
    // Produção PT ("rode no banco de produção", "deploy em produção")
    /\b(em|na|no|de|da|do|para) (ambiente de )?producao\b/,
    // (ciclo 2) "prd" — mesma semântica do legado `\bprod\b` (HIGH)
    /\bprd\b/,
    // Segredos PT (credenciais / chaves / tokens — menção direta)
    /\b(chaves? privadas?|chaves? (de api|secretas?)|tokens? de acesso|credenciais|segredos?)\b/,
    // Senhas: só com verbo de exposição/manipulação em massa (evita HIGH em
    // toda feature de "recuperação de senha" — ver desvio documentado)
    /\b(mostr|exib|imprim|expo|commit|vaz|envi|copi|list|revel|dump|export|loga|logue)\w*\b[^.\n]{0,30}\bsenhas?\b/,
    // (ciclo 2) Senha/usuário/conta privilegiada ("Altere a senha do admin",
    // "crie um usuário admin com senha 123"). Sem admin/root = LOW
    // ("tela para o usuário alterar a própria senha").
    /\b(alter|troc|mud|cri|redefin|reset|defin|adicion)\w*\b[^.\n]{0,25}\b(senhas?|usuarios?|contas?|credenciais|acessos?)\b[^.\n]{0,15}\b(admin\w*|root|superusuario|sudoer\w*)\b/,
    // (ciclo 2) Dump de variáveis de ambiente / segredos estilo env
    // ("imprima as variáveis de ambiente", "print env vars", "mande o JWT_SECRET").
    // Variável singular não-secreta ("mostrar NODE_ENV no rodapé") = LOW.
    /\b(imprim|mostr|print|dump|exib|leia|ler|list|envi|mand|export|revel|logu?e|cat)\w*\b[^.\n]{0,25}(\bvariaveis de ambiente\b|\benv vars?\b|\benvironment variables\b|\bprocess\.env\b|\bprintenv\b)/,
    /\b(imprim|mostr|print|dump|exib|envi|mand|export|revel|vaz|cole|upload)\w*\b[^.\n]{0,25}\b[a-z0-9]+_(secret|key|token|password|senha)\w*\b/,
    /\b(revel|vaz|export|upload|mand|cole|dump|leak|send|post)\w*\b[^.\n]{0,25}\b(tokens?|secrets?|segredos?|chaves? (de api|secretas?|privadas?))\b/,
    // (ciclo 3) Ler/acessar secrets/credenciais ("Leia os secrets do vault")
    /\b(lei|ler|read|cat|acess|extra|obtenh|peg|busq|list|access|fetch|get)\w*\b[^.\n]{0,25}\b(secrets|segredos?|credenciais|credentials)\b/,
    // (ciclo 3) Frase elíptica após ponto ("Apague os logs. A tabela de clientes também.")
    /\b(apag|delet|exclu|remov|limp|esvazi|elimin|zer|destru|drop)\w*\b[^\n]{0,80}\.[ \t]*(o|a|os|as) (banco|base|tabelas?|schema|collection|registros|usuarios|clientes)\b[^.\n]{0,40}\b(tambem|too|also)\b/,
    // (ciclo 2) Prompt-injection clássico ("Ignore as instruções anteriores…")
    /\b(ignor|desconsider|esquec)\w*\b[^.\n]{0,20}\b(instruc\w*|regras|orientac\w*|diretrizes)\b[^.\n]{0,15}\b(anterior\w*|acima|previas|do sistema)\b/,
    /\b(ignore|disregard|forget)\b[^.\n]{0,20}\b(previous|prior|above|all|system)\b[^.\n]{0,15}\b(instructions|rules|prompts?)\b/,
    // (ciclo 2) Baixar-e-executar / payload ofuscado
    /\b(baix|download)\w*\b[^.\n]{0,30}\b(execut|rod)\w*\b[^.\n]{0,20}\b(script|binario|instalador|payload)\b/,
    /\bbase64\b[^.\n]{0,40}\b(execut|rod|eval|run)\w*/,
    // Desligar segurança ("desative a autenticação", "remova o guard")
    /\b(desativ|desabilit|remov|deslig|burl)\w*\b[^.\n]{0,30}\b(autenticacao|2fa|mfa|firewall|rbac|permissoes|guards?)\b/,
    // (ciclo 2) sem "remov" para login/csrf/ssl (evita "remover botão de login duplicado")
    /\b(desativ|desabilit|deslig|burl|bypass)\w*\b[^.\n]{0,30}\b(login|csrf|ssl|tls|https|verificacao de (email|assinatura|token))\b/,
    // EN NL ("wipe the database", "drop the users table", "delete all records")
    /\b(delete|drop|wipe|erase|nuke|destroy)\b[^.\n]{0,30}\b(database|db|tables?|all (records|users|data|rows))\b/,
  ];

  // ================================================================
  // MEDIUM (shell/SQL — texto bruto): risco moderado (15 patterns — v1, intactos).
  // ================================================================
  const MEDIUM_PATTERNS = [
    // --- Migrations e schema ---
    /prisma\s+migrate\s+(reset|dev)/i,       // reset ou migration interativa
    /prisma\s+db\s+(push|reset)/i,           // push/reset direto no banco
    /\bschema\b.*\b(change|alter|modify)\b/i, // menção a alteração de schema

    // --- DDL moderado (sem DROP) ---
    /\bALTER\s+TABLE\b/i,                    // ALTER TABLE (sem DROP — ainda arriscado)

    // --- Dependências ---
    /\bnpm\s+(install|i)\s+/i,               // npm install de dependência
    /\byarn\s+(add|upgrade)\b/i,             // yarn add/upgrade
    /\bpackage\.json\b/i,                    // modificação de package.json

    // --- Configuração ---
    /\bconfig\b.*\b(update|change|modify)\b/i, // config update/change
    /\bdocker[-\s]compose\b/i,               // docker-compose (pode recriar containers)
    /\bkubectl\s+(apply|delete)\b/i,         // kubectl apply/delete

    // --- Git moderado ---
    /git\s+reset\s+--hard/i,                 // perda de estado local
    /git\s+clean\s+-fd/i,                    // limpeza forçada do worktree

    // --- Migrations ---
    /\bmigration\b/i,                        // qualquer menção a migration

    // --- Refactoring extenso ---
    /\brefactor\b/i,                         // refactoring (pode ser extenso)
    /\brebuild\b/i,                          // rebuild (pode invalidar estado)
  ];

  // ================================================================
  // (ciclo 2) Shell/SQL extras — lacunas dos 40 legados. Arrays separados para
  // manter a lista legada auditável. Rodam sobre o texto limpo (NFKC).
  // ================================================================
  const SHELL_HIGH_EXTRA = [
    /\b(curl|wget)\b[^|\n]{0,200}\|\s*(sudo\s+)?(ba|z|da|k)?sh\b/i,   // download | shell (execução remota)
    /\bsudo\s+(su|-i|-s|bash|sh)\b|\bsu\s+(-\s+)?root\b/i,            // shell root interativo
    /\bchmod\s+(-[a-zA-Z]+\s+)*0?777\b/i,                             // permissão 777
    // rm com flags recursiva E forçada em qualquer forma (-r -f, -fR, --recursive --force)
    /\brm\b(?=[^\n;|&]{0,80}\s(?:-[a-zA-Z]*[rR]|--recursive))(?=[^\n;|&]{0,80}\s(?:-[a-zA-Z]*f|--force))/,
    /\bfind\s+(\/|~|\$HOME)(\s|$)[^\n;|&]{0,120}(-delete\b|-exec\s+rm\b)/i, // find na raiz/home apagando
    /\bssh\b[^\n;|&]{0,60}\broot@/i,                                   // (ciclo 3) ssh como root
    />{1,2}\s*\/etc\/|\btee\s+(-a\s+)?\/etc\/|\/etc\/(shadow|sudoers)\b/i, // (ciclo 3) escrita em /etc, shadow/sudoers
    /\bflush(all|db)\b/i,                                             // redis FLUSHALL/FLUSHDB
    /\bdropDatabase\s*\(/i,                                           // mongo db.dropDatabase()
  ];
  const SHELL_MEDIUM_EXTRA = [
    /\bsudo\b/i,                                                      // qualquer elevação de privilégio
    /\bfind\b[^\n;|&]{0,120}(-delete\b|-exec\s+rm\b)/i,               // find -delete local (dist, *.map)
    /\bnpm\s+publish\b|\bdocker\s+push\b/i,
    /\b(shutdown|poweroff|halt|reboot)\s+(now|-[hrpf]\b|\+\d+)/i,         // (ciclo 3) shutdown now / reboot -f                           // publicação de artefato
  ];

  // ================================================================
  // MEDIUM (linguagem natural PT-BR — texto normalizado): mudança estrutural
  // legítima, porém revisável.
  // ================================================================
  const NL_MEDIUM_PATTERNS = [
    // Remover coluna/campo ("remover campo obsoleto")
    /\b(remov|exclu|apag|drop)\w*\b[^.\n]{0,25}\b(colunas?|campos?|atributos?|propriedades?)\b/,
    // Migration PT ("crie uma migração", "migrar os dados")
    /\bmigra(cao|coes|r|te|e)\b/,
    // Schema / estrutura do banco ("altere o schema")
    /\b(alter|mud|modific)\w*\b[^.\n]{0,25}\b(schema|modelo prisma|estrutura do banco)\b/,
    // Dependências PT ("instale a lib axios", "atualize a dependência")
    /\b(instal|adicion|atualiz)\w*\b[^.\n]{0,20}\b(dependencias?|pacotes?|bibliotecas?|libs?)\b/,
    // Git destrutivo local ("descarte as alterações", "reset hard")
    /\b(reset(e|ar)? (hard|--hard)|descart\w* (as )?alteracoes)\b/,
    // Infra — objeto antes do verbo ("nginx: altere a config")
    /\b(docker|kubernetes|k8s|nginx|systemd|cron)\b[^.\n]{0,25}\b(alter|reinici|config|mud)\w*/,
    // Infra — verbo antes do objeto ("reinicie o nginx")
    /\b(alter|reinici|reconfigur|configur|mud|derrub|reinstal)\w*\b[^.\n]{0,25}\b(docker|kubernetes|k8s|nginx|systemd|cron)\b/,
    // (ciclo 2) Desligar/reiniciar servidor, matar processos — MEDIUM: ambíguo
    // (servidor de mock local vs VPS); exige aprovação igual ao HIGH.
    /\b(deslig|reinici|derrub|desliga)\w*\b[^.\n]{0,20}\b(servidor(es)?|server|vps|maquina|cluster|containers?|servicos?)\b/,
    // (ciclo 3) EN: "reboot the server", "shut down the vps" — MEDIUM, coerente com "Desligue o servidor"
    /\b(shut ?down|reboot|restart|power ?off|turn off|stop)\b[^.\n]{0,20}\b(server|servers|vps|machine|host|cluster|containers?)\b/,
    /\bmat(e|ar|a)\b[^.\n]{0,15}\bprocessos?\b|\bkill\s?all\b|\bpkill\b/,
    // (ciclo 2) Release: deploy/publicação explícita ("Faça deploy", "Publique no npm").
    // "documentar o processo de deploy" (sem verbo de execução) = LOW.
    /\b(fac|faz|rod|execut|dispar|sub)\w*\b[^.\n]{0,15}\b(deploy|release)\b|\bdeploy\b[^.\n]{0,10}\b(em|no|na|para|pra) (o |a )?(staging|homolog\w*|servidor|vps|cluster|ar)\b/,
    /\bpubli(qu|c)\w*\b[^.\n]{0,15}\b(npm|registry|pypi|docker hub|play store|app store)\b/,
  ];

  let level = 'LOW';
  let explanation = 'Nenhum padrão de risco detectado.';
  const matchedPatterns = [];

  // Pré-computa texto limpo e normalizado por fonte (1x — prompt pode ser grande).
  for (let s = 0; s < sources.length; s++) {
    sources[s].cleaned = sources[s].text ? clean(sources[s].text) : '';
    sources[s].normalized = sources[s].text ? norm(sources[s].text) : '';
  }

  // Busca o primeiro match de uma lista de padrões em todas as fontes.
  function findFirst(patterns, useNormalized) {
    for (let s = 0; s < sources.length; s++) {
      const txt = useNormalized ? sources[s].normalized : sources[s].cleaned;
      if (!txt) continue;
      for (let i = 0; i < patterns.length; i++) {
        if (patterns[i].test(txt)) {
          return { pattern: patterns[i].toString(), source: sources[s].source };
        }
      }
    }
    return null;
  }

  // Ordem: HIGH shell legado → HIGH shell extra (texto limpo NFKC) → HIGH NL (normalizado)
  //        → MEDIUM shell legado → MEDIUM shell extra → MEDIUM NL.
  // Primeiro HIGH vence; MEDIUM só é avaliado se nada HIGH casou.
  const high =
    findFirst(HIGH_PATTERNS, false) ||
    findFirst(SHELL_HIGH_EXTRA, false) ||
    findFirst(NL_HIGH_PATTERNS, true);
  if (high) {
    level = 'HIGH';
    explanation = 'Padrão de risco ALTO detectado (' + high.source + '): ' + high.pattern;
    matchedPatterns.push({ pattern: high.pattern, level: 'HIGH', source: high.source });
  } else {
    const medium =
      findFirst(MEDIUM_PATTERNS, false) ||
      findFirst(SHELL_MEDIUM_EXTRA, false) ||
      findFirst(NL_MEDIUM_PATTERNS, true);
    if (medium) {
      level = 'MEDIUM';
      explanation = 'Padrão de risco MÉDIO detectado (' + medium.source + '): ' + medium.pattern;
      matchedPatterns.push({ pattern: medium.pattern, level: 'MEDIUM', source: medium.source });
    }
  }

  // Garantir que op.dados existe antes de atribuir
  if (!op.dados) op.dados = {};

  op.dados.risk = {
    level: level,
    explanation: explanation,
    matchedPatterns: matchedPatterns,
    scannedSources: ['command', 'prompt'],
    validatorVersion: 2,
    classifiedAt: new Date().toISOString(),
  };
  // CRÍTICO: fail-open — se nenhum padrão, level = 'LOW' (não erro, não throw)
}

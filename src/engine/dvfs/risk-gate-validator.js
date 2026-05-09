// risk-gate-validator.js — DVFS chave=3 (pré-cálculo)
// Classifica o risco do comando em LOW, MEDIUM ou HIGH.
//
// Task 2: versão COMPLETA com 50 patterns adversariais (25 HIGH + 15 MEDIUM).
// Portados do Scrumban V1 + expandidos para cobertura enterprise.
//
// Recebe `op` (instância OperacaoExecucaoClaude) como contexto.
// Popula op.dados.risk = { level, explanation, matchedPatterns, classifiedAt }.
// Fail-open: se nenhum padrão, level = 'LOW' (nunca erro).
//
// ADR-V2-006: risco via idClasse (-301/-302/-303), não campo — este script
// apenas classifica. OperacaoExecucaoClaude.calcula() define _classeBase conforme risk.level.
async function riskGateValidator(op) {
  const text = (op.dados && op.dados.command && op.dados.command.text) ? op.dados.command.text : '';

  // ================================================================
  // HIGH: comandos que causam perda irreversível de dados ou
  // comprometimento de segurança (25 patterns).
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
  // MEDIUM: comandos com risco moderado que requerem revisão (15 patterns).
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

  let level = 'LOW';
  let explanation = 'Nenhum padrão de risco detectado.';
  const matchedPatterns = [];

  // Verificar HIGH primeiro (prioridade máxima — um HIGH basta)
  for (let i = 0; i < HIGH_PATTERNS.length; i++) {
    if (HIGH_PATTERNS[i].test(text)) {
      level = 'HIGH';
      explanation = 'Padrão de risco ALTO detectado: ' + HIGH_PATTERNS[i].toString();
      matchedPatterns.push({ pattern: HIGH_PATTERNS[i].toString(), level: 'HIGH' });
      break; // Um HIGH já basta — não precisamos verificar mais
    }
  }

  // Verificar MEDIUM apenas se não for HIGH
  if (level === 'LOW') {
    for (let i = 0; i < MEDIUM_PATTERNS.length; i++) {
      if (MEDIUM_PATTERNS[i].test(text)) {
        level = 'MEDIUM';
        explanation = 'Padrão de risco MÉDIO detectado: ' + MEDIUM_PATTERNS[i].toString();
        matchedPatterns.push({ pattern: MEDIUM_PATTERNS[i].toString(), level: 'MEDIUM' });
        break; // Um MEDIUM já basta
      }
    }
  }

  // Garantir que op.dados existe antes de atribuir
  if (!op.dados) op.dados = {};

  op.dados.risk = {
    level: level,
    explanation: explanation,
    matchedPatterns: matchedPatterns,
    classifiedAt: new Date().toISOString(),
  };
  // CRÍTICO: fail-open — se nenhum padrão, level = 'LOW' (não erro, não throw)
}

// risk-gate-validator.js — DVFS chave=3 (pré-cálculo)
// Classifica o risco do comando em LOW, MEDIUM ou HIGH.
//
// TASK 1: versão SIMPLIFICADA (5 patterns HIGH + 3 patterns MEDIUM).
// Task 2 expande para 50 patterns adversariais completos (portados do Scrumban V1).
//
// Recebe `op` (instância OperacaoExecucaoClaude) como contexto.
// Popula op.dados.risk = { level, explanation, matchedPatterns, classifiedAt }.
// Fail-open: se nenhum padrão, level = 'LOW' (nunca erro).
//
// ADR-V2-006: risco via idClasse (-301/-302/-303), não campo — este script
// apenas classifica. OperacaoExecucaoClaude.calcula() define _classeBase conforme risk.level.
async function riskGateValidator(op) {
  const text = (op.dados && op.dados.command && op.dados.command.text) ? op.dados.command.text : '';

  // HIGH: comandos que causam perda irreversível de dados ou segurança comprometida
  const HIGH_PATTERNS = [
    /rm\s+-rf/i,                          // destruição de filesystem
    /DROP\s+(TABLE|DATABASE|SCHEMA)/i,    // DDL destrutivo
    /DELETE\s+FROM\s+\w+\s*;?\s*$/i,     // DELETE sem WHERE (detecta fim de string sem WHERE)
    /git\s+push\s+--force/i,             // reescrita de histórico remoto
    /format\s+[a-z]:|mkfs/i,             // formatação de volume
  ];

  // MEDIUM: comandos com risco moderado que requerem revisão
  const MEDIUM_PATTERNS = [
    /git\s+reset\s+--hard/i,             // perda de estado local
    /prisma\s+migrate\s+reset/i,         // reset de banco de dados
    /TRUNCATE\s+/i,                      // esvaziamento de tabela
  ];

  let level = 'LOW';
  let explanation = 'Nenhum padrão de risco detectado.';
  const matchedPatterns = [];

  // Verificar HIGH primeiro (prioridade)
  for (let i = 0; i < HIGH_PATTERNS.length; i++) {
    if (HIGH_PATTERNS[i].test(text)) {
      level = 'HIGH';
      explanation = 'Padrão de risco ALTO detectado: ' + HIGH_PATTERNS[i].toString();
      matchedPatterns.push({ pattern: HIGH_PATTERNS[i].toString(), level: 'HIGH' });
      break; // Um HIGH já basta
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

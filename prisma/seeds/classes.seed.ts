/**
 * SEED CANONICO de DClasses — Scrumban-Backend-V2 (Pilar 3 — F1).
 *
 * Composicao do seed (ADR-V2-019: monolitico):
 *   - 45 classes fixas universais Devari-Core (range -1..-110), via spread de
 *     `templates/classes-base-template.ts`.
 *   - 83 classes especificas Scrumban-V2 (range -150..-527), declaradas
 *     neste arquivo, agrupadas por seccao (DEntidade, DVincula, DPedido,
 *     DTabela, DEvento, DTabela secundario) com comentarios `// === ... ===`.
 *
 * Total: 128 DClasses.
 *
 * Validacao automatica:
 *   `validateHierarchy(classes)` e chamado no topo deste modulo. Qualquer
 *   violacao (ciclo, idPai inexistente, sequestro de chave canonica
 *   reservada, chave duplicada/positiva) lanca Error em time de import,
 *   ANTES de qualquer escrita no banco. Isso garante que problemas
 *   estruturais sao detectados em `tsc`/`jest`/CI, nao em producao.
 *
 * Idempotencia (ADR-V2-020):
 *   O `seed-runner.ts` consome este array e faz UPSERT atomico em
 *   `prisma.$transaction`. Re-execucao do seed e segura.
 *
 * Convencao de chaves negativas (devari-polymorphic-engine.md §3):
 *   - Seeds = chaves NEGATIVAS. Runtime = chaves POSITIVAS.
 *   - Range -1..-110 reservado para fixas universais.
 *   - Range -150..-527 alocado para Scrumban-V2 (este arquivo).
 *   - Chaves -45/-47/-49/-50 sao do template fintech (Dinpayz) — bloqueadas
 *     pelo validador como sequestro caso sejam usadas aqui.
 *
 * @see prisma/seeds/validate-hierarchy.ts (validador puro)
 * @see prisma/seeds/seed-runner.ts (runner UPSERT)
 * @see templates/classes-base-template.ts (45 classes fixas)
 * @see docs/plano/00-PLANO-MESTRE.md §3 (auditoria das 128 classes)
 * @see docs/decisions/ADR-V2-019-seed-monolitico.md
 */

import { classesFixas, type DClasseSeed } from '../../templates/classes-base-template';
import { validateHierarchy } from './validate-hierarchy';

/**
 * Helper local — reduz repeticao na declaracao de classes especificas.
 * Mesmas convencoes do helper `fixa()` do template (todos flags = false,
 * tableFields=null, baseFields=false).
 *
 * @param chave - PK negativa unica (range -150..-527 para Scrumban-V2).
 * @param codigo - codigo curto UPPER_SNAKE_CASE (ex: 'USER', 'INBOX').
 * @param nome - nome descritivo para UI.
 * @param idPai - chave da DClasse pai (deve existir no array final).
 * @param agrupamento - true se agrupador (no intermediario), false se folha.
 * @returns DClasseSeed com defaults seguros.
 */
function esp(
  chave: number,
  codigo: string,
  nome: string,
  idPai: number,
  agrupamento = false,
): DClasseSeed {
  return {
    chave,
    codigo,
    nome,
    idPai,
    agrupamento,
    inativo: false,
    excluido: false,
    excluivel: false,
    editavel: false,
    tableFields: null,
    baseFields: false,
  };
}

/**
 * Array de classes especificas Scrumban-V2 (83 entradas).
 *
 * Ordem:
 *   1. DEntidade — 5 (sub-tipos de Pessoa: USER, PLATFORM_SCRUMBAN,
 *      ORGANIZATION, AGENT, TEAM).
 *   2. DVincula — 11 (relacoes Org-User, Project-User, Team, Project-Agent,
 *      Telegram).
 *   3. DPedido — 4 (EXECUTION + EXEC_LOW/MED/HIGH para Pilar 1 / F6).
 *   4. DTabela principal — 35 (SPRINT, PRIORITY, TASK_TYPE, STATUS V3,
 *      CHANNEL, WEBHOOK, API_KEY, MCP_KEY, INSTALL_TOKEN, PAIRING_TOKEN,
 *      ISSUE_COUNTER).
 *   5. DEvento — 12 (NOTIFICATION, WEBHOOK_ATTEMPT, AGENT_HEARTBEAT,
 *      TELEGRAM_*, MCP_CALL, EXECUTION_LOG, audit logs).
 *   6. DTabela secundario — 16 (AGENT_STATUS, EXEC_STATUS, RISK_LEVEL).
 *
 * Soma: 5 + 11 + 4 + 35 + 12 + 16 = 83.
 */
const classesEspecificas: DClasseSeed[] = [
  // === DEntidade — sub-tipos de Pessoa (5) ===
  // Filhos de PESSOAS (-43)
  esp(-150, 'USER', 'Usuario Scrumban', -43),
  esp(-151, 'PLATFORM_SCRUMBAN', 'Platform Scrumban', -43),
  esp(-152, 'ORGANIZATION', 'Organizacao', -43),
  esp(-156, 'AGENT', 'Agente Claude Code', -43),
  esp(-180, 'TEAM', 'Time', -43),

  // === DVincula — relacoes (11) ===
  // Filhos de ENTIDADES (-37) por convencao do plano-mestre §3.2
  esp(-160, 'ORG_USER_LINK', 'Vinculo Org-Usuario', -37, true),
  esp(-161, 'ORG_ROLE_ADMIN', 'Org Role: ADMIN', -160),
  esp(-162, 'ORG_ROLE_MEMBER', 'Org Role: MEMBER', -160),
  esp(-163, 'ORG_ROLE_VIEWER', 'Org Role: VIEWER', -160),
  esp(-170, 'PROJECT_USER_LINK', 'Vinculo Project-Usuario', -37, true),
  esp(-171, 'PROJECT_ROLE_MANAGER', 'Project Role: MANAGER', -170),
  esp(-172, 'PROJECT_ROLE_MEMBER', 'Project Role: MEMBER', -170),
  esp(-173, 'PROJECT_ROLE_VIEWER', 'Project Role: VIEWER', -170),
  esp(-181, 'TEAM_MEMBERSHIP', 'Vinculo Team-User', -37),
  esp(-185, 'PROJECT_AGENT', 'Vinculo Project-Agent', -37),
  esp(-186, 'TELEGRAM_LINK', 'Vinculo User-Telegram chat', -37),

  // === DPedido — execucoes Claude Code (4 — Pilar 1 prep para F6) ===
  // Filho de PEDIDOS (-20)
  esp(-300, 'EXECUTION', 'Execucao Claude Code', -20, true),
  esp(-301, 'EXEC_LOW', 'Execucao risco LOW', -300),
  esp(-302, 'EXEC_MED', 'Execucao risco MEDIUM', -300),
  esp(-303, 'EXEC_HIGH', 'Execucao risco HIGH', -300),

  // === DTabela — lookups e folhas runtime principais (32) ===
  // Filhos de TABELAS (-51) ou STATUS (-52) conforme plano-mestre §3.2
  esp(-400, 'SPRINT', 'Sprint (agrupador)', -51, true),
  esp(-420, 'PRIORITY', 'Priority (agrupador)', -51, true),
  esp(-421, 'HIGH', 'Priority HIGH', -420),
  esp(-422, 'MEDIUM', 'Priority MEDIUM', -420),
  esp(-423, 'LOW', 'Priority LOW', -420),
  esp(-424, 'URGENT', 'Priority URGENT', -420),
  esp(-430, 'TASK_TYPE', 'Task Type (agrupador)', -51, true),
  esp(-431, 'FEATURE', 'Task FEATURE', -430),
  esp(-432, 'BUG', 'Task BUG', -430),
  esp(-433, 'IMPROVEMENT', 'Task IMPROVEMENT', -430),
  esp(-434, 'REVIEW', 'Task REVIEW', -430),
  esp(-435, 'EXPLAIN', 'Task EXPLAIN', -430),
  esp(-440, 'STATUS_INTENTION_V3', 'Status V3 (agrupador)', -52, true),
  esp(-441, 'INBOX', 'Status INBOX', -440),
  esp(-442, 'READY', 'Status READY', -440),
  esp(-443, 'EXECUTING', 'Status EXECUTING', -440),
  esp(-444, 'DONE', 'Status DONE', -440),
  esp(-445, 'FAILED', 'Status FAILED', -440),
  esp(-446, 'CANCELLED', 'Status CANCELLED', -440),
  esp(-447, 'DISCARDED', 'Status DISCARDED', -440),
  esp(-448, 'VALIDATING', 'Status VALIDATING', -440),
  esp(-449, 'VALIDATED', 'Status VALIDATED', -440),
  esp(-450, 'CHANNEL', 'Canal (agrupador)', -52, true),
  esp(-451, 'WEB', 'Canal WEB', -450),
  esp(-452, 'WHATSAPP', 'Canal WHATSAPP', -450),
  esp(-453, 'EMAIL', 'Canal EMAIL', -450),
  esp(-454, 'SLACK', 'Canal SLACK', -450),
  esp(-455, 'API', 'Canal API', -450),
  esp(-456, 'TELEGRAM', 'Canal TELEGRAM', -450),
  esp(-470, 'WEBHOOK', 'Configuracao de Webhook outbound', -52),
  esp(-471, 'API_KEY', 'API Key por projeto', -52),
  esp(-472, 'MCP_KEY', 'MCP Key por usuario', -52),
  esp(-473, 'INSTALL_TOKEN', 'Token install one-shot Argus', -52),
  esp(-474, 'PAIRING_TOKEN', 'Token pairing Telegram', -52),
  esp(-475, 'ISSUE_COUNTER', 'Contador DEV-N por team', -52),

  // === DEvento — auditoria (12) ===
  // Filhos de EVENTOS (-3) — audit trail polimorfico
  esp(-490, 'NOTIFICATION', 'Notificacao in-app', -3),
  esp(-491, 'WEBHOOK_ATTEMPT', 'Tentativa de Webhook outbound', -3),
  esp(-492, 'AGENT_HEARTBEAT', 'Heartbeat de Agent', -3),
  esp(-493, 'TELEGRAM_MSG_IN', 'Mensagem Telegram recebida', -3),
  esp(-494, 'TELEGRAM_MSG_OUT', 'Mensagem Telegram enviada', -3),
  esp(-495, 'MCP_CALL', 'Chamada MCP auditada', -3),
  esp(-496, 'EXECUTION_LOG', 'Log de execucao Claude', -3),
  esp(-497, 'TASK_CREATED', 'Audit: task criada', -3),
  esp(-498, 'TASK_STATUS_CHANGED', 'Audit: mudanca de status', -3),
  esp(-499, 'PROJECT_DELETED', 'Audit: projeto deletado', -3),
  esp(-500, 'ORG_DELETED', 'Audit: org deletada', -3),
  esp(-501, 'USER_LOGIN', 'Audit: login', -3),

  // === DTabela — status lookups secundarios (16) ===
  // Filhos de STATUS (-52)
  esp(-510, 'AGENT_STATUS_ONLINE', 'Agent: ONLINE', -52),
  esp(-511, 'AGENT_STATUS_OFFLINE', 'Agent: OFFLINE', -52),
  esp(-512, 'AGENT_STATUS_PENDING_INSTALL', 'Agent: PENDING_INSTALL', -52),
  esp(-513, 'AGENT_STATUS_NEVER_CONNECTED', 'Agent: NEVER_CONNECTED', -52),
  esp(-514, 'EXEC_STATUS_QUEUED', 'Exec: QUEUED', -52),
  esp(-515, 'EXEC_STATUS_AWAITING_APPROVAL', 'Exec: AWAITING_APPROVAL', -52),
  esp(-516, 'EXEC_STATUS_APPROVED', 'Exec: APPROVED', -52),
  esp(-517, 'EXEC_STATUS_REJECTED', 'Exec: REJECTED', -52),
  esp(-518, 'EXEC_STATUS_RUNNING', 'Exec: RUNNING', -52),
  esp(-519, 'EXEC_STATUS_SUCCESS', 'Exec: SUCCESS', -52),
  esp(-520, 'EXEC_STATUS_FAILED', 'Exec: FAILED', -52),
  esp(-521, 'EXEC_STATUS_EXPIRED', 'Exec: EXPIRED', -52),
  esp(-522, 'EXEC_STATUS_ROLLED_BACK', 'Exec: ROLLED_BACK', -52),
  esp(-525, 'RISK_LEVEL_LOW', 'Risk: LOW', -52),
  esp(-526, 'RISK_LEVEL_MEDIUM', 'Risk: MEDIUM', -52),
  esp(-527, 'RISK_LEVEL_HIGH', 'Risk: HIGH', -52),
];

/**
 * Array completo do seed (45 fixas + 83 especificas = 128 DClasses).
 * Validado automaticamente em time de import (validateHierarchy abaixo).
 */
export const classes: DClasseSeed[] = [...classesFixas, ...classesEspecificas];

/**
 * Contagens explicitas exportadas — usadas pelo seed-runner para log
 * estruturado e por testes anti-regressao.
 */
export const COUNTS = Object.freeze({
  fixas: classesFixas.length,
  especificas: classesEspecificas.length,
  total: classes.length,
});

// =============================================================================
// VALIDACAO ESTATICA EM TIME DE IMPORT
// =============================================================================
// Roda no `tsc`, no `jest` (qualquer teste que importe esse arquivo) e no
// `prisma db seed`. Se quebrar: erro fatal antes de tocar o banco.
validateHierarchy(classes);

export { classesEspecificas };

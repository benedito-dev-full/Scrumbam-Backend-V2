/**
 * Lista canônica de tipos de eventos válidos no V2.
 *
 * Formato (devari-event-naming.md):
 *   {dominio}.{entidade}.{acao}  ou  {dominio}.{acao}
 *
 * `EventProducerService.addInternalEvent()` rejeita (lança erro) qualquer
 * `type` fora desta lista. Reviewer rejeita emissão de tipos
 * desconhecidos no diff.
 *
 * Para adicionar novo tipo:
 *  1. Adicionar entrada constante aqui (lower_snake → string `dominio.entidade.acao`).
 *  2. Verificar/adicionar mapeamento `type → idClasse` em
 *     `src/eventos/consumers/audit-log.consumer.ts` (TYPE_TO_CLASSE).
 *  3. Atualizar `src/eventos/README.md` (seção "Tipos canônicos").
 */
export const EVENT_TYPES = {
  // ============== TASKS ==============
  TASK_CREATED: 'task.created',
  TASK_STATUS_CHANGED: 'task.status.changed',
  TASK_ASSIGNED: 'task.assigned',
  TASK_DELETED: 'task.deleted',

  // ============== PROJECTS (lifecycle — ADR-V2-027) ==============
  PROJECT_CREATED: 'project.created',
  PROJECT_UPDATED: 'project.updated',
  PROJECT_DELETED: 'project.deleted',

  // ============== PROJECT ↔ TEAM (ADR-V2-029) ==============
  PROJECT_TEAM_LINKED: 'project.team.linked',
  PROJECT_TEAM_UNLINKED: 'project.team.unlinked',

  // ============== ORGANIZATIONS / TEAMS (lifecycle — ADR-V2-027) ==============
  ORG_CREATED: 'org.created',
  ORG_UPDATED: 'org.updated',
  ORG_DELETED: 'org.deleted',
  TEAM_CREATED: 'team.created',
  TEAM_DELETED: 'team.deleted',

  // ============== ENTIDADES (genérico — substitui audit inline) ==============
  ENTITY_CREATED: 'entity.created',
  ENTITY_UPDATED: 'entity.updated',
  ENTITY_DELETED: 'entity.deleted',

  // ============== EXECUTIONS (F6) ==============
  EXECUTION_LOW_CREATED: 'execution.low.created',
  EXECUTION_MEDIUM_CREATED: 'execution.medium.created',
  EXECUTION_HIGH_CREATED: 'execution.high.created',
  EXECUTION_AWAITING_APPROVAL: 'execution.awaiting_approval',
  EXECUTION_APPROVED: 'execution.approved',
  EXECUTION_STARTED: 'execution.started',
  EXECUTION_REJECTED: 'execution.rejected',
  EXECUTION_EXPIRED: 'execution.expired',
  EXECUTION_COMPLETED: 'execution.completed',
  EXECUTION_SUCCEEDED: 'execution.succeeded',
  EXECUTION_FAILED: 'execution.failed',
  EXECUTION_LOW_SKIP: 'execution.low.skip',
  EXECUTION_MEDIUM_SKIP: 'execution.medium.skip',
  EXECUTION_HIGH_SKIP: 'execution.high.skip',

  // ============== EMAIL ==============
  EMAIL_SENT: 'email.sent',
  EMAIL_FAILED: 'email.failed',

  // ============== AUTH ==============
  USER_LOGIN_SUCCEEDED: 'user.login.succeeded',
  USER_LOGIN_FAILED: 'user.login.failed',

  // ============== SYSTEM (fallback genérico) ==============
  SYSTEM_HEALTH_CHECK: 'system.health.check',
  SYSTEM_AUDIT_LOG: 'system.audit.log',

  // ============== INTEGRAÇÕES (placeholders para F10/F11/F12) ==============
  AGENT_REGISTERED: 'agent.registered',
  AGENT_ONLINE: 'agent.online',
  AGENT_OFFLINE: 'agent.offline',
  AGENT_HEARTBEAT: 'agent.heartbeat',

  // ============== AGENT EXECUTION OUTCOME (F13 / ADR-V2-033) ==============
  // Emitidos pelo handler POST /agents/:id/execution-result quando agente V2
  // reporta término da execução Claude Code. Persistem em DEvento idClasse=-496
  // (EXECUTION_LOG) via TYPE_TO_CLASSE. Diferenciam-se de execution.succeeded/
  // failed (genéricos do Engine) por serem específicos do callback do agente.
  AGENT_EXECUTION_FINISHED: 'agent.execution.finished',
  AGENT_EXECUTION_FAILED: 'agent.execution.failed',
  // Session lifecycle: persistem em DEvento idClasse=-505/-506 (seed Sub-tarefa 2.1).
  AGENT_SESSION_CREATED: 'agent.session.created',
  AGENT_SESSION_RESUMED: 'agent.session.resumed',
  // ============== AGENT ↔ PROJECT LINKING (Task 4 sub-tarefas 4.3+4.4) ==============
  // Emitidos por AgentsService.linkProject/unlinkProject quando vínculo agente-projeto
  // (DVincula idClasse=-185 AUTOMATION_CLASS_IDS.PROJECT_AGENT) é criado ou soft-deleted.
  // Persistem em DEvento idClasse=-492 (AGENT_HEARTBEAT — categoria "eventos
  // administrativos de agente", consistente com agent.registered/online/offline).
  AGENT_PROJECT_LINKED: 'agent.project.linked',
  AGENT_PROJECT_UNLINKED: 'agent.project.unlinked',
  WEBHOOK_ATTEMPTED: 'webhook.attempted',
  WEBHOOK_AUTO_DISABLED: 'webhook.auto_disabled',
  MCP_CALL: 'mcp.call',
  TELEGRAM_MESSAGE_IN: 'telegram.message.in',
  TELEGRAM_MESSAGE_OUT: 'telegram.message.out',

  // ============== TELEGRAM (F10 Bloco B) ==============
  TELEGRAM_MESSAGE_RECEIVED: 'telegram.message.received',
  TELEGRAM_VOICE_RECEIVED: 'telegram.voice.received',

  // ============== INVITES (lifecycle — ADR-V2-028) ==============
  INVITE_SENT: 'invite.sent',
  INVITE_ACCEPTED: 'invite.accepted',
  INVITE_EXPIRED: 'invite.expired',
  INVITE_REVOKED: 'invite.revoked',
} as const;

/**
 * Tipo derivado dos valores de `EVENT_TYPES`. Útil para tipagem estrita
 * em DTOs e payloads.
 */
export type EventType = (typeof EVENT_TYPES)[keyof typeof EVENT_TYPES];

/**
 * Lista imutável de todos os tipos canônicos. Usada pelo
 * `EventProducerService` para validar emissões.
 */
export const ALL_EVENT_TYPES: ReadonlyArray<EventType> = Object.values(EVENT_TYPES);

/**
 * Conjunto para lookup O(1) — usado em validação hot-path.
 */
export const ALL_EVENT_TYPES_SET: ReadonlySet<string> = new Set<string>(ALL_EVENT_TYPES);

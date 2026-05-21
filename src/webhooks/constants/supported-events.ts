export const SUPPORTED_EVENTS = [
  'task.created',
  'task.status_changed',
  'task.assigned',
  'task.deleted',
  'task.commented',
  'task.priority_changed',
  // Phases (ADR-V2-047 — Fase 8: webhooks phase.*)
  // Persistem em DEvento -489 (AUDIT_GENERIC) via TYPE_TO_CLASSE com
  // metaDados._meta.action distinguindo created/updated/deleted/completed.
  'phase.created',
  'phase.updated',
  'phase.deleted',
  'phase.completed',
  'project.created',
  'project.member_added',
  'project.deleted',
  'sprint.started',
  'sprint.closed',
  'execution.queued',
  'execution.awaiting_approval',
  'execution.approved',
  'execution.rejected',
  'execution.started',
  'execution.completed',
  'execution.failed',
  'execution.expired',
  'execution.rolled_back',
  'agent.online',
  'agent.offline',
] as const;

export type SupportedEvent = (typeof SUPPORTED_EVENTS)[number];

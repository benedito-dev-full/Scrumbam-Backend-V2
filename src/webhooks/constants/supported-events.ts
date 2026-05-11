export const SUPPORTED_EVENTS = [
  'task.created',
  'task.status_changed',
  'task.assigned',
  'task.deleted',
  'task.commented',
  'task.priority_changed',
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


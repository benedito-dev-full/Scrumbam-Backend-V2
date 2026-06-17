/**
 * Spec consolidada: gate de scope por tool (ADR-V2-068).
 *
 * Valida que TODAS as 18 tools MCP lançam FORBIDDEN (-32002) quando o
 * contexto não contém o scope correto para a tool chamada.
 *
 * Padrão de cada case:
 *  1. Instancia a tool alvo com mocks mínimos (nunca chamados).
 *  2. Monta um McpRouterService com APENAS essa tool na posição correta.
 *  3. Dispara `tools/call` com ctx sem nenhum scope.
 *  4. Verifica `response.error.code === -32002` e
 *     `response.error.data.requiredScope === '<scope>'`.
 *  5. Verifica que nenhum mock de service foi chamado (gate antes de I/O).
 *
 * Scope por tool (ADR-V2-068):
 *  tasks:read          — list_tasks, get_task, list_projects, get_project,
 *                        list_blocks, list_block_tasks, list_members, search_tasks
 *  tasks:write         — create_task, update_task, update_status, update_timer,
 *                        delete_task
 *  notifications:read  — list_notifications, get_unread_count
 *  notifications:write — update_notification
 *  projects:write      — update_project
 *  executions:create   — execute_task
 */

import { MCP_ERROR_CODES } from '../constants';
import { McpRouterService } from '../services/mcp-router.service';
import { CreateTaskTool } from '../tools/create-task.tool';
import { DeleteTaskTool } from '../tools/delete-task.tool';
import { ExecuteTaskTool } from '../tools/execute-task.tool';
import { GetProjectTool } from '../tools/get-project.tool';
import { GetTaskTool } from '../tools/get-task.tool';
import { GetUnreadCountTool } from '../tools/get-unread-count.tool';
import { ListBlockTasksTool } from '../tools/list-block-tasks.tool';
import { ListBlocksTool } from '../tools/list-blocks.tool';
import { ListMembersTool } from '../tools/list-members.tool';
import { ListNotificationsTool } from '../tools/list-notifications.tool';
import { ListProjectsTool } from '../tools/list-projects.tool';
import { ListTasksTool } from '../tools/list-tasks.tool';
import { SearchTasksTool } from '../tools/search-tasks.tool';
import { UpdateNotificationTool } from '../tools/update-notification.tool';
import { UpdateProjectTool } from '../tools/update-project.tool';
import { UpdateStatusTool } from '../tools/update-status.tool';
import { UpdateTaskTool } from '../tools/update-task.tool';
import { UpdateTimerTool } from '../tools/update-timer.tool';

/** Contexto sem nenhum scope — qualquer gate de scope vai barrar. */
const ctxNoScope = {
  dEntidadeId: BigInt(1),
  scopes: [] as string[],
  keyChave: BigInt(10),
  keyPrefix: 'scrumban_mcp',
  keyHash: 'hash',
};

/** Mock genérico de service (todos os métodos como jest.fn()). */
const noop = {} as never;

/** Helper: verifica que o response contém FORBIDDEN com o scope informado. */
function expectForbidden(response: unknown, requiredScope: string): void {
  const r = response as { error?: { code: number; data?: { requiredScope?: string } } };
  expect(r.error).toEqual(
    expect.objectContaining({
      code: MCP_ERROR_CODES.FORBIDDEN,
      data: { requiredScope: requiredScope },
    }),
  );
}

// ─── tasks:read ──────────────────────────────────────────────────────────────

describe('scope gate: tasks:read', () => {
  const SCOPE = 'tasks:read';

  it('list_tasks → FORBIDDEN quando scope ausente', async () => {
    const tasksSvc = { findMany: jest.fn() };
    // ListTasksTool(tasksService, projectsService)
    const tool = new ListTasksTool(tasksSvc as never, noop);
    const router = new McpRouterService(tool);

    const response = await router.dispatch(
      'tools/call',
      { name: 'list_tasks', arguments: { projectId: '1' } },
      ctxNoScope,
    );

    expectForbidden(response, SCOPE);
    expect(tasksSvc.findMany).not.toHaveBeenCalled();
  });

  it('get_task → FORBIDDEN quando scope ausente', async () => {
    const tasksSvc = { findOne: jest.fn() };
    // GetTaskTool(tasksService, projectsService)
    const tool = new GetTaskTool(tasksSvc as never, noop);
    const router = new McpRouterService(
      undefined, // listTasksTool
      undefined, // createTaskTool
      undefined, // updateStatusTool
      undefined, // listProjectsTool
      tool, // getTaskTool
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'get_task', arguments: { taskId: '1' } },
      ctxNoScope,
    );

    expectForbidden(response, SCOPE);
    expect(tasksSvc.findOne).not.toHaveBeenCalled();
  });

  it('list_projects → FORBIDDEN quando scope ausente', async () => {
    const projSvc = { findAll: jest.fn() };
    // ListProjectsTool(projectsService)
    const tool = new ListProjectsTool(projSvc as never);
    const router = new McpRouterService(
      undefined, // listTasksTool
      undefined, // createTaskTool
      undefined, // updateStatusTool
      tool, // listProjectsTool
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'list_projects', arguments: {} },
      ctxNoScope,
    );

    expectForbidden(response, SCOPE);
    expect(projSvc.findAll).not.toHaveBeenCalled();
  });

  it('get_project → FORBIDDEN quando scope ausente', async () => {
    const projSvc = { findOne: jest.fn() };
    // GetProjectTool(projectsService, projectMembersService)
    const tool = new GetProjectTool(projSvc as never, noop);
    const router = new McpRouterService(
      undefined, // listTasksTool
      undefined, // createTaskTool
      undefined, // updateStatusTool
      undefined, // listProjectsTool
      undefined, // getTaskTool
      undefined, // updateTaskTool
      undefined, // listMembersTool
      tool, // getProjectTool
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'get_project', arguments: { projectId: '1' } },
      ctxNoScope,
    );

    expectForbidden(response, SCOPE);
    expect(projSvc.findOne).not.toHaveBeenCalled();
  });

  it('list_blocks → FORBIDDEN quando scope ausente', async () => {
    const tasksSvc = { findMany: jest.fn() };
    // ListBlocksTool(tasksService, projectsService)
    const tool = new ListBlocksTool(tasksSvc as never, noop);
    const router = new McpRouterService(
      undefined, // listTasksTool
      undefined, // createTaskTool
      undefined, // updateStatusTool
      undefined, // listProjectsTool
      undefined, // getTaskTool
      undefined, // updateTaskTool
      undefined, // listMembersTool
      undefined, // getProjectTool
      undefined, // updateProjectTool
      undefined, // listNotificationsTool
      undefined, // updateNotificationTool
      undefined, // getUnreadCountTool
      undefined, // searchTasksTool
      tool, // listBlocksTool
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'list_blocks', arguments: { projectId: '1' } },
      ctxNoScope,
    );

    expectForbidden(response, SCOPE);
    expect(tasksSvc.findMany).not.toHaveBeenCalled();
  });

  it('list_block_tasks → FORBIDDEN quando scope ausente', async () => {
    const tasksSvc = { findMany: jest.fn() };
    // ListBlockTasksTool(tasksService, projectsService)
    const tool = new ListBlockTasksTool(tasksSvc as never, noop);
    const router = new McpRouterService(
      undefined, // listTasksTool
      undefined, // createTaskTool
      undefined, // updateStatusTool
      undefined, // listProjectsTool
      undefined, // getTaskTool
      undefined, // updateTaskTool
      undefined, // listMembersTool
      undefined, // getProjectTool
      undefined, // updateProjectTool
      undefined, // listNotificationsTool
      undefined, // updateNotificationTool
      undefined, // getUnreadCountTool
      undefined, // searchTasksTool
      undefined, // listBlocksTool
      tool, // listBlockTasksTool
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'list_block_tasks', arguments: { blockId: '1' } },
      ctxNoScope,
    );

    expectForbidden(response, SCOPE);
    expect(tasksSvc.findMany).not.toHaveBeenCalled();
  });

  it('list_members → FORBIDDEN quando scope ausente', async () => {
    const membersSvc = { findProjectMembers: jest.fn() };
    // ListMembersTool(projectMembersService, projectsService)
    const tool = new ListMembersTool(membersSvc as never, noop);
    const router = new McpRouterService(
      undefined, // listTasksTool
      undefined, // createTaskTool
      undefined, // updateStatusTool
      undefined, // listProjectsTool
      undefined, // getTaskTool
      undefined, // updateTaskTool
      tool, // listMembersTool
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'list_members', arguments: { projectId: '1' } },
      ctxNoScope,
    );

    expectForbidden(response, SCOPE);
    expect(membersSvc.findProjectMembers).not.toHaveBeenCalled();
  });

  it('search_tasks → FORBIDDEN quando scope ausente', async () => {
    const searchSvc = { search: jest.fn() };
    // SearchTasksTool(projectsService, searchService)
    const tool = new SearchTasksTool(noop, searchSvc as never);
    const router = new McpRouterService(
      undefined, // listTasksTool
      undefined, // createTaskTool
      undefined, // updateStatusTool
      undefined, // listProjectsTool
      undefined, // getTaskTool
      undefined, // updateTaskTool
      undefined, // listMembersTool
      undefined, // getProjectTool
      undefined, // updateProjectTool
      undefined, // listNotificationsTool
      undefined, // updateNotificationTool
      undefined, // getUnreadCountTool
      tool, // searchTasksTool
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'search_tasks', arguments: { query: 'test' } },
      ctxNoScope,
    );

    expectForbidden(response, SCOPE);
    expect(searchSvc.search).not.toHaveBeenCalled();
  });
});

// ─── tasks:write ─────────────────────────────────────────────────────────────

describe('scope gate: tasks:write', () => {
  const SCOPE = 'tasks:write';

  it('create_task → FORBIDDEN quando scope ausente', async () => {
    const tasksSvc = { create: jest.fn() };
    // CreateTaskTool(tasksService, projectsService)
    const tool = new CreateTaskTool(tasksSvc as never, noop);
    const router = new McpRouterService(
      undefined, // listTasksTool
      tool, // createTaskTool
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'create_task', arguments: { projectId: '1', titulo: 'Test' } },
      ctxNoScope,
    );

    expectForbidden(response, SCOPE);
    expect(tasksSvc.create).not.toHaveBeenCalled();
  });

  it('update_task → FORBIDDEN quando scope ausente', async () => {
    const tasksSvc = { update: jest.fn() };
    // UpdateTaskTool(tasksService, projectsService)
    const tool = new UpdateTaskTool(tasksSvc as never, noop);
    const router = new McpRouterService(
      undefined, // listTasksTool
      undefined, // createTaskTool
      undefined, // updateStatusTool
      undefined, // listProjectsTool
      undefined, // getTaskTool
      tool, // updateTaskTool
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'update_task', arguments: { taskId: '1', name: 'New Name' } },
      ctxNoScope,
    );

    expectForbidden(response, SCOPE);
    expect(tasksSvc.update).not.toHaveBeenCalled();
  });

  it('update_status → FORBIDDEN quando scope ausente', async () => {
    const tasksSvc = { findOne: jest.fn(), updateStatus: jest.fn() };
    // UpdateStatusTool(tasksService, projectsService)
    const tool = new UpdateStatusTool(tasksSvc as never, noop);
    const router = new McpRouterService(
      undefined, // listTasksTool
      undefined, // createTaskTool
      tool, // updateStatusTool
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'update_status', arguments: { taskId: '1', statusCode: 'READY' } },
      ctxNoScope,
    );

    expectForbidden(response, SCOPE);
    expect(tasksSvc.findOne).not.toHaveBeenCalled();
    expect(tasksSvc.updateStatus).not.toHaveBeenCalled();
  });

  it('update_timer → FORBIDDEN quando scope ausente', async () => {
    const tasksSvc = { findOne: jest.fn(), timer: jest.fn() };
    // UpdateTimerTool(tasksService, projectsService)
    const tool = new UpdateTimerTool(tasksSvc as never, noop);
    const router = new McpRouterService(
      undefined, // listTasksTool
      undefined, // createTaskTool
      undefined, // updateStatusTool
      undefined, // listProjectsTool
      undefined, // getTaskTool
      undefined, // updateTaskTool
      undefined, // listMembersTool
      undefined, // getProjectTool
      undefined, // updateProjectTool
      undefined, // listNotificationsTool
      undefined, // updateNotificationTool
      undefined, // getUnreadCountTool
      undefined, // searchTasksTool
      undefined, // listBlocksTool
      undefined, // listBlockTasksTool
      undefined, // executeTaskTool
      tool, // updateTimerTool
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'update_timer', arguments: { taskId: '1', action: 'start' } },
      ctxNoScope,
    );

    expectForbidden(response, SCOPE);
    expect(tasksSvc.findOne).not.toHaveBeenCalled();
    expect(tasksSvc.timer).not.toHaveBeenCalled();
  });

  it('delete_task → FORBIDDEN quando scope ausente', async () => {
    const tasksSvc = { findOne: jest.fn(), delete: jest.fn() };
    // DeleteTaskTool(tasksService, projectsService)
    const tool = new DeleteTaskTool(tasksSvc as never, noop);
    const router = new McpRouterService(
      undefined, // listTasksTool
      undefined, // createTaskTool
      undefined, // updateStatusTool
      undefined, // listProjectsTool
      undefined, // getTaskTool
      undefined, // updateTaskTool
      undefined, // listMembersTool
      undefined, // getProjectTool
      undefined, // updateProjectTool
      undefined, // listNotificationsTool
      undefined, // updateNotificationTool
      undefined, // getUnreadCountTool
      undefined, // searchTasksTool
      undefined, // listBlocksTool
      undefined, // listBlockTasksTool
      undefined, // executeTaskTool
      undefined, // updateTimerTool
      tool, // deleteTaskTool
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'delete_task', arguments: { taskId: '1' } },
      ctxNoScope,
    );

    expectForbidden(response, SCOPE);
    expect(tasksSvc.findOne).not.toHaveBeenCalled();
    expect(tasksSvc.delete).not.toHaveBeenCalled();
  });
});

// ─── notifications:read ──────────────────────────────────────────────────────

describe('scope gate: notifications:read', () => {
  const SCOPE = 'notifications:read';

  it('list_notifications → FORBIDDEN quando scope ausente', async () => {
    const notifSvc = { findMany: jest.fn() };
    // ListNotificationsTool(notificationsService)
    const tool = new ListNotificationsTool(notifSvc as never);
    const router = new McpRouterService(
      undefined, // listTasksTool
      undefined, // createTaskTool
      undefined, // updateStatusTool
      undefined, // listProjectsTool
      undefined, // getTaskTool
      undefined, // updateTaskTool
      undefined, // listMembersTool
      undefined, // getProjectTool
      undefined, // updateProjectTool
      tool, // listNotificationsTool
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'list_notifications', arguments: {} },
      ctxNoScope,
    );

    expectForbidden(response, SCOPE);
    expect(notifSvc.findMany).not.toHaveBeenCalled();
  });

  it('get_unread_count → FORBIDDEN quando scope ausente', async () => {
    const notifSvc = { getUnreadCount: jest.fn() };
    // GetUnreadCountTool(notificationsService)
    const tool = new GetUnreadCountTool(notifSvc as never);
    const router = new McpRouterService(
      undefined, // listTasksTool
      undefined, // createTaskTool
      undefined, // updateStatusTool
      undefined, // listProjectsTool
      undefined, // getTaskTool
      undefined, // updateTaskTool
      undefined, // listMembersTool
      undefined, // getProjectTool
      undefined, // updateProjectTool
      undefined, // listNotificationsTool
      undefined, // updateNotificationTool
      tool, // getUnreadCountTool
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'get_unread_count', arguments: {} },
      ctxNoScope,
    );

    expectForbidden(response, SCOPE);
    expect(notifSvc.getUnreadCount).not.toHaveBeenCalled();
  });
});

// ─── notifications:write ─────────────────────────────────────────────────────

describe('scope gate: notifications:write', () => {
  const SCOPE = 'notifications:write';

  it('update_notification → FORBIDDEN quando scope ausente', async () => {
    const notifSvc = { markAllAsRead: jest.fn() };
    // UpdateNotificationTool(notificationsService)
    const tool = new UpdateNotificationTool(notifSvc as never);
    const router = new McpRouterService(
      undefined, // listTasksTool
      undefined, // createTaskTool
      undefined, // updateStatusTool
      undefined, // listProjectsTool
      undefined, // getTaskTool
      undefined, // updateTaskTool
      undefined, // listMembersTool
      undefined, // getProjectTool
      undefined, // updateProjectTool
      undefined, // listNotificationsTool
      tool, // updateNotificationTool
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'update_notification', arguments: { action: 'mark_all_read' } },
      ctxNoScope,
    );

    expectForbidden(response, SCOPE);
    expect(notifSvc.markAllAsRead).not.toHaveBeenCalled();
  });
});

// ─── projects:write ──────────────────────────────────────────────────────────

describe('scope gate: projects:write', () => {
  const SCOPE = 'projects:write';

  it('update_project → FORBIDDEN quando scope ausente', async () => {
    const projSvc = { update: jest.fn() };
    // UpdateProjectTool(projectsService)
    const tool = new UpdateProjectTool(projSvc as never);
    const router = new McpRouterService(
      undefined, // listTasksTool
      undefined, // createTaskTool
      undefined, // updateStatusTool
      undefined, // listProjectsTool
      undefined, // getTaskTool
      undefined, // updateTaskTool
      undefined, // listMembersTool
      undefined, // getProjectTool
      tool, // updateProjectTool
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'update_project', arguments: { projectId: '1', nome: 'X' } },
      ctxNoScope,
    );

    expectForbidden(response, SCOPE);
    expect(projSvc.update).not.toHaveBeenCalled();
  });
});

// ─── executions:create ───────────────────────────────────────────────────────

describe('scope gate: executions:create', () => {
  const SCOPE = 'executions:create';

  it('execute_task → FORBIDDEN quando scope ausente', async () => {
    const tasksSvc = { findOne: jest.fn() };
    const projSvc = { findOne: jest.fn() };
    const execSvc = { execute: jest.fn() };
    const entSvc = { getUserGroupIdFromEntidade: jest.fn() };

    // ExecuteTaskTool(tasksService, projectsService, executionsService, entidadeService)
    const tool = new ExecuteTaskTool(
      tasksSvc as never,
      projSvc as never,
      execSvc as never,
      entSvc as never,
    );

    const router = new McpRouterService(
      undefined, // listTasksTool
      undefined, // createTaskTool
      undefined, // updateStatusTool
      undefined, // listProjectsTool
      undefined, // getTaskTool
      undefined, // updateTaskTool
      undefined, // listMembersTool
      undefined, // getProjectTool
      undefined, // updateProjectTool
      undefined, // listNotificationsTool
      undefined, // updateNotificationTool
      undefined, // getUnreadCountTool
      undefined, // searchTasksTool
      undefined, // listBlocksTool
      undefined, // listBlockTasksTool
      tool, // executeTaskTool
    );

    const response = await router.dispatch(
      'tools/call',
      { name: 'execute_task', arguments: { taskId: '402' } },
      ctxNoScope,
    );

    expectForbidden(response, SCOPE);
    expect(tasksSvc.findOne).not.toHaveBeenCalled();
    expect(execSvc.execute).not.toHaveBeenCalled();
  });
});

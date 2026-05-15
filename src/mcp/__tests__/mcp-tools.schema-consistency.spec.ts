import toolsSchema from '../schemas/tools.schema.json';
import { CreateTaskTool } from '../tools/create-task.tool';
import { GetProjectTool } from '../tools/get-project.tool';
import { GetTaskTool } from '../tools/get-task.tool';
import { GetUnreadCountTool } from '../tools/get-unread-count.tool';
import { ListMembersTool } from '../tools/list-members.tool';
import { ListNotificationsTool } from '../tools/list-notifications.tool';
import { ListProjectsTool } from '../tools/list-projects.tool';
import { ListSprintsTool } from '../tools/list-sprints.tool';
import { ListTasksTool } from '../tools/list-tasks.tool';
import { McpTool } from '../tools/tool.interface';
import { UpdateNotificationTool } from '../tools/update-notification.tool';
import { UpdateProjectTool } from '../tools/update-project.tool';
import { UpdateStatusTool } from '../tools/update-status.tool';
import { UpdateTaskTool } from '../tools/update-task.tool';

/**
 * Spec de consistencia generica: garante que toda tool registrada no
 * sistema (classe @Injectable McpTool) tem entrada CORRESPONDENTE em
 * `tools.schema.json` com `name`, `description` e `inputSchema` DEEP-EQUAL.
 *
 * Motivacao (R-3 do plano):
 *   `tools/list` retorna o schema cacheado do JSON; `tools/call` despacha
 *   pela classe. Drift entre os dois faz o LLM ver metadata divergente do
 *   comportamento real — falha silenciosa de protocolo.
 *
 * Como evoluir: cada nova tool registrada (Task #2-#8) deve ser adicionada
 * a este array. O spec entao valida automaticamente a paridade. Falha hard
 * se name ausente, description divergente ou inputSchema diferente.
 */

interface ToolSchemaEntry {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

const schemaEntries = toolsSchema.tools as ToolSchemaEntry[];

/**
 * Instancia cada tool com dependencias mockadas (qualquer valor — nao
 * vamos invocar `handler`). Apenas inspecionamos as propriedades
 * estaticas `name`/`description`/`inputSchema`.
 */
function buildRegisteredTools(): McpTool[] {
  const noop = {} as never;
  return [
    new ListTasksTool(noop, noop),
    new CreateTaskTool(noop, noop),
    new UpdateStatusTool(noop, noop),
    new ListProjectsTool(noop),
    new ListSprintsTool(noop, noop),
    new GetTaskTool(noop, noop),
    new UpdateTaskTool(noop, noop),
    new ListMembersTool(noop, noop),
    new GetProjectTool(noop, noop, noop),
    new UpdateProjectTool(noop),
    new ListNotificationsTool(noop),
    new UpdateNotificationTool(noop),
    new GetUnreadCountTool(noop),
  ];
}

describe('MCP tools.schema.json ↔ classes (consistencia)', () => {
  const registeredTools = buildRegisteredTools();

  it('toda tool registrada tem entrada correspondente em tools.schema.json', () => {
    for (const tool of registeredTools) {
      const entry = schemaEntries.find((e) => e.name === tool.name);
      expect(entry).toBeDefined();
    }
  });

  it('toda entrada de tools.schema.json corresponde a uma tool registrada', () => {
    for (const entry of schemaEntries) {
      const tool = registeredTools.find((t) => t.name === entry.name);
      expect(tool).toBeDefined();
    }
  });

  it('description bate 1:1 entre classe e JSON', () => {
    for (const tool of registeredTools) {
      const entry = schemaEntries.find((e) => e.name === tool.name);
      expect(entry?.description).toBe(tool.description);
    }
  });

  it('inputSchema bate (deep equal) entre classe e JSON', () => {
    for (const tool of registeredTools) {
      const entry = schemaEntries.find((e) => e.name === tool.name);
      expect(entry?.inputSchema).toEqual(tool.inputSchema);
    }
  });

  it('cardinalidade: numero de tools registradas == numero de entradas no JSON', () => {
    expect(registeredTools.length).toBe(schemaEntries.length);
  });

  it('nomes sao unicos no JSON (sem duplicatas)', () => {
    const names = schemaEntries.map((e) => e.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('nomes sao unicos nas classes (sem duplicatas)', () => {
    const names = registeredTools.map((t) => t.name);
    expect(new Set(names).size).toBe(names.length);
  });

  it('inclui get_task (Task #1)', () => {
    expect(schemaEntries.some((e) => e.name === 'get_task')).toBe(true);
    expect(registeredTools.some((t) => t.name === 'get_task')).toBe(true);
  });
});

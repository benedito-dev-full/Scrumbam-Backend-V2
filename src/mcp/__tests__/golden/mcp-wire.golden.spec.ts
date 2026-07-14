import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { join } from 'path';

import { CreateTaskTool } from '../../tools/create-task.tool';
import { ExecuteTaskTool } from '../../tools/execute-task.tool';
import { GetTaskTool } from '../../tools/get-task.tool';
import { McpUserContext } from '../../interfaces/mcp.types';
import { McpRouterService } from '../../services/mcp-router.service';

/**
 * GOLDEN TEST DO MCP — rede de nao-regressao do wire (Onda 0.1).
 *
 * Este teste CONGELA o comportamento observavel do servidor MCP HOJE, provado
 * com Claude Code / Claude Web (ADR-V2-071 transporte, ADR-V2-072 OAuth 2.1,
 * ADR-V2-073 GET SSE). Ele existe ANTES de qualquer migracao de tool
 * (unificacao Nexus <-> MCP, ADR-V2-079) e roda como gate de nao-regressao em
 * TODA onda subsequente.
 *
 * O QUE ELE PROVA:
 *  - `initialize` devolve o envelope exato (protocolVersion default, capabilities,
 *    serverInfo) — byte-a-byte semantico (JSON canonico + hash SHA-256 frozen).
 *  - `tools/list` devolve EXATAMENTE as 26 tools atuais (nome, description,
 *    inputSchema), identicas ao snapshot commitado `tools-list.baseline.json`,
 *    e com hash canonico frozen. (24 -> 26 na Onda 2, ver nota de re-baseline
 *    abaixo.)
 *  - Um conjunto REPRESENTATIVO de `tools/call` (1 read `get_task`, 1 write
 *    `create_task`, e `execute_task` com service MOCKADO — sem disparar a VPS)
 *    produz o envelope MCP exato de hoje.
 *
 * REGRA DA BASELINE INTOCAVEL:
 *  Este snapshot e a BASELINE INTOCAVEL. Ele DEVE falhar se qualquer resposta
 *  do MCP mudar — inclusive uma unica description. Se o wire mudar de PROPOSITO
 *  (ex: Onda 2 adiciona `create_comment`/`list_comments` ao `tools/list`), o
 *  re-baseline e um ATO EXPLICITO e REVISADO no PR:
 *    1. Confirmar que a mudanca do snapshot e SO o esperado.
 *    2. Regerar `tools-list.baseline.json` e atualizar as constantes `*_HASH` /
 *       `TOOLS_COUNT` abaixo.
 *    3. Reviewer confirma que nada alem do esperado mudou.
 *  NUNCA se re-baseliza o golden apenas para "fazer o CI passar".
 *
 * RE-BASELINE DA ONDA 2 (registrado — ATO EXPLICITO, nao acidente):
 *  `tools/list` cresceu de 24 -> 26 tools com a adicao de `create_comment` e
 *  `list_comments` ao FINAL do array (Onda 2 — bidirecionalidade: essas 2
 *  tools so existiam no Nexus, agora nascem tambem no MCP). Confirmado que as
 *  24 tools pre-existentes permanecem BYTE-IDENTICAS (mesma ordem, mesmo
 *  nome/description/inputSchema) — so a adicao mudou. `initialize` nao mudou
 *  (nao depende de tools). `tools/call` representativo (get_task/create_task/
 *  execute_task) nao mudou.
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 0.1 e Onda 2
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 */

// ─── Baseline FROZEN (intocavel — so muda por re-baseline explicito) ─────────

/** Numero de tools servidas hoje pelo `tools/list` (24 -> 26 na Onda 2). */
const FROZEN_TOOLS_COUNT = 26;

/** Hash canonico SHA-256 do payload de `initialize` (result). */
const FROZEN_INITIALIZE_HASH =
  '3eb52fbe08cb90ed3a3ef2f517c3fa66ea3002b6ab1ce83317367edbccebbe2d';

/**
 * Hash canonico SHA-256 do payload de `tools/list` (result) — 26 tools.
 * Re-baseline consciente 2026-07-13: merge trouxe a description atualizada de
 * `create_task` (mencao a `possibleDuplicates[]`, feature de deteccao de
 * duplicata do commit cbf8ca0). UNICA mudanca no wire (nomes/inputSchema/count
 * inalterados); nao e regressao — feature deliberada do remote.
 */
const FROZEN_TOOLS_LIST_HASH =
  '776cae433e7b3d97761be629ab299643644c1629325f1a068efe64246fdb88a2';

/** Hash canonico SHA-256 do array de NOMES das tools (ordem preservada) — Onda 2. */
const FROZEN_TOOL_NAMES_HASH =
  'd3145628a5d729311a3cae19a92384f6bd003d4ee8ee3774a5c5c49ff8b3fadd';

/**
 * Serializacao canonica (chaves ordenadas recursivamente) — torna o hash
 * estavel independentemente da ordem de insercao das chaves nos objetos.
 */
function canonicalize(value: unknown): string {
  if (Array.isArray(value)) {
    return '[' + value.map(canonicalize).join(',') + ']';
  }
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj).sort();
    return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalize(obj[k])).join(',') + '}';
  }
  return JSON.stringify(value);
}

function sha256(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

const userCtx: McpUserContext = {
  dEntidadeId: BigInt('9007199254740997'),
  scopes: ['tasks:read', 'tasks:write', 'executions:create'],
  keyChave: BigInt(10),
  keyPrefix: 'scrumban_mcp',
  keyHash: 'hash',
};

describe('MCP wire golden (baseline intocavel — nao-regressao ADR-V2-071/072/073)', () => {
  describe('initialize', () => {
    // `initialize` nao depende de nenhuma tool.
    const router = new McpRouterService();

    it('devolve o envelope exato (protocolVersion default, capabilities, serverInfo)', async () => {
      const res = await router.dispatch('initialize', undefined, userCtx);

      expect(res.result).toEqual({
        protocolVersion: '2024-11-05',
        capabilities: { tools: {} },
        serverInfo: { name: 'scrumban-mcp', version: '1.0.0' },
      });
    });

    it('bate com o hash canonico frozen (falha se o envelope mudar)', async () => {
      const res = await router.dispatch('initialize', undefined, userCtx);
      expect(sha256(canonicalize(res.result))).toBe(FROZEN_INITIALIZE_HASH);
    });
  });

  describe('tools/list', () => {
    const router = new McpRouterService();

    it('serve EXATAMENTE as 26 tools do snapshot commitado (nome/description/inputSchema)', async () => {
      const res = await router.dispatch('tools/list', undefined, userCtx);

      const baseline = JSON.parse(
        readFileSync(join(__dirname, 'tools-list.baseline.json'), 'utf8'),
      );

      expect(res.result).toEqual(baseline);
    });

    it('mantem a contagem frozen de tools (falha se adicionarem/removerem tool)', async () => {
      const res = await router.dispatch('tools/list', undefined, userCtx);
      const tools = (res.result as { tools: unknown[] }).tools;
      expect(tools).toHaveLength(FROZEN_TOOLS_COUNT);
    });

    it('mantem a lista de nomes frozen (ordem + conjunto)', async () => {
      const res = await router.dispatch('tools/list', undefined, userCtx);
      const names = (res.result as { tools: Array<{ name: string }> }).tools.map((t) => t.name);
      expect(sha256(canonicalize(names))).toBe(FROZEN_TOOL_NAMES_HASH);
    });

    it('bate com o hash canonico frozen do payload inteiro (falha se UMA description mudar)', async () => {
      const res = await router.dispatch('tools/list', undefined, userCtx);
      expect(sha256(canonicalize(res.result))).toBe(FROZEN_TOOLS_LIST_HASH);
    });
  });

  describe('tools/call representativo (wire congelado)', () => {
    it('READ get_task — envelope textResult exato', async () => {
      const taskId = '9007199254740993';
      const projectId = '9007199254740995';
      const tasksService = {
        findOne: jest.fn().mockResolvedValue({
          id: taskId,
          projectId,
          nome: 'Task de teste',
          status: 'INBOX',
        }),
      };
      const projectsService = {
        findAccessibleProjectIds: jest.fn().mockResolvedValue([projectId]),
      };
      const router = new McpRouterService(
        undefined,
        undefined,
        undefined,
        undefined,
        new GetTaskTool(tasksService as never, projectsService as never),
      );

      const res = await router.dispatch(
        'tools/call',
        { name: 'get_task', arguments: { taskId } },
        userCtx,
      );

      expect(res.result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              id: taskId,
              projectId,
              nome: 'Task de teste',
              status: 'INBOX',
            }),
          },
        ],
      });
    });

    it('WRITE create_task — envelope textResult exato', async () => {
      const projectId = '9007199254740995';
      const created = {
        id: '9007199254740993',
        identifier: 'SCR-1',
        nome: 'Nova task',
        status: 'INBOX',
        projectId,
      };
      const tasksService = { create: jest.fn().mockResolvedValue(created) };
      const projectsService = { findOne: jest.fn().mockResolvedValue({ id: projectId }) };

      const router = new McpRouterService(
        undefined,
        new CreateTaskTool(tasksService as never, projectsService as never),
      );

      const res = await router.dispatch(
        'tools/call',
        { name: 'create_task', arguments: { projectId, titulo: 'Nova task' } },
        userCtx,
      );

      expect(res.result).toEqual({
        content: [{ type: 'text', text: JSON.stringify(created) }],
      });
      // Confirma que a casca MCP repassa o DTO canonico (source='mcp') ao service.
      expect(tasksService.create).toHaveBeenCalledWith(
        expect.objectContaining({ projectId, nome: 'Nova task', source: 'mcp' }),
        userCtx.dEntidadeId,
      );
    });

    it('execute_task — envelope textResult exato com service MOCKADO (VPS NAO e disparada)', async () => {
      const taskId = '402';
      const projectId = '100';
      const tasksService = { findOne: jest.fn().mockResolvedValue({ id: taskId, projectId }) };
      const projectsService = { findOne: jest.fn().mockResolvedValue({ id: projectId }) };
      const executionsService = {
        // MOCK: nao ha chamada real a VPS nem persistencia de DPedido.
        execute: jest.fn().mockResolvedValue({
          id: '1000123',
          riskLevel: 'LOW',
          approval: { status: 'QUEUED' },
          createdAt: '2026-06-15T14:30:00.000Z',
        }),
      };
      const entidadeService = {
        getUserGroupIdFromEntidade: jest.fn().mockResolvedValue(BigInt(55)),
      };

      const router = new McpRouterService(
        // ExecuteTaskTool e o 16o parametro do construtor do router.
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
        new ExecuteTaskTool(
          tasksService as never,
          projectsService as never,
          executionsService as never,
          entidadeService as never,
        ),
      );

      const res = await router.dispatch(
        'tools/call',
        { name: 'execute_task', arguments: { taskId } },
        userCtx,
      );

      expect(res.result).toEqual({
        content: [
          {
            type: 'text',
            text: JSON.stringify({
              executionId: '1000123',
              taskId,
              projectId,
              status: 'QUEUED',
              riskLevel: 'LOW',
              riskClassId: '-301',
              createdAt: '2026-06-15T14:30:00.000Z',
              pollHint:
                'Use get_task(taskId) para acompanhar o status V3 (EXECUTING → DONE/FAILED). ' +
                'Se status=awaiting_approval, a execução está pausada pelo Risk Gate (MED/HIGH) ' +
                'e exige POST /executions/:id/approve fora do MCP.',
            }),
          },
        ],
      });
      // Confirma que a VPS NAO foi tocada de verdade — so o mock.
      expect(executionsService.execute).toHaveBeenCalledTimes(1);
    });
  });
});

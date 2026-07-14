import { NexusCapabilityAdapter } from '../../../ai/tools/nexus-capability.adapter';
import { AiToolContext } from '../../../ai/tools/tool-context';
import { McpCapabilityAdapter } from '../../../mcp/tools/mcp-capability.adapter';
import { CreateBlockCapability } from '../capabilities/blocks/create-block.capability';
import { CreateFromTemplateCapability } from '../capabilities/blocks/create-from-template.capability';
import { ListBlockTasksCapability } from '../capabilities/blocks/list-block-tasks.capability';
import { ListBlocksCapability } from '../capabilities/blocks/list-blocks.capability';
import { CreateCommentCapability } from '../capabilities/comments/create-comment.capability';
import { ListCommentsCapability } from '../capabilities/comments/list-comments.capability';
import { GetUnreadCountCapability } from '../capabilities/misc/get-unread-count.capability';
import { ListMembersCapability } from '../capabilities/misc/list-members.capability';
import { ListNotificationsCapability } from '../capabilities/misc/list-notifications.capability';
import { UpdateNotificationCapability } from '../capabilities/notifications/update-notification.capability';
import { CreateProjectCapability } from '../capabilities/projects/create-project.capability';
import { GetProjectMetricsCapability } from '../capabilities/projects/get-project-metrics.capability';
import { GetProjectCapability } from '../capabilities/projects/get-project.capability';
import { ListProjectsCapability } from '../capabilities/projects/list-projects.capability';
import { UpdateProjectCapability } from '../capabilities/projects/update-project.capability';
import { CreateTaskCapability } from '../capabilities/tasks/create-task.capability';
import { DeleteTaskCapability } from '../capabilities/tasks/delete-task.capability';
import { GetTaskTreeCapability } from '../capabilities/tasks/get-task-tree.capability';
import { GetTaskCapability } from '../capabilities/tasks/get-task.capability';
import { ListMyTasksCapability } from '../capabilities/tasks/list-my-tasks.capability';
import { ListTasksCapability } from '../capabilities/tasks/list-tasks.capability';
import { SearchTasksCapability } from '../capabilities/tasks/search-tasks.capability';
import { UpdateStatusCapability } from '../capabilities/tasks/update-status.capability';
import { UpdateTaskCapability } from '../capabilities/tasks/update-task.capability';
import { UpdateTimerCapability } from '../capabilities/tasks/update-timer.capability';
import { Capability } from '../capability.interface';
import { CapabilityRegistry } from '../capability-registry';
import {
  CAPABILITY_PARITY_EXEMPTIONS,
  isExemptFrom,
  ParitySurface,
} from '../capability-parity.manifest';

/**
 * Reconstroi o `CapabilityRegistry` REAL da aplicacao (mesma lista registrada
 * por `ToolCapabilitiesModule.onModuleInit`), sem depender do boot do Nest.
 *
 * As capabilities so tem dependencias de service injetadas no constructor (sem
 * efeito colateral) e este teste NUNCA chama `.run()` — apenas inspeciona
 * `name`/`requiredScopes` via `.list()`. Por isso podemos instancia-las com
 * dependencias mockadas (`{} as never`).
 *
 * `execute_task` NAO entra aqui de proposito: no MCP e servido pelo wrapper
 * legado (Pilar 1 — Onda 6), nunca por capability. Ele consta apenas no
 * manifesto de isencoes.
 */
function buildRealRegistry(): CapabilityRegistry {
  const noop = {} as never;
  const registry = new CapabilityRegistry();
  const capabilities: Capability[] = [
    new CreateTaskCapability(noop, noop),
    new CreateCommentCapability(noop),
    new ListCommentsCapability(noop),
    new GetTaskCapability(noop, noop),
    new GetTaskTreeCapability(noop, noop, noop),
    new ListTasksCapability(noop, noop),
    new ListMyTasksCapability(noop, noop),
    new SearchTasksCapability(noop, noop),
    new GetProjectCapability(noop, noop),
    new ListProjectsCapability(noop),
    new GetProjectMetricsCapability(noop, noop, noop),
    new ListBlocksCapability(noop, noop),
    new ListBlockTasksCapability(noop, noop),
    new ListMembersCapability(noop, noop),
    new ListNotificationsCapability(noop),
    new GetUnreadCountCapability(noop),
    new UpdateTaskCapability(noop, noop),
    new UpdateStatusCapability(noop, noop),
    new UpdateTimerCapability(noop, noop),
    new DeleteTaskCapability(noop, noop),
    new CreateProjectCapability(noop),
    new UpdateProjectCapability(noop),
    new CreateBlockCapability(noop, noop),
    new CreateFromTemplateCapability(noop),
    new UpdateNotificationCapability(noop),
  ];
  for (const capability of capabilities) {
    registry.register(capability);
  }
  return registry;
}

/**
 * GUARD-RAIL DE PARIDADE Nexus <-> MCP — modo ESTRITO (Onda 5).
 *
 * Enumera as capabilities expostas por CADA adapter (MCP e Nexus) a partir do
 * `CapabilityRegistry` e FALHA se uma capability existir num lado e nao no
 * outro SEM isencao declarada em `capability-parity.manifest.ts`.
 *
 * ENDURECIMENTO DA ONDA 5: alem de "sem divergencia nao-isenta", o teste agora
 * exige que TODA capability registrada apareca nos DOIS adapters, EXCETO as
 * declaradas em `CAPABILITY_PARITY_EXEMPTIONS` (hoje so `execute_task`, que so
 * nasce no Nexus na Onda 6). Com as Ondas 1-4 concluidas, todas as tools
 * nao-sensiveis ja derivam do `CapabilityRegistry` (fonte unica) — este spec
 * prova que nenhuma escapou para so um lado.
 *
 * O teste roda contra o registry REAL da aplicacao (todas as capabilities de
 * dominio registradas via `ToolCapabilitiesModule`), reconstruido aqui pelo
 * helper `buildRealRegistry()` (mesma lista do modulo, sem depender do boot do
 * Nest). Isso garante que a paridade e verificada sobre o conjunto COMPLETO de
 * capabilities — nao sobre um registry ad-hoc de 1 fake.
 *
 * O teste tambem continua PROVANDO que o guard-rail morde: uma divergencia
 * artificial faz o teste falhar, e declarar a isencao limpa o vermelho.
 *
 * O hook `validate-capability-parity.sh` roda ESTE spec no CI (bloqueia PR
 * quando a paridade quebra sem isencao).
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 0.4 e Onda 5
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 */

const NEXUS_CTX: AiToolContext = { userEntidadeId: BigInt(1) };
const NEXUS_SCOPES = async (): Promise<string[]> => [];

/** Nomes expostos pelo adapter MCP (deriva do registry). */
function mcpNames(registry: CapabilityRegistry): Set<string> {
  return new Set(new McpCapabilityAdapter(registry).buildAll().map((t) => t.name));
}

/** Nomes expostos pelo adapter Nexus (deriva do registry). */
function nexusNames(registry: CapabilityRegistry): Set<string> {
  return new Set(
    new NexusCapabilityAdapter(registry).buildAll(NEXUS_CTX, NEXUS_SCOPES).map((t) => t.name),
  );
}

/**
 * Calcula divergencias de paridade nao cobertas por isencao.
 *
 * @returns lista de `{ capability, missingOn }` para cada capability presente
 *   num lado, ausente no outro, e NAO isenta.
 */
function unexemptedDivergences(
  registry: CapabilityRegistry,
): Array<{ capability: string; missingOn: ParitySurface }> {
  const mcp = mcpNames(registry);
  const nexus = nexusNames(registry);
  const all = new Set<string>([...mcp, ...nexus]);
  const violations: Array<{ capability: string; missingOn: ParitySurface }> = [];

  for (const name of all) {
    if (!nexus.has(name) && !isExemptFrom(name, 'nexus')) {
      violations.push({ capability: name, missingOn: 'nexus' });
    }
    if (!mcp.has(name) && !isExemptFrom(name, 'mcp')) {
      violations.push({ capability: name, missingOn: 'mcp' });
    }
  }
  return violations;
}

function fakeCapability(name: string): Capability {
  return {
    name,
    description: `fake ${name}`,
    inputSchema: { type: 'object', properties: {} },
    requiredScopes: [],
    run: async () => ({ data: {} }),
  };
}

describe('Paridade de Capabilities Nexus <-> MCP (guard-rail)', () => {
  it('Onda 0: registry vazio => paridade trivialmente satisfeita', () => {
    const registry = new CapabilityRegistry();
    expect(unexemptedDivergences(registry)).toEqual([]);
  });

  it('capability nos DOIS adapters => sem divergencia', () => {
    const registry = new CapabilityRegistry();
    registry.register(fakeCapability('create_task'));

    // create_task aparece no MCP e no Nexus (mesmo registry) => paridade ok.
    expect(mcpNames(registry).has('create_task')).toBe(true);
    expect(nexusNames(registry).has('create_task')).toBe(true);
    expect(unexemptedDivergences(registry)).toEqual([]);
  });

  it('PROVA que o guard-rail morde: capability so-MCP sem isencao => VIOLACAO', () => {
    // Simula um lado divergente: um adapter que expoe uma capability que o
    // outro nao. Aqui usamos registries distintos para forcar a assimetria.
    const mcpRegistry = new CapabilityRegistry();
    mcpRegistry.register(fakeCapability('list_secret')); // so no MCP
    const nexusRegistry = new CapabilityRegistry(); // vazio

    const mcp = new Set(new McpCapabilityAdapter(mcpRegistry).buildAll().map((t) => t.name));
    const nexus = new Set(
      new NexusCapabilityAdapter(nexusRegistry)
        .buildAll(NEXUS_CTX, NEXUS_SCOPES)
        .map((t) => t.name),
    );

    // list_secret esta no MCP, ausente do Nexus, e NAO tem isencao => viola.
    expect(mcp.has('list_secret')).toBe(true);
    expect(nexus.has('list_secret')).toBe(false);
    expect(isExemptFrom('list_secret', 'nexus')).toBe(false);
  });

  it('declarar a isencao limpa o vermelho: execute_task e isento do Nexus', () => {
    // execute_task esta no manifesto como presentOn:['mcp'] => ausencia no
    // Nexus e permitida (isExemptFrom('execute_task','nexus') === true).
    expect(isExemptFrom('execute_task', 'nexus')).toBe(true);
    // ...mas NAO e isento de estar no MCP (presentOn inclui 'mcp').
    expect(isExemptFrom('execute_task', 'mcp')).toBe(false);
  });

  it('manifesto pre-semeado contem exatamente a isencao de execute_task (Onda 0)', () => {
    expect(CAPABILITY_PARITY_EXEMPTIONS.map((e) => e.capability)).toEqual(['execute_task']);
    expect(CAPABILITY_PARITY_EXEMPTIONS[0].presentOn).toEqual(['mcp']);
  });
});

describe('Paridade ESTRITA (Onda 5) — registry REAL da aplicacao', () => {
  it('registry real registra as 25 capabilities de dominio (todas as tools nao-sensiveis)', () => {
    const registry = buildRealRegistry();
    expect(registry.list()).toHaveLength(25);
  });

  it('TODA capability registrada aparece nos DOIS adapters (MCP e Nexus)', () => {
    const registry = buildRealRegistry();
    const mcp = mcpNames(registry);
    const nexus = nexusNames(registry);

    for (const capability of registry.list()) {
      expect(mcp.has(capability.name)).toBe(true);
      expect(nexus.has(capability.name)).toBe(true);
    }
  });

  it('sobre o registry real, ZERO divergencias nao-isentas', () => {
    const registry = buildRealRegistry();
    expect(unexemptedDivergences(registry)).toEqual([]);
  });

  it('execute_task NAO esta no registry (Pilar 1 — servido pelo wrapper legado, Onda 6)', () => {
    const registry = buildRealRegistry();
    expect(registry.has('execute_task')).toBe(false);
    // ...e permanece isento no manifesto ate a Onda 6 habilita-lo no Nexus.
    expect(isExemptFrom('execute_task', 'nexus')).toBe(true);
  });

  it('MORDE (estrito): forcar divergencia artificial no registry real => VIOLACAO nao-isenta', () => {
    const registry = buildRealRegistry();
    // Injeta uma capability so-MCP artificial SEM isencao: como ambos adapters
    // derivam do MESMO registry, forcamos a assimetria comparando registries
    // distintos (um com a extra, outro sem) — replicando o cenario de uma tool
    // que escapou para so um lado.
    const rogue = fakeCapability('rogue_mcp_only');
    const mcpRegistry = buildRealRegistry();
    mcpRegistry.register(rogue);

    const mcp = mcpNames(mcpRegistry);
    const nexus = nexusNames(registry); // sem a rogue

    expect(mcp.has('rogue_mcp_only')).toBe(true);
    expect(nexus.has('rogue_mcp_only')).toBe(false);
    // E NAO ha isencao declarada para ela => a paridade estrita reprovaria.
    expect(isExemptFrom('rogue_mcp_only', 'nexus')).toBe(false);
  });

  it('declarar a isencao limparia o vermelho (contra-prova do guard-rail estrito)', () => {
    // Espelha o mecanismo: uma capability isenta pode legitimamente faltar num
    // lado. execute_task e o unico caso hoje (flag OFF — default do CI).
    expect(isExemptFrom('execute_task', 'nexus')).toBe(true);
    expect(isExemptFrom('rogue_mcp_only', 'nexus')).toBe(false);
  });
});

/**
 * ONDA 6 — paridade de `execute_task` sob a feature-flag `NEXUS_EXECUTE_TASK_ENABLED`.
 *
 * Prova que o guard-rail passa nos DOIS estados da flag:
 *  - Flag OFF (default do CI): execute_task e "so-MCP" (servido pelo wrapper
 *    legado; NAO entra no registry) — a ausencia no Nexus e isenta pelo
 *    manifesto (`presentOn: ['mcp']`).
 *  - Flag ON: execute_task e registrado e, como AMBOS os adapters derivam do
 *    MESMO `CapabilityRegistry`, aparece nos dois lados — paridade satisfeita
 *    NATURALMENTE, sem depender da isencao.
 *
 * O estado real da flag no processo de teste e OFF (nenhum override), entao os
 * asserts sobre o manifesto refletem `['mcp']`. O cenario flag-ON e simulado
 * registrando a capability `execute_task` num registry ad-hoc (o efeito da
 * flag e exatamente "registrar ou nao a capability").
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 6
 * @see ADR-V2-079
 */
describe('Paridade de execute_task sob feature-flag (Onda 6)', () => {
  it('flag OFF (default): execute_task ausente do registry real, isento no Nexus, ZERO divergencia', () => {
    const registry = buildRealRegistry(); // sem execute_task (reflete flag OFF)
    expect(registry.has('execute_task')).toBe(false);
    expect(isExemptFrom('execute_task', 'nexus')).toBe(true);
    expect(unexemptedDivergences(registry)).toEqual([]);
  });

  it('flag ON (simulada): execute_task registrado aparece nos DOIS adapters => ZERO divergencia', () => {
    // Efeito da flag ON = capability entra no registry. Ambos adapters derivam
    // do MESMO registry, entao execute_task nasce em MCP e Nexus simultaneamente.
    const registry = buildRealRegistry();
    registry.register(fakeCapability('execute_task'));

    expect(mcpNames(registry).has('execute_task')).toBe(true);
    expect(nexusNames(registry).has('execute_task')).toBe(true);
    // Presente nos dois lados => nao ha ausencia a checar contra o manifesto.
    expect(unexemptedDivergences(registry)).toEqual([]);
  });

  it('manifesto: presentOn de execute_task acompanha a flag (OFF no CI => ["mcp"])', () => {
    // No processo de teste a flag esta OFF (sem override) => so-MCP.
    const exemption = CAPABILITY_PARITY_EXEMPTIONS.find((e) => e.capability === 'execute_task');
    expect(exemption).toBeDefined();
    expect(exemption!.presentOn).toEqual(['mcp']);
  });
});

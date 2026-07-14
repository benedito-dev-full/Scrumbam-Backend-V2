/**
 * Manifesto de ISENCOES de paridade Nexus <-> MCP (guard-rail da Onda 0.4).
 *
 * O teste de paridade (`capability-parity.spec.ts`) e o hook associado FALHAM o
 * CI quando uma capability aparece num adapter (MCP ou Nexus) e nao no outro
 * SEM estar declarada aqui. Uma isencao e uma decisao CONSCIENTE, revisada e
 * documentada — nao um jeito de silenciar o vermelho.
 *
 * Estado na Onda 0: o `CapabilityRegistry` esta VAZIO, entao a paridade e
 * trivialmente satisfeita. A unica isencao pre-semeada e `execute_task`, que
 * so e habilitada no Nexus na Onda 6 (atras de feature-flag +
 * `executions:create` + confirmacao explicita no chat).
 *
 * ONDA 6 — isencao TORNADA CONDICIONAL A FLAG: a isencao de `execute_task`
 * vale enquanto a feature-flag `NEXUS_EXECUTE_TASK_ENABLED` esta OFF (default) —
 * ai a capability e legitimamente "so-MCP" (servida pelo wrapper legado; nao
 * entra no `CapabilityRegistry`). Quando a flag esta ON, a capability e
 * registrada e passa a aparecer nos DOIS adapters derivados do registry, logo
 * a paridade e satisfeita SEM isencao — e `presentOn` reflete `['mcp','nexus']`.
 * A logica abaixo le a flag para manter o manifesto fiel ao estado real em
 * ambos os casos (o teste de paridade prova os dois).
 *
 * @see plan-agents-unificacao-nexus-mcp-EXECUCAO-task2.md — Onda 0.4 e Onda 6
 * @see ADR-V2-079 (camada unica de Capabilities Nexus <-> MCP)
 */

import { NEXUS_EXECUTE_TASK_ENABLED } from './execute-task.flag';

/** Superficies em que uma capability pode existir. */
export type ParitySurface = 'mcp' | 'nexus';

/**
 * Uma isencao declarada de paridade: uma capability que, de PROPOSITO, existe
 * apenas em `presentOn` (e legitimamente ausente na outra superficie ate a
 * onda de habilitacao indicada em `reason`).
 */
export interface ParityExemption {
  /** Nome canonico snake_case da capability. */
  readonly capability: string;
  /** Superficie(s) onde a capability DEVE existir (a ausencia na outra e ok). */
  readonly presentOn: readonly ParitySurface[];
  /** Justificativa + onda de resolucao planejada. Referenciar ADR-V2-079. */
  readonly reason: string;
}

/**
 * Lista de isencoes vigentes.
 *
 * `execute_task` (Onda 6): a isencao e CONDICIONAL a feature-flag
 * `NEXUS_EXECUTE_TASK_ENABLED` (ADR-V2-079):
 *  - Flag OFF (default): `presentOn: ['mcp']` — a capability e legitimamente
 *    "so-MCP" (servida pelo wrapper legado; nao entra no `CapabilityRegistry`).
 *    A ausencia no Nexus e isenta.
 *  - Flag ON: `presentOn: ['mcp','nexus']` — a capability e registrada e aparece
 *    nos DOIS adapters derivados do registry; NAO ha ausencia a isentar (a
 *    paridade e satisfeita naturalmente). A entrada permanece so para
 *    documentar o estado; `isExemptFrom(...)` retorna false em ambas superficies.
 *
 * Adicionar/remover uma entrada aqui e um ATO REVISADO no PR.
 */
export const CAPABILITY_PARITY_EXEMPTIONS: readonly ParityExemption[] = [
  {
    capability: 'execute_task',
    presentOn: NEXUS_EXECUTE_TASK_ENABLED ? ['mcp', 'nexus'] : ['mcp'],
    reason:
      'execute_task dispara claude -p na VPS (DPedido -300..-303, custo real + efeito externo). ' +
      'So-MCP enquanto NEXUS_EXECUTE_TASK_ENABLED=OFF (default). Com a flag ON (Onda 6) e ' +
      'habilitada no Nexus atras de scope executions:create + confirmacao explicita no chat ' +
      '(ADR-V2-079, ADR-V2-066/067).',
  },
];

/**
 * Indexa as isencoes por nome de capability, para consulta O(1) no teste de
 * paridade.
 */
export function exemptionByCapability(): Map<string, ParityExemption> {
  const map = new Map<string, ParityExemption>();
  for (const exemption of CAPABILITY_PARITY_EXEMPTIONS) {
    map.set(exemption.capability, exemption);
  }
  return map;
}

/**
 * Determina se uma capability esta isenta de aparecer numa dada superficie.
 *
 * @param capability - Nome canonico snake_case.
 * @param missingOn  - Superficie onde a capability esta AUSENTE.
 * @returns `true` se a ausencia em `missingOn` esta coberta por uma isencao
 *   (ou seja, a isencao declara que a capability so existe na(s) outra(s)
 *   superficie(s)).
 */
export function isExemptFrom(capability: string, missingOn: ParitySurface): boolean {
  const exemption = exemptionByCapability().get(capability);
  if (!exemption) {
    return false;
  }
  // A ausencia e permitida se a superficie ausente NAO esta na lista presentOn.
  return !exemption.presentOn.includes(missingOn);
}

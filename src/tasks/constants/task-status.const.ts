/**
 * FONTE ÚNICA dos status V3 Intention do Scrumban (poda 9 → 5).
 *
 * Antes desta constante o catálogo de status vivia DUPLICADO em ~8 lugares
 * (seed, 2 services de bootstrap, 2 DTOs, tool-params do MCP, 5 capabilities,
 * mapas de métricas). Cada cópia podia divergir — e divergiu: `VALIDATING`
 * contava como CONCLUÍDO em `delay-justifications/overdue.util.ts` e como
 * PENDENTE em `tasks/services/phase-metrics.service.ts`, fazendo a MESMA task
 * produzir dois números diferentes.
 *
 * **Os 5 estados canônicos:**
 *
 * | Código      | DClasse | Semântica                                        |
 * |-------------|---------|--------------------------------------------------|
 * | `INBOX`     | -441    | Capturada, ainda não priorizada (estado inicial). |
 * | `READY`     | -442    | Priorizada, na fila.                              |
 * | `EXECUTING` | -443    | Em andamento.                                     |
 * | `DONE`      | -444    | Concluída (ÚNICO estado de conclusão).            |
 * | `FAILED`    | -445    | Falhou. Escrito só pela automação — badge, não coluna. |
 *
 * **Removidos** (`VALIDATING` -448, `VALIDATED` -449, `CANCELLED` -446,
 * `DISCARDED` -447): nasceram de um PRD legado (fluxo "DONE → VALIDATING →
 * VALIDATED, stakeholder aprova") que nunca foi implementado — ZERO produtores
 * no código de produção, ZERO ADR justificando. Causavam dano real: o MCP
 * expunha os 9 no enum de `update_status`, e IAs escolhiam o que "soava certo",
 * prendendo tasks humanas em VALIDATING — um estado que ninguém consome.
 *
 * **Regra:** qualquer código que precise conhecer status V3 importa DAQUI.
 * Não recrie listas locais.
 */

/** Os 5 códigos V3 canônicos. Ordem = fluxo natural do board. */
export const V3_STATUS_CODES = ['INBOX', 'READY', 'EXECUTING', 'DONE', 'FAILED'] as const;

/** União de tipos dos status V3 — derivada de {@link V3_STATUS_CODES}. */
export type TaskStatus = (typeof V3_STATUS_CODES)[number];

/** Mapa código V3 → idClasse da DTabela de status (seed F1, DClasse -441..-445). */
export const STATUS_TO_TABELA_CLASSE: Record<TaskStatus, bigint> = {
  INBOX: BigInt(-441),
  READY: BigInt(-442),
  EXECUTING: BigInt(-443),
  DONE: BigInt(-444),
  FAILED: BigInt(-445),
};

/** idClasses das DTabelas de status V3 (-441..-445) — para filtros `in`. */
export const STATUS_V3_CLASSE_IDS: bigint[] = V3_STATUS_CODES.map(
  (code) => STATUS_TO_TABELA_CLASSE[code],
);

/** Mapa idClasse (string) → código V3. Inverso de {@link STATUS_TO_TABELA_CLASSE}. */
export const STATUS_ID_TO_CODE: Record<string, TaskStatus> = Object.fromEntries(
  V3_STATUS_CODES.map((code) => [STATUS_TO_TABELA_CLASSE[code].toString(), code]),
) as Record<string, TaskStatus>;

/**
 * Defaults de DTabela semeados por projeto (bootstrap + seed-defaults).
 * Uma DTabela por status, com `dEntidadeId = projectId`.
 */
export const STATUS_V3_DEFAULTS: Array<{ idClasse: bigint; nome: string; codigo: TaskStatus }> =
  V3_STATUS_CODES.map((code) => ({
    idClasse: STATUS_TO_TABELA_CLASSE[code],
    nome: code,
    codigo: code,
  }));

/**
 * idClasses de status que contam como CONCLUÍDO nas métricas.
 *
 * Após a poda existe **um único** estado de conclusão: `DONE` (-444). Antes,
 * `VALIDATED` (-449) era somado junto em ~8 arquivos de métrica — fonte da
 * divergência de contagem. Se um dia surgir outro estado terminal, ele entra
 * AQUI e todas as métricas o herdam de graça.
 */
export const DONE_STATUS_IDS: bigint[] = [STATUS_TO_TABELA_CLASSE.DONE];

/**
 * Status V3 REMOVIDOS na poda 9 → 5.
 *
 * Existe para (a) o script de migração de dados e (b) os testes que provam que
 * o enum do MCP/Capabilities NÃO aceita mais estes códigos (a causa raiz).
 * **Nenhum código de produção deve aceitar, escrever ou semear estes valores.**
 */
export const REMOVED_V3_STATUS_CODES = [
  'VALIDATING',
  'VALIDATED',
  'CANCELLED',
  'DISCARDED',
] as const;

/** Type guard — `true` se a string é um status V3 válido. */
export function isV3StatusCode(value: string): value is TaskStatus {
  return (V3_STATUS_CODES as readonly string[]).includes(value);
}

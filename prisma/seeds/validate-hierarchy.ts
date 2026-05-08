/**
 * Validador puro de hierarquia de DClasses (Pilar 3 — Scrumban-Backend-V2).
 *
 * Modulo SEM I/O e SEM dependencia de Prisma — funcao pura sobre array de
 * `DClasseSeed`. Garante em tempo de import (antes de qualquer escrita no
 * banco) que o seed canonico esta integro:
 *
 *  - Toda `chave` e numero NEGATIVO (chaves positivas sao runtime, nunca seed).
 *  - Nao ha duplicatas de `chave`.
 *  - Apenas Root (-1) tem `idPai === null` (raiz unica da arvore).
 *  - Todo `idPai` (nao null) aponta para uma `chave` existente no array.
 *  - Nao ha ciclos na arvore (DFS marcado por estado).
 *  - Classes especificas-de-dominio NAO sequestram chaves canonicas
 *    Devari-Core (CANONICAL_RESERVED — protegidas por allowlist).
 *
 * Uso:
 *   ```ts
 *   import { validateHierarchy } from './validate-hierarchy';
 *   import { classes } from './classes.seed';
 *   validateHierarchy(classes); // throw em violacao, void em sucesso
 *   ```
 *
 * Em qualquer violacao a funcao lanca `Error` com mensagem prefixada por
 * `[validate-hierarchy]` para diagnostico imediato em CI/seed-runner.
 *
 * @see prisma/seeds/classes.seed.ts (consumidor)
 * @see prisma/seeds/__tests__/validate-hierarchy.spec.ts (testes unit)
 * @see docs/decisions/ADR-V2-021-validador-hierarquia-puro.md (decisao)
 * @see docs/decisions/ADR-V2-022-renumeracao-corte-limpo.md (CANONICAL_RESERVED)
 */

import type { DClasseSeed } from '../../templates/classes-base-template';

export type { DClasseSeed };

/**
 * Chaves canonicas Devari-Core que NAO podem ser sequestradas por classes
 * especificas-de-dominio (corte limpo — ADR-V2-002 / ADR-V2-022).
 *
 * Lista completa do bloco "core" (referencia documental):
 *   -40  DISPONIVEIS       (legitimamente nas classesFixas Devari-Core)
 *   -45  MARKETPLACE       (uso fintech Dinpayz)
 *   -47  SELLER            (uso fintech Dinpayz)
 *   -49  PLATAFORMA        (uso fintech Dinpayz)
 *   -50  COMPRADOR         (uso fintech Dinpayz)
 *
 * @see SEQUESTRABLE_KEYS abaixo — subconjunto efetivamente checado
 *      em runtime (-40 e legitima e ja vem das classesFixas; checa-la
 *      como sequestro causaria falso positivo).
 */
export const CANONICAL_RESERVED: ReadonlyArray<bigint> = Object.freeze([
  -40n,
  -45n,
  -47n,
  -49n,
  -50n,
]);

/**
 * Subconjunto de CANONICAL_RESERVED efetivamente bloqueado por
 * `validateHierarchy()`. Sao chaves Devari-Core fintech (Dinpayz) que NAO
 * estao nas classesFixas universais — qualquer aparicao em seed
 * Scrumban-V2 e sequestro. -40 (DISPONIVEIS) e excluida porque ja vem
 * legitimamente das classesFixas (ver `templates/classes-base-template.ts:246`).
 */
const SEQUESTRABLE_KEYS: ReadonlyArray<bigint> = Object.freeze([-45n, -47n, -49n, -50n]);

/**
 * Chaves canonicas (range -1..-110) que JA estao no template fixo do
 * Devari-Core. Geradas dinamicamente para evitar drift quando o template
 * crescer — o consumidor do validador passa o array completo (fixas +
 * especificas), e o validador identifica fixas pela origem (range).
 *
 * Regra operacional: chaves no range [-110, -1] sao consideradas pertencentes
 * ao template fixo. Especificas Scrumban-V2 vivem no range -150..-999.
 */
const FIXED_RANGE_MIN = -110n;
const FIXED_RANGE_MAX = -1n;

/**
 * Estados de marcacao usados no DFS de deteccao de ciclos.
 * - UNVISITED: ainda nao visitado.
 * - VISITING:  na pilha atual de descida (se reencontrado, ha ciclo).
 * - VISITED:   ja totalmente processado.
 */
type DfsState = 0 | 1 | 2;
const UNVISITED: DfsState = 0;
const VISITING: DfsState = 1;
const VISITED: DfsState = 2;

/**
 * Normaliza chave para BigInt aceitando number ou bigint.
 *
 * @param value - valor de origem (number ou bigint).
 * @returns chave normalizada como bigint.
 */
function toBigInt(value: number | bigint): bigint {
  return typeof value === 'bigint' ? value : BigInt(value);
}

/**
 * Valida hierarquia completa do array de DClasses do seed.
 *
 * Executa em ordem 6 checagens; na primeira violacao, lanca `Error`
 * com diagnostico claro e nao prossegue para as demais. Complexidade
 * total O(N) com 1 unica passada por elemento (DFS amortizado).
 *
 * @param classes - array de seeds (fixas + especificas).
 * @throws Error com prefixo `[validate-hierarchy]` em qualquer violacao.
 *
 * @example
 * ```ts
 * import { validateHierarchy } from './validate-hierarchy';
 * import { classesFixas } from '../../templates/classes-base-template';
 *
 * // ok
 * validateHierarchy(classesFixas);
 *
 * // erro: idPai inexistente
 * validateHierarchy([
 *   { chave: -1, codigo: 'ROOT', nome: 'Root', idPai: null, agrupamento: true,
 *     inativo: false, excluido: false, excluivel: false, editavel: false,
 *     tableFields: null, baseFields: false },
 *   { chave: -200, codigo: 'X', nome: 'X', idPai: -9999, agrupamento: false,
 *     inativo: false, excluido: false, excluivel: false, editavel: false,
 *     tableFields: null, baseFields: false },
 * ]);
 * // -> throw "[validate-hierarchy] idPai inexistente em: -200(X)->-9999"
 * ```
 */
export function validateHierarchy(classes: ReadonlyArray<DClasseSeed>): void {
  if (!Array.isArray(classes) || classes.length === 0) {
    throw new Error('[validate-hierarchy] array de classes vazio ou invalido');
  }

  // (a) toda chave e negativa
  const positiveOrZero = classes.filter((c) => toBigInt(c.chave) >= 0n);
  if (positiveOrZero.length > 0) {
    throw new Error(
      `[validate-hierarchy] chaves nao-negativas detectadas: ` +
        positiveOrZero.map((c) => `${c.chave}(${c.codigo})`).join(', ') +
        ` — seeds devem ser SEMPRE chaves negativas (ADR-V2-022)`,
    );
  }

  // (b) sem duplicatas
  const seen = new Set<string>();
  const duplicates: DClasseSeed[] = [];
  for (const c of classes) {
    const key = toBigInt(c.chave).toString();
    if (seen.has(key)) {
      duplicates.push(c);
    } else {
      seen.add(key);
    }
  }
  if (duplicates.length > 0) {
    throw new Error(
      `[validate-hierarchy] chave(s) duplicada(s): ` +
        duplicates.map((c) => `${c.chave}(${c.codigo})`).join(', '),
    );
  }

  // (c) apenas Root (-1) com idPai === null
  const roots = classes.filter((c) => c.idPai === null);
  if (roots.length !== 1) {
    throw new Error(
      `[validate-hierarchy] deve haver exatamente 1 root com idPai=null. ` +
        `Encontrados: ${roots.length} (` +
        roots.map((r) => `${r.chave}(${r.codigo})`).join(', ') +
        `)`,
    );
  }
  if (toBigInt(roots[0].chave) !== -1n) {
    throw new Error(
      `[validate-hierarchy] root deve ter chave=-1 (ROOT canonico). ` +
        `Encontrado: ${roots[0].chave}(${roots[0].codigo})`,
    );
  }

  // (d) todo idPai (nao null) aponta para uma chave existente
  const chavesExistentes = new Set(classes.map((c) => toBigInt(c.chave).toString()));
  const orfaos = classes.filter(
    (c) => c.idPai !== null && !chavesExistentes.has(toBigInt(c.idPai).toString()),
  );
  if (orfaos.length > 0) {
    throw new Error(
      `[validate-hierarchy] idPai inexistente em: ` +
        orfaos.map((o) => `${o.chave}(${o.codigo})->${o.idPai}`).join(', '),
    );
  }

  // (e) sem ciclos (DFS por estado)
  const indexByChave = new Map<string, number>();
  classes.forEach((c, idx) => {
    indexByChave.set(toBigInt(c.chave).toString(), idx);
  });
  const states: DfsState[] = new Array(classes.length).fill(UNVISITED);
  const cyclePath: string[] = [];

  const dfs = (idx: number, path: string[]): boolean => {
    if (states[idx] === VISITING) {
      cyclePath.push(...path, `${classes[idx].chave}(${classes[idx].codigo})`);
      return true;
    }
    if (states[idx] === VISITED) {
      return false;
    }
    states[idx] = VISITING;
    const cur = classes[idx];
    if (cur.idPai !== null) {
      const parentIdx = indexByChave.get(toBigInt(cur.idPai).toString());
      if (parentIdx !== undefined) {
        const nextPath = [...path, `${cur.chave}(${cur.codigo})`];
        if (dfs(parentIdx, nextPath)) return true;
      }
    }
    states[idx] = VISITED;
    return false;
  };

  for (let i = 0; i < classes.length; i++) {
    if (states[i] === UNVISITED) {
      if (dfs(i, [])) {
        throw new Error(
          `[validate-hierarchy] ciclo detectado em hierarquia: ` + cyclePath.join(' -> '),
        );
      }
    }
  }

  // (f) chaves Devari-Core fintech (-45/-47/-49/-50) NAO podem ser
  //     sequestradas por seeds Scrumban-V2. Diferente de -40 (DISPONIVEIS,
  //     legitimo nas classesFixas), estas NAO existem nas fixas — qualquer
  //     aparicao em seed e violacao.
  const sequestrableSet = new Set(SEQUESTRABLE_KEYS.map((k) => k.toString()));
  const sequestros = classes.filter((c) => sequestrableSet.has(toBigInt(c.chave).toString()));
  if (sequestros.length > 0) {
    throw new Error(
      `[validate-hierarchy] sequestro de chave canonica reservada Devari-Core: ` +
        sequestros.map((c) => `${c.chave}(${c.codigo})`).join(', ') +
        ` — chaves ${SEQUESTRABLE_KEYS.map((k) => k.toString()).join(', ')} ` +
        `sao reservadas para uso fintech do template Devari-Core (ADR-V2-022). ` +
        `Para Scrumban-V2 use a faixa -150..-527.`,
    );
  }

  // FIXED_RANGE_MIN/MAX permanecem documentando o range das fixas e podem
  // ser usados em validacoes futuras (ex: alertar se classes especificas
  // acidentalmente caem dentro da faixa do template).
  void FIXED_RANGE_MIN;
  void FIXED_RANGE_MAX;
}

/**
 * Fonte única das DClasses de TEMPLATE da feature Templates (ADR-V2-061).
 *
 * Arquivo "folha" — contém SOMENTE constantes `bigint` literais, sem nenhum
 * import de service/módulo. Isso evita ciclos de dependência (qualquer service
 * pode importar daqui sem arrastar grafo de providers).
 *
 * Usos:
 *  - Blindar as listagens "de trabalho" (`projects`, `search`, `folders`):
 *    templates -401/-402 NÃO aparecem como projeto navegável
 *    (`idClasse: { notIn: TEMPLATE_CLASSES }`).
 *  - Detectar o caminho de catálogo de templates (`GET /projects?idClasse=-401`).
 *  - Guarda de write-path: impedir que um template seja movido para pasta
 *    (`folders.moveProject`).
 */

/** idClasse DProject TEMPLATE_LIST (molde de Lista). */
export const ID_CLASSE_TEMPLATE_LIST = BigInt(-401);

/** idClasse DProject TEMPLATE_SPACE (molde de Espaço). */
export const ID_CLASSE_TEMPLATE_SPACE = BigInt(-402);

/**
 * Conjunto das DClasses de template (ADR-V2-061). Fonte única importada por
 * `projects.service`, `search.service`, `folders.service` e `analytics.service`.
 */
export const TEMPLATE_CLASSES: bigint[] = [ID_CLASSE_TEMPLATE_LIST, ID_CLASSE_TEMPLATE_SPACE];

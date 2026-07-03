import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma.service';

/** idClasse DProject para SPACE (ADR-V2-051 §3.2). Raiz da hierarquia — sem pai. */
export const ID_CLASSE_SPACE = BigInt(-350);

/**
 * Resolve se um projeto é publicamente visível por HERANÇA do SPACE raiz
 * (ADR-V2-051 §8).
 *
 * Sobe a hierarquia (`idPai`) via CTE recursiva a partir de `projectId` até a
 * raiz. Se a cadeia contém um SPACE (-350), usa o flag `privado` DELE — pois é
 * o SPACE que governa a visibilidade de todas as pastas e listas filhas. Se não
 * há SPACE na cadeia (projeto flat/legado), faz fallback para o `privado` do
 * próprio projeto (mesma semântica que `list()` Camada A para projetos sem
 * hierarquia).
 *
 * Esta é a fonte de verdade ÚNICA para "este projeto é público?" — consumida
 * por `ProjectsService.findOne` (abrir), `findAccessibleProjectIds` (tasks) e
 * `RoleResolverService.getProjectRole` (guard de mutação). Não checa membership
 * de org — isso é responsabilidade do caller (cada um já tem o contexto de org).
 *
 * @param prisma - PrismaService (suporta PrismaClient raiz)
 * @param projectId - `DProject.chave` do projeto-alvo
 * @returns `true` se o SPACE raiz (ou o próprio projeto, no fallback) é público
 *
 * @example
 * ```typescript
 * // LIST -352 filha de FOLDER -351 filha de SPACE -350 público:
 * const pub = await isProjectPubliclyVisible(prisma, BigInt(25)); // true
 * ```
 *
 * @see ADR-V2-051 §8 — Visibilidade de espaços (herança do SPACE)
 */
export async function isProjectPubliclyVisible(
  prisma: PrismaService,
  projectId: bigint,
): Promise<boolean> {
  const rows = await prisma.$queryRaw<Array<{ chave: bigint; idClasse: bigint; privado: boolean }>>`
    WITH RECURSIVE chain AS (
      SELECT "chave", "idPai", "idClasse", "privado"
      FROM "DProject"
      WHERE "chave" = ${projectId} AND "excluido" = false

      UNION ALL

      SELECT p."chave", p."idPai", p."idClasse", p."privado"
      FROM "DProject" p
      INNER JOIN chain c ON p."chave" = c."idPai"
      WHERE p."excluido" = false
    )
    SELECT "chave", "idClasse", "privado" FROM chain
  `;

  if (rows.length === 0) {
    return false;
  }

  // O SPACE raiz governa a visibilidade da cadeia inteira.
  const space = rows.find((r) => r.idClasse === ID_CLASSE_SPACE);
  if (space) {
    return space.privado === false;
  }

  // Fallback: projeto sem SPACE ancestral → usa o próprio flag.
  const self = rows.find((r) => r.chave === projectId);
  return self ? self.privado === false : false;
}

/**
 * Lista os IDs de TODOS os projetos pertencentes a SPACEs públicos de uma org
 * (o próprio SPACE + todas as pastas e listas descendentes), via CTE recursiva
 * descendente (ADR-V2-051 §8).
 *
 * Usado por `ProjectsService.findAccessibleProjectIds` para que membros da org
 * vejam (e operem) as tasks de listas dentro de espaços públicos SEM precisar de
 * DVincula de projeto. É a contraparte "em lote" de {@link isProjectPubliclyVisible}.
 *
 * @param prisma - PrismaService
 * @param orgId - `DEntidade.chave` da org (DProject.idEstab)
 * @returns IDs (BigInt) dos SPACEs públicos e de todos os seus descendentes
 *
 * @see ADR-V2-051 §8 — Visibilidade de espaços
 */
export async function listPublicSpaceProjectIds(
  prisma: PrismaService,
  orgId: bigint,
): Promise<bigint[]> {
  const rows = await prisma.$queryRaw<Array<{ chave: bigint }>>`
    WITH RECURSIVE pub AS (
      SELECT "chave"
      FROM "DProject"
      WHERE "idClasse" = ${ID_CLASSE_SPACE}
        AND "privado" = false
        AND "idEstab" = ${orgId}
        AND "excluido" = false

      UNION ALL

      SELECT p."chave"
      FROM "DProject" p
      INNER JOIN pub ON p."idPai" = pub."chave"
      WHERE p."excluido" = false
    )
    SELECT "chave" FROM pub
  `;

  return rows.map((r) => r.chave);
}

/**
 * Variante em LOTE de {@link listPublicSpaceProjectIds}: lista os IDs de TODOS
 * os projetos pertencentes a SPACEs públicos de UM CONJUNTO de orgs, numa única
 * query (CTE recursiva com `idEstab IN (...)`).
 *
 * Usada pelo caminho MCP/cross-org (ADR-V2-069), onde não há "org ativa" de
 * token — o contexto de org é derivado das *memberships* do usuário, que podem
 * abranger várias orgs. Mantém N+1 ZERO: uma só CTE cobre todas as orgs em vez
 * de N chamadas a `listPublicSpaceProjectIds`.
 *
 * Leak-free por construção: só retorna descendentes de SPACEs com
 * `privado = false`. O caller é responsável por restringir `orgIds` às orgs às
 * quais o usuário pertence (assim orgs alheias nunca entram).
 *
 * @param prisma - PrismaService
 * @param orgIds - `DEntidade.chave` das orgs (DProject.idEstab) do usuário
 * @returns IDs (BigInt) dos SPACEs públicos e de todos os seus descendentes.
 *   Array vazio quando `orgIds` é vazio (sem query ao banco).
 *
 * @see ADR-V2-069 — Camada A no caminho MCP (sem token de org)
 * @see listPublicSpaceProjectIds — variante single-org
 */
export async function listPublicSpaceProjectIdsForOrgs(
  prisma: PrismaService,
  orgIds: bigint[],
): Promise<bigint[]> {
  if (orgIds.length === 0) {
    return [];
  }

  const rows = await prisma.$queryRaw<Array<{ chave: bigint }>>`
    WITH RECURSIVE pub AS (
      SELECT "chave"
      FROM "DProject"
      WHERE "idClasse" = ${ID_CLASSE_SPACE}
        AND "privado" = false
        AND "idEstab" IN (${Prisma.join(orgIds)})
        AND "excluido" = false

      UNION ALL

      SELECT p."chave"
      FROM "DProject" p
      INNER JOIN pub ON p."idPai" = pub."chave"
      WHERE p."excluido" = false
    )
    SELECT "chave" FROM pub
  `;

  return rows.map((r) => r.chave);
}

/**
 * mcp-grandfather-scopes.ts
 *
 * Migração "grandfather" das MCP Keys existentes (ADR-V2-068, Fase 3).
 *
 * Contexto: a Fase 1 do Catálogo Canônico de Scopes MCP ativou enforcement
 * per-tool — cada tool agora exige um scope específico do catálogo
 * (`ALL_MCP_SCOPES` em `src/mcp/constants.ts`). Keys MCP criadas ANTES desse
 * catálogo existir podem ter scopes legados (ex: `tools:read`/`tools:call`)
 * ou nenhum scope gravado — e parariam de funcionar com o enforcement ativo.
 *
 * Este script reescreve `dados.scopes` de TODAS as MCP Keys (DTabela
 * idClasse=-472) para o conjunto completo de `ALL_MCP_SCOPES`
 * (ACESSO_TOTAL), preservando os demais campos de `dados` e registrando a
 * auditoria da migração diretamente no próprio `dados` (sem DEvento — fora
 * de escopo desta fase, ver mandato):
 *   - `dados.grandfatheredAt`      → ISO timestamp de quando a key foi migrada
 *   - `dados.scopesPreviousValue`  → array de scopes que a key tinha antes
 *
 * Idempotente: se a key já tem exatamente `ALL_MCP_SCOPES` (em qualquer
 * ordem), é pulada (`unchanged`) — rodar 2x não duplica auditoria nem
 * sobrescreve `scopesPreviousValue`/`grandfatheredAt` de uma migração anterior.
 *
 * Inclui keys revogadas/excluídas (`excluido=true`) deliberadamente — por
 * consistência de dados (não filtramos por `excluido`/`disabled`), embora
 * elas não sejam mais aceitas por `McpKeyService.validatePlaintext` de
 * qualquer forma (já bloqueadas por `excluido`/`inativo`/`disabled`).
 *
 * USO:
 *   DRY_RUN=1 npx ts-node scripts/mcp-grandfather-scopes.ts   # só imprime
 *   npx ts-node scripts/mcp-grandfather-scopes.ts             # grava
 *
 * Idempotência: SIM — rodar múltiplas vezes converge para o mesmo estado
 * (keys já com ACESSO_TOTAL são puladas).
 */
import { Prisma, PrismaClient } from '@prisma/client';

import { ALL_MCP_SCOPES, MCP_KEY_CLASS_ID, McpScope } from '../src/mcp/constants';

const prisma = new PrismaClient();

const DRY_RUN = process.env.DRY_RUN === '1';

/** Shape mínimo de `dados` relevante para esta migração (demais campos preservados via spread). */
type McpKeyDados = Record<string, unknown> & {
  scopes?: unknown;
  grandfatheredAt?: string;
  scopesPreviousValue?: string[];
};

/** Resultado de {@link computeGrandfatheredDados}: novo `dados` a persistir, ou `null` se nada muda. */
export type GrandfatherResult = Record<string, unknown> | null;

/**
 * Calcula o novo `dados` de uma MCP Key aplicando o grandfather de scopes —
 * lógica pura, sem I/O, testável isoladamente.
 *
 * Compara o `dados.scopes` atual (como SET, ordem irrelevante) contra
 * `allScopes`. Se já são exatamente iguais, retorna `null` (sentinela de
 * no-op — nada a persistir). Senão, retorna um novo objeto `dados` com:
 *   - todos os campos originais preservados (`...dados`)
 *   - `scopes` substituído pelo conjunto completo (`[...allScopes]`)
 *   - `grandfatheredAt` = `now` (ISO string)
 *   - `scopesPreviousValue` = scopes antigos (array; `[]` se ausente/inválido)
 *
 * @param dados - `dados` atual da DTabela (MCP Key), shape livre/legado
 * @param allScopes - catálogo canônico completo (`ALL_MCP_SCOPES`)
 * @param now - timestamp ISO a gravar em `grandfatheredAt` (injetável para testes)
 * @returns novo `dados` a persistir, ou `null` se a key já está com o full set
 *
 * @example
 * ```typescript
 * computeGrandfatheredDados({ scopes: ['tools:read', 'tools:call'] }, ALL_MCP_SCOPES, '2026-06-16T00:00:00.000Z');
 * // => { scopes: [...ALL_MCP_SCOPES], grandfatheredAt: '...', scopesPreviousValue: ['tools:read', 'tools:call'] }
 *
 * computeGrandfatheredDados({ scopes: [...ALL_MCP_SCOPES] }, ALL_MCP_SCOPES, '...');
 * // => null (já é full set — no-op)
 * ```
 */
export function computeGrandfatheredDados(
  dados: McpKeyDados | null | undefined,
  allScopes: readonly McpScope[],
  now: string,
): GrandfatherResult {
  const safeDados: McpKeyDados = dados && typeof dados === 'object' ? dados : {};

  const currentScopes: string[] = Array.isArray(safeDados.scopes)
    ? safeDados.scopes.filter((s): s is string => typeof s === 'string')
    : [];

  if (isSameScopeSet(currentScopes, allScopes)) {
    return null;
  }

  return {
    ...safeDados,
    scopes: [...allScopes],
    grandfatheredAt: now,
    scopesPreviousValue: currentScopes,
  };
}

/** Compara 2 listas de scopes como conjuntos (ignora ordem e duplicatas). */
function isSameScopeSet(a: string[], b: readonly string[]): boolean {
  if (a.length !== b.length) return false;
  const setA = new Set(a);
  const setB = new Set(b);
  if (setA.size !== setB.size) return false;
  for (const scope of setA) {
    if (!setB.has(scope)) return false;
  }
  return true;
}

async function main(): Promise<void> {
  console.log(`\n=== mcp-grandfather-scopes ${DRY_RUN ? '(DRY RUN)' : '(GRAVANDO)'} ===\n`);
  console.log(`Catálogo ACESSO_TOTAL (${ALL_MCP_SCOPES.length} scopes): ${ALL_MCP_SCOPES.join(', ')}\n`);

  // Inclui revogadas/excluídas deliberadamente — consistência de dados.
  const keys = await prisma.dTabela.findMany({
    where: { idClasse: MCP_KEY_CLASS_ID },
    select: { chave: true, codigo: true, dados: true },
    orderBy: { chave: 'asc' },
  });

  console.log(`Total de MCP Keys encontradas: ${keys.length}\n`);

  let updated = 0;
  let unchanged = 0;

  for (const key of keys) {
    const now = new Date().toISOString();
    const currentDados = (key.dados ?? {}) as McpKeyDados;
    const nextDados = computeGrandfatheredDados(currentDados, ALL_MCP_SCOPES, now);

    if (nextDados === null) {
      unchanged += 1;
      console.log(`  [unchanged] #${key.chave} (${key.codigo ?? 'sem prefix'}) — já é ACESSO_TOTAL`);
      continue;
    }

    const previousScopes = Array.isArray(currentDados.scopes) ? currentDados.scopes : [];
    console.log(
      `  [${DRY_RUN ? 'would-update' : 'update'}] #${key.chave} (${key.codigo ?? 'sem prefix'}) — scopes ${JSON.stringify(previousScopes)} → ACESSO_TOTAL`,
    );

    if (!DRY_RUN) {
      await prisma.dTabela.update({
        where: { chave: key.chave },
        data: { dados: nextDados as Prisma.InputJsonValue },
      });
    }

    updated += 1;
  }

  console.log('\n=== Resumo ===');
  console.log(`Total:      ${keys.length}`);
  console.log(`Atualizadas: ${updated}`);
  console.log(`Inalteradas: ${unchanged}`);
  console.log(DRY_RUN ? '\n(DRY RUN — nada foi gravado.)' : '\n✅ Concluído.');
}

// Só executa quando rodado diretamente (`ts-node scripts/...`). Ao ser
// importado por um spec (que coleta o helper puro), NÃO dispara o main() —
// evita tentar conectar no Prisma sem DATABASE_URL durante os testes.
if (require.main === module) {
  main()
    .catch((e) => {
      console.error('\n❌ ERRO:\n', e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}

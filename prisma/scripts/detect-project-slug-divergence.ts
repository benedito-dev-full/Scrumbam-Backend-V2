/**
 * Detecção (SOMENTE LEITURA) de `projectSlug` divergente entre o vínculo
 * projeto×agente e o projeto — ADR-V2-083 (Task 3, Fase 7).
 *
 * ## Contexto
 * Até a ADR-V2-083 havia DOIS slugs para o mesmo projeto:
 *  - `DProject.dados.slug` — único (`ProjectsService.deriveUniqueSlug`, trunca em
 *    50 e aplica sufixo de colisão `-2`, `-3`…); usado pelo DISPATCH da execução;
 *  - `DVincula(PROJECT_AGENT -185).metaDados.projectSlug` — slugify do NOME
 *    (trunca em 64, SEM sufixo); usado pelo PROVISION_PROJECT (seção
 *    `## <slug>` do CLAUDE.md global da VPS).
 * Dois projetos homônimos no mesmo agente recebiam o MESMO `projectSlug` ⇒ o
 * 2º provisionamento sobrescrevia a seção do 1º no CLAUDE.md da VPS ⇒ o projeto
 * A passava a executar no clone de B (falha de isolamento entre clientes).
 * O dispatch agora usa o slug do vínculo (o que a VPS conhece) e vínculos novos
 * nascem com `DProject.dados.slug`.
 *
 * ## O que o script relata (não escreve NADA)
 * 1. **Divergências:** vínculos cujo `projectSlug` ≠ `DProject.dados.slug`
 *    (informativo — o dispatch novo já usa o do vínculo).
 * 2. **Colisões por agente (CRÍTICO):** 2+ projetos DIFERENTES com o MESMO
 *    `projectSlug` no MESMO agente. Correção = re-provisionar os pares afetados
 *    (unlink + link + provision — runbook Fase 13), NUNCA UPDATE cego.
 * 3. **Vínculos sem `projectSlug` válido** (`^[a-z0-9-]{1,64}$`).
 *
 * Saída: JSON no stdout (via Logger) + exit code 2 se houver colisão.
 *
 * ## Uso
 * ```bash
 * npx ts-node prisma/scripts/detect-project-slug-divergence.ts
 * ```
 * O Implementer NÃO roda este script contra banco algum — execução é do CEO/ops
 * (dry-run por natureza; protocolo de migration).
 *
 * @see docs/decisions/ADR-V2-083-esteira-headless-contrato-verificavel.md
 * @see src/executions/processors/execution-run.processor.ts (resolveProjectSlug)
 * @see src/automation/project-agent/project-agent-link.service.ts
 */
import { Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

const logger = new Logger('detect-project-slug-divergence');
const prisma = new PrismaClient();

/** DClasse PROJECT_AGENT (DVincula) — ver `AUTOMATION_CLASS_IDS.PROJECT_AGENT`. */
const PROJECT_AGENT_CLASS = BigInt(-185);
const PROJECT_SLUG_RE = /^[a-z0-9-]{1,64}$/;

interface LinkRow {
  linkId: string;
  projectId: string;
  agentId: string;
  linkSlug: string | null;
  projectSlug: string | null;
  projectNome: string | null;
}

/**
 * Lê vínculos ativos + projetos em 2 queries (sem N+1) e classifica.
 *
 * @returns Relatório { totals, divergences, collisions, invalid }
 */
export async function detect(): Promise<{
  totals: { links: number; divergences: number; collisions: number; invalid: number };
  divergences: LinkRow[];
  collisions: Array<{ agentId: string; projectSlug: string; projectIds: string[] }>;
  invalid: LinkRow[];
}> {
  const links = await prisma.dVincula.findMany({
    where: { idClasse: PROJECT_AGENT_CLASS, excluido: false },
    select: { chave: true, idLocEscritu: true, idEntidade: true, metaDados: true },
  });
  const projectIds = [
    ...new Set(links.map((l) => l.idLocEscritu).filter((v): v is bigint => v !== null)),
  ];
  const projects = projectIds.length
    ? await prisma.dProject.findMany({
        where: { chave: { in: projectIds } },
        select: { chave: true, nome: true, dados: true },
      })
    : [];
  const byId = new Map(projects.map((p) => [p.chave.toString(), p]));

  const rows: LinkRow[] = links.map((l) => {
    const meta = (l.metaDados ?? {}) as Record<string, unknown>;
    const project = l.idLocEscritu !== null ? byId.get(l.idLocEscritu.toString()) : undefined;
    const pDados = (project?.dados ?? {}) as Record<string, unknown>;
    return {
      linkId: l.chave.toString(),
      projectId: l.idLocEscritu?.toString() ?? '',
      agentId: l.idEntidade?.toString() ?? '',
      linkSlug: typeof meta.projectSlug === 'string' ? meta.projectSlug : null,
      projectSlug: typeof pDados.slug === 'string' ? pDados.slug : null,
      projectNome: project?.nome ?? null,
    };
  });

  const invalid = rows.filter((r) => !r.linkSlug || !PROJECT_SLUG_RE.test(r.linkSlug));
  const divergences = rows.filter(
    (r) => r.linkSlug && r.projectSlug && r.linkSlug !== r.projectSlug,
  );

  const groups = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.linkSlug) continue;
    const key = `${r.agentId}::${r.linkSlug}`;
    const set = groups.get(key) ?? new Set<string>();
    set.add(r.projectId);
    groups.set(key, set);
  }
  const collisions = [...groups.entries()]
    .filter(([, ids]) => ids.size > 1)
    .map(([key, ids]) => {
      const [agentId, projectSlug] = key.split('::');
      return { agentId, projectSlug, projectIds: [...ids].sort() };
    });

  return {
    totals: {
      links: rows.length,
      divergences: divergences.length,
      collisions: collisions.length,
      invalid: invalid.length,
    },
    divergences,
    collisions,
    invalid,
  };
}

async function main(): Promise<void> {
  try {
    const report = await detect();
    logger.log(JSON.stringify(report, null, 2));
    if (report.collisions.length > 0) {
      logger.warn(
        `${report.collisions.length} colisão(ões) de projectSlug no mesmo agente — re-provisionar os pares (runbook Fase 13)`,
      );
      process.exitCode = 2;
    }
  } catch (err) {
    logger.error(`falha: ${err instanceof Error ? err.message : String(err)}`);
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}

if (require.main === module) {
  void main();
}

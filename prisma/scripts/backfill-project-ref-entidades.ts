/**
 * Backfill idempotente do handle canônico de projeto em DVincula
 * (ADR-V2-058 Fase 3 — DEntidade-espelho PROJECT_REF -158).
 *
 * ## Contexto
 * `DVincula.idLocEscritu` / `idEntidade` são FKs para `DEntidade.chave`, mas o
 * V2 (pré-Fase 2) gravava `DProject.chave` (`P`) nesses campos para quatro
 * famílias de vínculo project-scoped:
 *
 *   | Vínculo                    | idClasse        | Campo com P     |
 *   |----------------------------|-----------------|-----------------|
 *   | RBAC MANAGER/MEMBER/VIEWER | -171/-172/-173  | idLocEscritu    |
 *   | SPACE_PRIVATE_MEMBER       | -188            | idLocEscritu    |
 *   | PROJECT_TEAM_LINK          | -182            | idEntidade      |
 *   | FOLDER_PROJECT_LINK        | -183            | idEntidade      |
 *
 * Como `DProject` e `DEntidade` têm sequências de `chave` independentes, a FK
 * ora **quebrava** (500 em `POST /projects`), ora **passava por coincidência**
 * apontando para uma DEntidade aleatória (bug silencioso de RBAC/segurança).
 *
 * A Fase 2 corrigiu o caminho de ESCRITA (novos projetos já criam o espelho e
 * gravam `E`). Este script (Fase 3) cria os espelhos dos projetos LEGADOS e
 * **reescreve as linhas DVincula antigas** de `P → E`.
 *
 * ## O que o script faz (duas fases por execução)
 *
 * ### Fase A — Criar espelhos (-158) faltantes
 * Para cada `DProject` SEM `dados.entidadeRefId` (ou com ponteiro órfão), cria
 * a DEntidade-espelho (`idClasse=-158`, `nome=project.nome`,
 * `idEstab=project.idEstab`, `dados.projectId=project.chave`) e grava
 * `entidadeRefId` de volta no projeto. **Transação por projeto.** Mesma regra
 * de `ProjectRefService.ensureEntidadeRef` (replicada aqui em PrismaClient puro,
 * pois o script roda fora do contexto NestJS).
 *
 * ### Fase B — Reparar DVincula órfãos (P → E)
 * Para cada DVincula das 4 famílias cujo campo aponta para um valor que existe
 * em `DProject` (`P`):
 *   - resolve `E` = espelho do projeto (criado na Fase A);
 *   - troca `P → E` no campo apropriado.
 *
 * **Detecção de colisão histórica (CRÍTICO — NÃO repara automaticamente):**
 * se o valor (`P`) existir TANTO em `DProject` QUANTO em uma `DEntidade`
 * NÃO-espelho (idClasse != -158), o vínculo é AMBÍGUO — pode estar apontando
 * para a DEntidade errada por causa da colisão histórica de IDs. Esses casos
 * NÃO são reparados; vão para um **relatório de suspeitos** (decisão do CEO).
 *
 * ## Idempotência (rodar 2x não duplica nem re-repara)
 *   - Fase A: pula projeto que já tem `entidadeRefId` apontando para espelho viva.
 *   - Fase B: só repara vínculo cujo campo ainda é `P` (existe em DProject) e
 *     NÃO é ambíguo. Vínculo já apontando para `E` (DEntidade -158) é ignorado.
 *
 * ## Dry-run por padrão
 * SEM `--apply`, o script só RELATA o que faria (e lista os suspeitos) — ZERO
 * escrita. O CEO roda dry-run primeiro em produção, revisa o relatório de
 * suspeitos, e só então roda com `--apply`.
 *
 * ## Uso
 * ```bash
 * # DRY-RUN (padrão — não escreve nada):
 * npx ts-node prisma/scripts/backfill-project-ref-entidades.ts
 *
 * # APLICAR (escreve espelhos + reescreve vínculos não-ambíguos):
 * npx ts-node prisma/scripts/backfill-project-ref-entidades.ts --apply
 * ```
 *
 * @see ADR-V2-058 — DEntidade-espelho (-158 PROJECT_REF)
 * @see src/projects/project-ref.service.ts — helper canônico (mesma regra)
 * @see docs/runbook-backfill-project-ref-entidades.md — runbook de cutover
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

/** idClasse da DEntidade-espelho de projeto (PROJECT_REF). Igual ao helper. */
const ID_CLASSE_PROJECT_REF = BigInt(-158);

/** idClasse AUDIT_GENERIC (-489) — DEvento de rastreabilidade do backfill. */
const ID_CLASSE_AUDIT_GENERIC = BigInt(-489);

/** Famílias cujo handle de projeto está em `idLocEscritu`. */
const LOC_ESCRITU_FAMILIES = [BigInt(-171), BigInt(-172), BigInt(-173), BigInt(-188)];

/** Famílias cujo handle de projeto está em `idEntidade`. */
const ENTIDADE_FAMILIES = [BigInt(-182), BigInt(-183)];

function isApply(): boolean {
  return process.argv.includes('--apply');
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function log(...args: any[]): void {
  // eslint-disable-next-line no-console
  console.log(...args);
}

/** Linha de suspeito de colisão histórica (não reparado — decisão do CEO). */
interface Suspect {
  vinculoChave: string;
  idClasse: string;
  campo: 'idLocEscritu' | 'idEntidade';
  valorAmbiguo: string;
  /** Projeto que o valor PODERIA representar (existe em DProject). */
  comoProjeto: { chave: string; nome: string } | null;
  /** DEntidade não-espelho que o valor TAMBÉM representa (colisão). */
  comoEntidade: { chave: string; idClasse: string; nome: string } | null;
}

interface Report {
  // Fase A
  projectsVisited: number;
  espelhosCriados: number;
  espelhosJaExistentes: number;
  // Fase B
  vinculosVisitados: number;
  vinculosReparados: number;
  vinculosJaCanonicos: number;
  vinculosReparadosPorClasse: Record<string, number>;
  suspeitos: Suspect[];
  erros: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase A — criar espelhos faltantes (mesma regra de ProjectRefService)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Garante (idempotente) a DEntidade-espelho -158 de um projeto e retorna `E`.
 * Replica `ProjectRefService.ensureEntidadeRef` em PrismaClient puro.
 *
 * @returns `{ refId, created }` — chave da espelho e se foi criada agora.
 */
async function ensureEspelho(
  project: { chave: bigint; nome: string; idEstab: bigint | null; dados: Prisma.JsonValue },
  apply: boolean,
): Promise<{ refId: bigint | null; created: boolean }> {
  const dados = (project.dados as Record<string, unknown> | null) ?? {};
  const existingRefRaw = dados.entidadeRefId;

  // Idempotente: ponteiro forward já existe e a espelho está viva.
  if (typeof existingRefRaw === 'string' && /^-?\d+$/.test(existingRefRaw)) {
    const existingRef = BigInt(existingRefRaw);
    const alive = await prisma.dEntidade.findFirst({
      where: { chave: existingRef, idClasse: ID_CLASSE_PROJECT_REF, excluido: false },
      select: { chave: true },
    });
    if (alive) {
      return { refId: existingRef, created: false };
    }
    // ponteiro órfão → recria abaixo
  }

  if (!apply) {
    // Dry-run: não cria, mas sinaliza que criaria.
    return { refId: null, created: true };
  }

  // Cria espelho + grava ponteiro forward — transação por projeto.
  const refId = await prisma.$transaction(async (tx) => {
    const ref = await tx.dEntidade.create({
      data: {
        idClasse: ID_CLASSE_PROJECT_REF,
        nome: project.nome,
        ...(project.idEstab !== null && project.idEstab !== undefined
          ? { idEstab: project.idEstab }
          : {}),
        dados: { projectId: project.chave.toString() } as Prisma.InputJsonValue,
      },
      select: { chave: true },
    });

    await tx.dProject.update({
      where: { chave: project.chave },
      data: {
        dados: { ...dados, entidadeRefId: ref.chave.toString() } as Prisma.InputJsonValue,
      },
    });

    // DEvento AUDIT (-489) — rastreabilidade (não bloqueante).
    await tx.dEvento.create({
      data: {
        idClasse: ID_CLASSE_AUDIT_GENERIC,
        idEntidade: ref.chave,
        descricao: 'project.ref.backfilled',
        metaDados: {
          projectId: project.chave.toString(),
          entidadeRefId: ref.chave.toString(),
          source: 'backfill-project-ref-entidades',
        } as Prisma.InputJsonValue,
      },
    });

    return ref.chave;
  });

  return { refId, created: true };
}

// ─────────────────────────────────────────────────────────────────────────────
// Helpers de classificação de um valor de campo (P / E / ambíguo / desconhecido)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Classifica um valor encontrado num campo de DVincula:
 *  - `canonico`  : já é uma DEntidade-espelho (-158) → nada a fazer.
 *  - `projeto`   : existe em DProject E NÃO existe como DEntidade não-espelho →
 *                  reparável (P → E).
 *  - `ambiguo`   : existe em DProject E TAMBÉM como DEntidade não-espelho →
 *                  SUSPEITO (não repara; relatório).
 *  - `entidade`  : existe só como DEntidade não-espelho (vínculo legítimo a
 *                  uma org/user/team/folder real) → nada a fazer.
 *  - `desconhecido`: não existe em lugar nenhum → órfão real (relata como erro).
 */
async function classifyValue(valor: bigint): Promise<{
  kind: 'canonico' | 'projeto' | 'ambiguo' | 'entidade' | 'desconhecido';
  projeto: { chave: bigint; nome: string } | null;
  entidadeNaoEspelho: { chave: bigint; idClasse: bigint; nome: string } | null;
}> {
  const [entidade, projeto] = await Promise.all([
    prisma.dEntidade.findFirst({
      where: { chave: valor, excluido: false },
      select: { chave: true, idClasse: true, nome: true },
    }),
    prisma.dProject.findFirst({
      where: { chave: valor, excluido: false },
      select: { chave: true, nome: true },
    }),
  ]);

  // Já é espelho canônico → nada a fazer.
  if (entidade && entidade.idClasse === ID_CLASSE_PROJECT_REF) {
    return { kind: 'canonico', projeto: null, entidadeNaoEspelho: null };
  }

  const entidadeNaoEspelho =
    entidade && entidade.idClasse !== ID_CLASSE_PROJECT_REF
      ? { chave: entidade.chave, idClasse: entidade.idClasse, nome: entidade.nome }
      : null;

  if (projeto && entidadeNaoEspelho) {
    // Colisão histórica: o valor existe nos DOIS lados.
    return {
      kind: 'ambiguo',
      projeto: { chave: projeto.chave, nome: projeto.nome },
      entidadeNaoEspelho,
    };
  }

  if (projeto) {
    return {
      kind: 'projeto',
      projeto: { chave: projeto.chave, nome: projeto.nome },
      entidadeNaoEspelho: null,
    };
  }

  if (entidadeNaoEspelho) {
    return { kind: 'entidade', projeto: null, entidadeNaoEspelho };
  }

  return { kind: 'desconhecido', projeto: null, entidadeNaoEspelho: null };
}

// ─────────────────────────────────────────────────────────────────────────────
// Fase B — reparar vínculos órfãos (P → E)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Repara uma família de vínculos cujo handle de projeto está em `campo`.
 * Atualiza o `report` in-place.
 */
async function repairFamily(
  campo: 'idLocEscritu' | 'idEntidade',
  idClasses: bigint[],
  apply: boolean,
  espelhoPorProjeto: Map<string, bigint>,
  report: Report,
): Promise<void> {
  const vinculos = await prisma.dVincula.findMany({
    where: { idClasse: { in: idClasses }, excluido: false },
    select: { chave: true, idClasse: true, idLocEscritu: true, idEntidade: true },
    orderBy: { chave: 'asc' },
  });

  for (const v of vinculos) {
    report.vinculosVisitados++;
    const valor = campo === 'idLocEscritu' ? v.idLocEscritu : v.idEntidade;
    if (valor === null || valor === undefined) continue;

    let classificacao;
    try {
      classificacao = await classifyValue(valor);
    } catch (err) {
      report.erros++;
      log(`  ! erro classificando vínculo ${v.chave}: ${(err as Error).message}`);
      continue;
    }

    if (classificacao.kind === 'canonico' || classificacao.kind === 'entidade') {
      // Já aponta para DEntidade real (espelho ou entidade legítima) → nada a fazer.
      report.vinculosJaCanonicos++;
      continue;
    }

    if (classificacao.kind === 'desconhecido') {
      // Valor não existe em DProject nem DEntidade — órfão real (FK quebrada).
      report.erros++;
      log(
        `  ! vínculo ${v.chave} (idClasse=${v.idClasse}) ${campo}=${valor} não existe ` +
          `em DProject nem DEntidade — órfão real, requer inspeção manual.`,
      );
      continue;
    }

    if (classificacao.kind === 'ambiguo') {
      // SUSPEITO — colisão histórica. NÃO repara.
      report.suspeitos.push({
        vinculoChave: v.chave.toString(),
        idClasse: v.idClasse.toString(),
        campo,
        valorAmbiguo: valor.toString(),
        comoProjeto: classificacao.projeto
          ? { chave: classificacao.projeto.chave.toString(), nome: classificacao.projeto.nome }
          : null,
        comoEntidade: classificacao.entidadeNaoEspelho
          ? {
              chave: classificacao.entidadeNaoEspelho.chave.toString(),
              idClasse: classificacao.entidadeNaoEspelho.idClasse.toString(),
              nome: classificacao.entidadeNaoEspelho.nome,
            }
          : null,
      });
      continue;
    }

    // kind === 'projeto' → reparável (P → E).
    const projectId = classificacao.projeto!.chave;
    const refId = espelhoPorProjeto.get(projectId.toString());
    if (refId === undefined) {
      // Espelho deveria existir (Fase A). Em dry-run, espelho ainda não foi
      // criado — contamos como "seria reparado".
      if (!apply) {
        report.vinculosReparados++;
        bump(report.vinculosReparadosPorClasse, v.idClasse.toString());
        log(
          `  ~ [dry] vínculo ${v.chave} (idClasse=${v.idClasse}) ${campo}: ` +
            `P=${valor} → E=(espelho do projeto ${projectId})`,
        );
        continue;
      }
      report.erros++;
      log(
        `  ! vínculo ${v.chave}: espelho do projeto ${projectId} ausente após Fase A — pulado.`,
      );
      continue;
    }

    if (!apply) {
      report.vinculosReparados++;
      bump(report.vinculosReparadosPorClasse, v.idClasse.toString());
      log(
        `  ~ [dry] vínculo ${v.chave} (idClasse=${v.idClasse}) ${campo}: ` +
          `P=${valor} → E=${refId}`,
      );
      continue;
    }

    try {
      await prisma.dVincula.update({
        where: { chave: v.chave },
        data: campo === 'idLocEscritu' ? { idLocEscritu: refId } : { idEntidade: refId },
      });
      report.vinculosReparados++;
      bump(report.vinculosReparadosPorClasse, v.idClasse.toString());
      log(
        `  ✓ vínculo ${v.chave} (idClasse=${v.idClasse}) ${campo}: P=${valor} → E=${refId}`,
      );
    } catch (err) {
      report.erros++;
      log(`  ! erro reparando vínculo ${v.chave}: ${(err as Error).message}`);
    }
  }
}

function bump(rec: Record<string, number>, key: string): void {
  rec[key] = (rec[key] ?? 0) + 1;
}

// ─────────────────────────────────────────────────────────────────────────────
// main
// ─────────────────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const apply = isApply();
  const report: Report = {
    projectsVisited: 0,
    espelhosCriados: 0,
    espelhosJaExistentes: 0,
    vinculosVisitados: 0,
    vinculosReparados: 0,
    vinculosJaCanonicos: 0,
    vinculosReparadosPorClasse: {},
    suspeitos: [],
    erros: 0,
  };

  log('');
  log('═══════════════════════════════════════════════════════════════════');
  log(`  backfill-project-ref-entidades — ${apply ? 'APPLY (escreve)' : 'DRY-RUN (não escreve)'}`);
  log('  ADR-V2-058 Fase 3 — handle canônico de projeto em DVincula (-158)');
  log('═══════════════════════════════════════════════════════════════════');
  if (!apply) {
    log('  Modo padrão: NADA é escrito. Use --apply para efetivar.');
  }
  log('');

  // ── Fase A: criar espelhos faltantes ──────────────────────────────────────
  log('── Fase A: garantir espelhos PROJECT_REF (-158) ──');
  const projects = await prisma.dProject.findMany({
    where: { excluido: false },
    select: { chave: true, nome: true, idEstab: true, dados: true },
    orderBy: { chave: 'asc' },
  });

  /** Mapa projectId → espelho (E). Usado na Fase B. */
  const espelhoPorProjeto = new Map<string, bigint>();

  for (const project of projects) {
    report.projectsVisited++;
    try {
      const { refId, created } = await ensureEspelho(project, apply);
      if (refId !== null) {
        espelhoPorProjeto.set(project.chave.toString(), refId);
      }
      if (created && refId !== null) {
        report.espelhosCriados++;
        log(`  ✓ projeto ${project.chave} (${project.nome}): espelho ${refId} criado`);
      } else if (created && refId === null) {
        // dry-run: criaria
        report.espelhosCriados++;
        log(`  ~ [dry] projeto ${project.chave} (${project.nome}): criaria espelho`);
      } else {
        report.espelhosJaExistentes++;
      }
    } catch (err) {
      report.erros++;
      log(`  ! projeto ${project.chave}: erro — ${(err as Error).message}`);
    }
  }
  log(
    `  Fase A: ${report.espelhosCriados} espelho(s) ${apply ? 'criado(s)' : 'a criar'}, ` +
      `${report.espelhosJaExistentes} já existente(s).`,
  );
  log('');

  // ── Fase B: reparar vínculos órfãos (P → E) ───────────────────────────────
  log('── Fase B: reparar DVincula órfãos (P → E) ──');
  await repairFamily('idLocEscritu', LOC_ESCRITU_FAMILIES, apply, espelhoPorProjeto, report);
  await repairFamily('idEntidade', ENTIDADE_FAMILIES, apply, espelhoPorProjeto, report);
  log(
    `  Fase B: ${report.vinculosReparados} vínculo(s) ${apply ? 'reparado(s)' : 'a reparar'}, ` +
      `${report.vinculosJaCanonicos} já canônico(s), ${report.suspeitos.length} suspeito(s).`,
  );
  log('');

  // ── Relatório de suspeitos (colisão histórica — decisão do CEO) ────────────
  if (report.suspeitos.length > 0) {
    log('═══════════════════════════════════════════════════════════════════');
    log(`  ⚠  RELATÓRIO DE SUSPEITOS (colisão histórica — NÃO reparados)`);
    log('  Estes vínculos têm um valor que existe TANTO em DProject QUANTO em');
    log('  uma DEntidade não-espelho. Podem estar apontando para a entidade');
    log('  ERRADA (corrupção pré-existente). Requerem decisão do CEO.');
    log('═══════════════════════════════════════════════════════════════════');
    for (const s of report.suspeitos) {
      log('');
      log(`  vínculo chave=${s.vinculoChave} idClasse=${s.idClasse} campo=${s.campo}`);
      log(`    valor ambíguo: ${s.valorAmbiguo}`);
      log(
        `    como DProject:  ${s.comoProjeto ? `chave=${s.comoProjeto.chave} nome="${s.comoProjeto.nome}"` : '(n/a)'}`,
      );
      log(
        `    como DEntidade: ${s.comoEntidade ? `chave=${s.comoEntidade.chave} idClasse=${s.comoEntidade.idClasse} nome="${s.comoEntidade.nome}"` : '(n/a)'}`,
      );
    }
    log('');
    // JSON estruturado (copiável para anexar ao ticket de decisão do CEO).
    log('  JSON dos suspeitos (para o ticket de decisão):');
    log(JSON.stringify(report.suspeitos, null, 2));
    log('');
  } else {
    log('  ✓ Nenhum suspeito de colisão histórica detectado.');
    log('');
  }

  // ── Resumo final ──────────────────────────────────────────────────────────
  log('═══════════════════════════════════════════════════════════════════');
  log(`  RESUMO ${apply ? '(APPLY)' : '(DRY-RUN — nada foi escrito)'}`);
  log('═══════════════════════════════════════════════════════════════════');
  log(`  projetos visitados:        ${report.projectsVisited}`);
  log(`  espelhos ${apply ? 'criados' : 'a criar'}:          ${report.espelhosCriados}`);
  log(`  espelhos já existentes:    ${report.espelhosJaExistentes}`);
  log(`  vínculos visitados:        ${report.vinculosVisitados}`);
  log(`  vínculos ${apply ? 'reparados' : 'a reparar'}:        ${report.vinculosReparados}`);
  for (const [classe, count] of Object.entries(report.vinculosReparadosPorClasse)) {
    log(`     idClasse ${classe}: ${count}`);
  }
  log(`  vínculos já canônicos:     ${report.vinculosJaCanonicos}`);
  log(`  SUSPEITOS (não reparados): ${report.suspeitos.length}`);
  log(`  erros/órfãos reais:        ${report.erros}`);
  log('═══════════════════════════════════════════════════════════════════');
  if (!apply && (report.espelhosCriados > 0 || report.vinculosReparados > 0)) {
    log('  Para efetivar, rode novamente com --apply (após backup — ver runbook).');
  }
  log('');
}

main()
  .catch((err) => {
    console.error('[backfill-project-ref-entidades] falha:', err);
    process.exit(1);
  })
  .finally(() => {
    void prisma.$disconnect();
  });

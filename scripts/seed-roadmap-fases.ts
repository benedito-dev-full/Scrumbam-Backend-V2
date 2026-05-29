/**
 * seed-roadmap-fases.ts
 *
 * Popula o projeto/List 25 com as 20 FASES do roadmap (docs/Scrumban-Roadmap-Fases.pdf)
 * como tasks de nível 1, e suas bullets como subtasks (idPai = task-pai).
 *
 * Reproduz FIELMENTE o que TasksService.create() faz, para as tasks nascerem
 * "saudáveis" (idênticas a criar pela UI):
 *   - identifier atômico "PREFIX-N" via DTabela -475 (ISSUE_COUNTER) do projeto
 *   - idStatus = DTabela -441 (INBOX) do projeto
 *   - dados.v3.state = "INBOX" + dados.identifier + idCreator
 *
 * 2 níveis apenas (fase = task; bullet = subtask). Tudo numa $transaction:
 * se qualquer passo falhar, NADA é persistido (rollback total) — seguro p/ produção.
 *
 * USO (produção):
 *   # idCreator resolvido automaticamente pelo 1º MANAGER (DVincula -171) do projeto.
 *   # Para forçar um criador específico:  CREATOR_ID=123  (chave da DEntidade-User)
 *   # Dry-run (não grava, só mostra o que faria): DRY_RUN=1
 *
 *   npx ts-node scripts/seed-roadmap-fases.ts
 *
 * Idempotência: NÃO é idempotente por padrão. Rodar 2x cria as tasks 2x.
 * Use DRY_RUN=1 primeiro para conferir.
 */
import { PrismaClient, Prisma } from '@prisma/client';

const prisma = new PrismaClient();

const PROJECT_ID = BigInt(process.env.PROJECT_ID ?? '25');
const ID_CLASSE_TASK = BigInt(-154); // SCRUMBAN_TASK (default do create())
const ID_CLASSE_INBOX = BigInt(-441); // DTabela status INBOX
const ID_CLASSE_ISSUE_COUNTER = BigInt(-475);
const ID_CLASSE_MANAGER = BigInt(-171); // DVincula PROJECT_ROLE_MANAGER
const DRY_RUN = process.env.DRY_RUN === '1';

/** Estrutura do roadmap: 20 fases, cada uma com suas subtasks (bullets). */
interface Fase {
  titulo: string;
  subtasks: string[];
}

const FASES: Fase[] = [
  {
    titulo: 'Fase 1 — Usar o Scrumban como usuário (dogfooding inicial)',
    subtasks: [
      'Criar workspace real e operar este roadmap dentro do Scrumban',
      'Cadastrar as fases deste documento como tasks/fases reais no produto',
      'Anotar toda fricção encontrada — vira backlog de UX',
    ],
  },
  {
    titulo: 'Fase 2 — Consolidar a "meca": backlog único e priorizado',
    subtasks: [
      'Transformar este roadmap no board de referência (revisar a cada virada de fase)',
      'Confirmar prioridades P0–P3 herdadas do Master',
      'Definir o critério de "pronto" (Definition of Done) de cada fase',
    ],
  },
  {
    titulo: 'Fase 3 — Table View com edição inline',
    subtasks: [
      'View tabela sobre GET /tasks + PUT /tasks/:id (edição célula a célula, Tab navega)',
      'Zero modais para editar campos simples',
    ],
  },
  {
    titulo: 'Fase 4 — Colunas customizáveis: contrato e alinhamento',
    subtasks: [
      'Ratificar o contrato dos 8 tipos (docs/contrato-colunas-customizaveis-v1.md)',
      'Resolver os 3 pontos em aberto (onde mora tableFields, campo desconhecido no PUT, endpoint de schema)',
      'Prototipar visualmente as 8 colunas no front (sem persistência ainda)',
    ],
  },
  {
    titulo: 'Fase 5 — Colunas customizáveis: implementação (8 tipos)',
    subtasks: [
      'Backend: persistir schema em tableFields + valores em dados.fields',
      'Endpoint de leitura (GET /classes/:id/fields) + edição de schema',
      'Frontend: render dos 8 tipos (text, number, date, person, status, checkbox, dropdown, link)',
    ],
  },
  {
    titulo: 'Fase 6 — Kanban polido com drag-and-drop',
    subtasks: [
      'Consumir API + PUT /tasks/:id/status com drag entre colunas',
      'Respeitar a State Machine V3 (transições válidas) no drop',
    ],
  },
  {
    titulo: 'Fase 7 — Calendar + Gantt/Timeline (views de tempo)',
    subtasks: ['Calendar sobre due dates; Gantt/Timeline sobre datas + dependências'],
  },
  {
    titulo: 'Fase 8 — Templates: revisão do plano técnico e decisões',
    subtasks: [
      'Fechar chave de DClasse, remapeamento de status na clonagem, hierarquia de subtarefas',
      'Validar plano workspace/plans/plan-spaces-sistema-templates-task1.md',
    ],
  },
  {
    titulo: 'Fase 9 — Templates: engine de clonagem (backend)',
    subtasks: [
      'Clonagem Space→Folder→List→Task reusando o bootstrap de projetos',
      'Endpoints: listar templates, preview, aplicar (clonar)',
    ],
  },
  {
    titulo: 'Fase 10 — Templates: galeria e aplicação (frontend)',
    subtasks: ['Galeria agrupada por categoria, preview, fluxo de aplicação'],
  },
  {
    titulo: 'Fase 11 — Templates: curadoria do primeiro protocolo',
    subtasks: [
      'Curar 1 protocolo de verdade (ex: evento presencial) usando o próprio Scrumban',
      'Validar que clonar + adaptar leva minutos, não horas',
    ],
  },
  {
    titulo: 'Fase 12 — Onboarding: 5 perguntas → persona',
    subtasks: [
      'Fluxo de 5 perguntas, cálculo de persona, sugestão de template certo',
      'Persona → workspace cheio (integra com Templates)',
    ],
  },
  {
    titulo: 'Fase 13 — Builder visual de automação (no-code)',
    subtasks: [
      'Builder mapeando para triggers de DEvento + actions',
      'Diferencial: uma action pode invocar o Agente IA',
    ],
  },
  {
    titulo: 'Fase 14 — Cron UI para agentes',
    subtasks: [],
  },
  {
    titulo: 'Fase 15 — Adapters Slack + WhatsApp',
    subtasks: ['Reusar o pattern de listener/consumer já provado no Telegram'],
  },
  {
    titulo: 'Fase 16 — Marketplace de agent templates',
    subtasks: [],
  },
  {
    titulo: 'Fase 17 — Forecast Monte Carlo na UI',
    subtasks: [],
  },
  {
    titulo: 'Fase 18 — Dashboards executivos',
    subtasks: [],
  },
  {
    titulo: 'Fase 19 — Multi-agent collaboration',
    subtasks: [],
  },
  {
    titulo: 'Fase 20 — Conferência de alinhamento e posicionamento final',
    subtasks: [
      'Rodar o comparativo de novo: estamos onde o Master prometeu?',
      'Dogfooding final: operar um projeto real de ponta a ponta no Scrumban',
      'Ajustar posicionamento e mensagem antes de abrir para mais usuários',
    ],
  },
];

/** Incremento atômico do identifier (réplica de TasksIdentifierService). */
async function getNextIdentifier(
  tx: Prisma.TransactionClient,
  projectId: bigint,
  prefix: string,
): Promise<string> {
  const counter = await tx.dTabela.findFirst({
    where: { idClasse: ID_CLASSE_ISSUE_COUNTER, dEntidadeId: projectId, excluido: false },
    select: { chave: true, metaDados: true },
  });

  if (!counter) {
    await tx.dTabela.create({
      data: {
        idClasse: ID_CLASSE_ISSUE_COUNTER,
        nome: `${prefix} counter`,
        dEntidadeId: projectId,
        metaDados: { prefix, lastSeq: 1 } as Prisma.InputJsonValue,
      },
    });
    return `${prefix}-1`;
  }

  const meta = counter.metaDados as Record<string, unknown>;
  const currentSeq = typeof meta.lastSeq === 'number' ? meta.lastSeq : 0;
  const nextSeq = currentSeq + 1;
  await tx.dTabela.update({
    where: { chave: counter.chave },
    data: { metaDados: { ...meta, lastSeq: nextSeq } as Prisma.InputJsonValue },
  });
  return `${prefix}-${nextSeq}`;
}

/** dados V3 inicial (réplica de buildInitialTaskDados). */
function buildInitialTaskDados(identifier: string, creatorId: string): Prisma.InputJsonValue {
  return {
    identifier,
    v3: { state: 'INBOX', movedAt: new Date().toISOString(), movedBy: creatorId },
  };
}

async function resolveCreatorId(projectId: bigint): Promise<bigint> {
  if (process.env.CREATOR_ID) return BigInt(process.env.CREATOR_ID);
  // 1º MANAGER do projeto (DVincula -171, idLocEscritu = projeto, idEntidade = user)
  const mgr = await prisma.dVincula.findFirst({
    where: { idClasse: ID_CLASSE_MANAGER, idLocEscritu: projectId, excluido: false },
    select: { idEntidade: true },
    orderBy: { chave: 'asc' },
  });
  if (!mgr?.idEntidade) {
    throw new Error(
      `Não foi possível resolver idCreator: nenhum MANAGER (DVincula -171) no projeto ${projectId}. ` +
        `Passe CREATOR_ID=<chave DEntidade> via env.`,
    );
  }
  return mgr.idEntidade;
}

async function createTask(
  tx: Prisma.TransactionClient,
  args: {
    projectId: bigint;
    nome: string;
    creatorId: bigint;
    prefix: string;
    inboxStatusChave: bigint | null;
    idPai: bigint | null;
  },
): Promise<bigint> {
  const identifier = await getNextIdentifier(tx, args.projectId, args.prefix);
  const dados = buildInitialTaskDados(identifier, args.creatorId.toString());
  const created = await tx.dTask.create({
    data: {
      idClasse: ID_CLASSE_TASK,
      idProject: args.projectId,
      nome: args.nome,
      idStatus: args.inboxStatusChave,
      idCreator: args.creatorId,
      idPai: args.idPai,
      dados,
    },
    select: { chave: true },
  });
  console.log(`  ${identifier}  #${created.chave}  ${args.idPai ? '↳ ' : ''}${args.nome}`);
  return created.chave;
}

async function main() {
  console.log(`\n=== seed-roadmap-fases — projeto ${PROJECT_ID} ${DRY_RUN ? '(DRY RUN)' : '(GRAVANDO)'} ===\n`);

  const project = await prisma.dProject.findFirst({
    where: { chave: PROJECT_ID, excluido: false },
    select: { dados: true, nome: true },
  });
  if (!project) throw new Error(`Projeto ${PROJECT_ID} não encontrado ou excluído.`);

  const prefix = ((project.dados as Record<string, unknown> | null)?.prefix as string) ?? 'DEV';
  const creatorId = await resolveCreatorId(PROJECT_ID);
  const inbox = await prisma.dTabela.findFirst({
    where: { idClasse: ID_CLASSE_INBOX, dEntidadeId: PROJECT_ID, excluido: false },
    select: { chave: true },
  });
  const inboxStatusChave = inbox?.chave ?? null;

  const totalSub = FASES.reduce((a, f) => a + f.subtasks.length, 0);
  console.log(`Projeto: "${project.nome}" | prefix=${prefix} | creator=#${creatorId} | INBOX=${inboxStatusChave ?? 'null'}`);
  console.log(`Vai criar: ${FASES.length} tasks-pai + ${totalSub} subtasks = ${FASES.length + totalSub} no total.\n`);

  if (DRY_RUN) {
    for (const f of FASES) {
      console.log(`• ${f.titulo}`);
      f.subtasks.forEach((s) => console.log(`    ↳ ${s}`));
    }
    console.log('\n(DRY RUN — nada foi gravado.)');
    return;
  }

  await prisma.$transaction(async (tx) => {
    for (const fase of FASES) {
      const paiChave = await createTask(tx, {
        projectId: PROJECT_ID,
        nome: fase.titulo,
        creatorId,
        prefix,
        inboxStatusChave,
        idPai: null,
      });
      for (const sub of fase.subtasks) {
        await createTask(tx, {
          projectId: PROJECT_ID,
          nome: sub,
          creatorId,
          prefix,
          inboxStatusChave,
          idPai: paiChave,
        });
      }
    }
  });

  console.log(`\n✅ Concluído. ${FASES.length} fases + ${totalSub} subtasks criadas no projeto ${PROJECT_ID}.`);
}

main()
  .catch((e) => {
    console.error('\n❌ ERRO (rollback total — nada foi gravado):\n', e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());

/**
 * CLASSES FIXAS — Template Base do Devari Core
 *
 * Versao: 1.0
 * Data:   2026-05-08
 * Fonte:  RELATORIO-DEVARI-PARTE-1-BACKEND-CORE.md secao 3.2.2 + devari-polymorphic-engine.md secao 3
 * Audiencia: TODO projeto SaaS gerado pelo Devari Core (Scrumban-Backend-V2 incluso)
 *
 * --------------------------------------------------------------------------
 * O QUE ESTE ARQUIVO E
 * --------------------------------------------------------------------------
 * Este arquivo declara as classes UNIVERSAIS do Devari Core — as 45 classes
 * (versao 1.0; o numero nominal "~50" comum nos planos refere-se ao mesmo
 * conjunto, com reserva para adicoes futuras dentro do range -1 a -110)
 * que TODO projeto derivado herda intactas. Sao a fundacao da Dimensao 1
 * (Dados) do modelo polimorfico: a TAXONOMIA que governa as 17 tabelas
 * canonicas (DEntidade, DTabela, DPedido, DTitulo, DMovDispo, DMovDepos,
 * DSolicita, DRequisic, DRecurso, DVincula, DEvento, DPermissao, DUserGroup,
 * DTask, DProject, DVFS, DClasse) — SEM nenhuma DClasse que seja especifica
 * de um dominio (ex: fintech Dinpayz, Scrumban, Pet shop).
 *
 * --------------------------------------------------------------------------
 * REGRAS DE OURO (NAO QUEBRAR)
 * --------------------------------------------------------------------------
 * 1. TODAS as chaves sao NEGATIVAS. Range reservado: -1 a -110.
 * 2. NUNCA adicionar classe especifica-de-dominio aqui (Dinpayz tinha -21..-27,
 *    -150 Config Antecipacao, -156 Socio etc — ESSAS NAO ENTRAM. Vao em
 *    `classes-fintech-template.ts` ou no seed especifico do projeto).
 * 3. Hierarquia consistente: TODO `idPai` aponta para uma `chave` que existe
 *    DENTRO deste array (ou e null para a Root -1).
 * 4. Idempotencia obrigatoria — o seed que consome este array faz `upsert`,
 *    nao `create`.
 * 5. Versionamento: qualquer alteracao aqui gera nova versao + nota de
 *    breaking change (afeta TODOS os projetos derivados).
 *
 * --------------------------------------------------------------------------
 * COMO USAR
 * --------------------------------------------------------------------------
 * No projeto derivado (ex: Scrumban-Backend-V2), criar `prisma/seeds/classes.seed.ts`:
 *
 *   import { classesFixas } from '../../templates/classes-base-template';
 *
 *   const classesEspecificas = [
 *     // Classes do dominio do projeto (chaves -150+ por convencao)
 *     { chave: -150, codigo: 'USER', nome: 'Usuario Scrumban', idPai: -43, ... },
 *     // ...
 *   ];
 *
 *   export const classes = [...classesFixas, ...classesEspecificas];
 *
 * --------------------------------------------------------------------------
 * HIERARQUIA CANONICA (referencia visual)
 * --------------------------------------------------------------------------
 *
 *   Root (-1)
 *   |
 *   |-- Movimentacoes (-2)
 *   |     |-- Eventos (-3)
 *   |     |-- Financeiro (-4)
 *   |     |     |-- Titulos (-5)
 *   |     |     |     |-- Tit. a Receber (-6)
 *   |     |     |     |-- Tit. a Pagar   (-7)
 *   |     |     |-- Mov. Disponivel (-8)
 *   |     |-- Estoque (-10)
 *   |     |     |-- Mov. Deposito  (-11)
 *   |     |     |-- Solicitacoes   (-12)
 *   |     |     |-- Requisicoes    (-13)
 *   |     |-- Pedidos (-20)
 *   |
 *   |-- Cadastros (-36)
 *   |     |-- Entidades (-37)
 *   |     |     |-- Estabelecimentos (-38)
 *   |     |     |-- Loc. Escrituracao (-39)
 *   |     |     |-- Disponiveis (-40)
 *   |     |     |     [conta bancaria, caixa — generico]
 *   |     |     |-- Nucleos (-41)
 *   |     |     |     |-- Centros de Custo (-42)
 *   |     |     |     |-- Depositos / Almoxarifados (-44)
 *   |     |     |-- Pessoas (-43)
 *   |     |     |     |-- Usuarios (-46)
 *   |     |     |     [outras sub-classes (Cliente, Fornecedor, etc.)
 *   |     |     |      sao especificas-de-dominio — definir em seed do projeto]
 *   |     |-- Recursos (-60)
 *   |     |     |-- Produtos    (-61)
 *   |     |     |-- Mercadorias (-62)
 *   |     |     |-- Ativos      (-63)
 *   |     |     |-- Despesas    (-64)
 *   |     |     |-- Receitas    (-65)
 *   |     |     |-- Servicos    (-66)
 *   |     |-- Tabelas (-51)
 *   |           |-- Status (-52)
 *   |           [Sub-tabelas (Sprints, Priorities, etc.) sao especificas
 *   |            de dominio — definir em seed do projeto]
 *   |
 *   |-- Tarefas (-70)
 *   |     |-- Atividades (-71)
 *   |
 *   |-- Projetos (-80)
 *   |     |-- Negocios (-81)
 *   |
 *   |-- Scripts (-90)
 *   |     |-- Pre-Calculo  (-91)
 *   |     |-- Calculo      (-92)
 *   |     |-- Pos-Calculo  (-93)
 *   |     |-- Pre-Gravacao (-94)
 *   |     |-- Pos-Gravacao (-95)
 *   |
 *   |-- Permissoes (-100)
 *   |     |-- Grupos de Permissao (-101)
 *   |
 *   |-- Eventos de Seguranca (-110)
 *
 */

export interface DClasseSeed {
  /** PK negativa unica (range -1 a -110 para classes fixas universais). */
  chave: number;
  /** Codigo curto e legivel (UPPER_SNAKE_CASE). Ex: 'PEDIDOS', 'USUARIOS'. */
  codigo: string;
  /** Nome descritivo para UI. Ex: 'Pedidos', 'Usuarios'. */
  nome: string;
  /** FK para a chave da DClasse pai. null somente em Root (-1). */
  idPai: number | null;
  /**
   * true  = no intermediario (agrupador, NAO instanciavel diretamente).
   * false = folha (tipo concreto que pode ter registros nas tabelas usuarias).
   */
  agrupamento: boolean;
  /** Flag de inativacao operacional (default false em seeds). */
  inativo: boolean;
  /** Flag de exclusao logica (default false em seeds). */
  excluido: boolean;
  /** Se a classe pode ser excluida via UI. Classes fixas: false. */
  excluivel: boolean;
  /** Se a classe pode ser editada via UI. Classes fixas: false. */
  editavel: boolean;
  /** JSON com definicao de campos custom da classe. null por padrao. */
  tableFields: unknown | null;
  /** Se herda os campos base do template. false em classes fixas (controle proprio). */
  baseFields: boolean;
}

/**
 * Helper interno — gera entrada padrao com flags de classe fixa.
 * Reduz repeticao e garante consistencia.
 */
function fixa(
  chave: number,
  codigo: string,
  nome: string,
  idPai: number | null,
  agrupamento: boolean,
): DClasseSeed {
  return {
    chave,
    codigo,
    nome,
    idPai,
    agrupamento,
    inativo: false,
    excluido: false,
    excluivel: false,
    editavel: false,
    tableFields: null,
    baseFields: false,
  };
}

/**
 * Array exportado — TODAS as classes universais que QUALQUER projeto
 * Devari Core herda intactas. Composicao dos seeds do projeto:
 *
 *   export const classes = [...classesFixas, ...classesEspecificas];
 *
 * Total: 45 classes fixas (range -1 a -110). Nota: o numero "~50" referenciado
 * em planos/auditorias e nominal — a contagem exata depende do escopo
 * canonico que o template raiz Devari Core estabilizar. Esta versao 1.0
 * fixa em 45 (sem fintech, sem ERP-especifico). Adicoes futuras devem
 * gerar nova versao deste arquivo + ADR.
 */
export const classesFixas: DClasseSeed[] = [
  // ==========================================================================
  // RAIZ
  // ==========================================================================
  fixa(-1, 'ROOT', 'Root', null, true),
  // Raiz da arvore — pai de todos os agrupadores principais.

  // ==========================================================================
  // MOVIMENTACOES (transacionais)
  // ==========================================================================
  fixa(-2, 'MOVIMENTACOES', 'Movimentacoes', -1, true),
  // Agrupador de tudo que e transacional (eventos, financeiro, estoque, pedidos).

  fixa(-3, 'EVENTOS', 'Eventos', -2, true),
  // Agrupador de eventos (audit trail, system events, notifications).
  // DEvento herda dele e suas folhas sao definidas pelo dominio.

  fixa(-4, 'FINANCEIRO', 'Financeiro', -2, true),
  // Agrupador de movimentacoes financeiras (titulos, disponiveis).

  fixa(-5, 'TITULOS', 'Titulos', -4, true),
  // Agrupador de titulos a pagar/receber (DTitulo).

  fixa(-6, 'TIT_RECEBER', 'Titulos a Receber', -5, false),
  // Folha — recebiveis (vendas, antecipacoes a receber).

  fixa(-7, 'TIT_PAGAR', 'Titulos a Pagar', -5, false),
  // Folha — contas a pagar (compras, despesas).

  fixa(-8, 'MOV_DISPONIVEL', 'Movimentacao Disponivel', -4, false),
  // Folha — extrato financeiro / ledger (DMovDispo).

  fixa(-10, 'ESTOQUE', 'Estoque', -2, true),
  // Agrupador de movimentacoes fisicas (estoque, transferencias, requisicoes).

  fixa(-11, 'MOV_DEPOSITO', 'Movimentacao Deposito', -10, false),
  // Folha — entradas/saidas de almoxarifado (DMovDepos).

  fixa(-12, 'SOLICITACOES', 'Solicitacoes', -10, false),
  // Folha — solicitacoes de transferencia entre depositos (DSolicita).

  fixa(-13, 'REQUISICOES', 'Requisicoes', -10, false),
  // Folha — requisicoes internas / consumo (DRequisic).

  fixa(-20, 'PEDIDOS', 'Pedidos', -2, true),
  // Agrupador de pedidos (DPedido). Sub-classes (compra, venda, etc.) sao
  // especificas-de-dominio. Para Scrumban V2: -300 EXECUTION fica como filho.

  // ==========================================================================
  // CADASTROS (estruturais)
  // ==========================================================================
  fixa(-36, 'CADASTROS', 'Cadastros', -1, true),
  // Agrupador-mae de tudo que e cadastro estrutural (entidades, recursos, tabelas).

  fixa(-37, 'ENTIDADES', 'Entidades', -36, true),
  // Agrupador de DEntidade. Pais de Estabelecimentos, Loc.Escrituracao,
  // Disponiveis, Nucleos e Pessoas.

  fixa(-38, 'ESTABELECIMENTOS', 'Estabelecimentos', -37, false),
  // Folha — Filial / Tenant SaaS / Marketplace (no contexto do projeto).
  // O significado concreto e definido pelo dominio (NAO pelo template).

  fixa(-39, 'LOC_ESCRITURACAO', 'Local de Escrituracao', -37, false),
  // Folha — Razao social responsavel legal pela operacao.

  fixa(-40, 'DISPONIVEIS', 'Disponiveis', -37, false),
  // Folha — Contas bancarias, caixas, aplicacoes, poupancas. Generico.
  // DMovDispo aponta para uma DEntidade-Disponivel.

  fixa(-41, 'NUCLEOS', 'Nucleos', -37, true),
  // Agrupador de Centros de Custo + Depositos.

  fixa(-42, 'CENTROS_DE_CUSTO', 'Centros de Custo', -41, false),
  // Folha — apropriacao de gastos em valores ($).

  fixa(-43, 'PESSOAS', 'Pessoas', -37, true),
  // Agrupador de pessoas/organizacoes. Folhas (Cliente, Fornecedor, Seller,
  // Socio, USER de Scrumban) sao definidas pelo dominio. -46 (Usuarios) e fixa.

  fixa(-44, 'DEPOSITOS', 'Depositos', -41, false),
  // Folha — almoxarifados / locais de estoque. DMovDepos referencia.

  fixa(-46, 'USUARIOS', 'Usuarios', -43, false),
  // Folha — usuarios de login do sistema. DEntidade -46 com dUserGroupId
  // populado. Toda autenticacao gira em torno desta classe.

  fixa(-51, 'TABELAS', 'Tabelas', -36, true),
  // Agrupador de DTabela (lookups, configuracoes, catalogos). Folhas (Status,
  // Sprint, Priority etc.) sao do dominio.

  fixa(-52, 'STATUS', 'Status', -51, true),
  // Agrupador de status / lookups gerais. Pai padrao de configuracoes
  // genericas que nao tem agrupador proprio.

  fixa(-60, 'RECURSOS', 'Recursos', -36, true),
  // Agrupador de DRecurso (produtos, servicos, mercadorias, despesas, receitas).

  fixa(-61, 'PRODUTOS', 'Produtos', -60, false),
  // Folha — itens para REVENDA. Tem estoque (DMovDepos).

  fixa(-62, 'MERCADORIAS', 'Mercadorias', -60, false),
  // Folha — itens para CONSUMO interno (NAO revenda). Saem via Requisicao.

  fixa(-63, 'ATIVOS', 'Ativos Imobilizados', -60, false),
  // Folha — bens da empresa (veiculos, equipamentos, moveis).

  fixa(-64, 'DESPESAS', 'Despesas', -60, false),
  // Folha — categorias de gasto (energia, impostos, folha). Usadas em provisoes.

  fixa(-65, 'RECEITAS', 'Receitas', -60, false),
  // Folha — categorias de ganho (juros, aplicacao, ganho de capital).

  fixa(-66, 'SERVICOS', 'Servicos', -60, false),
  // Folha — servicos prestados ou contratados.

  // ==========================================================================
  // TAREFAS / PROJETOS (DTask, DProject)
  // ==========================================================================
  fixa(-70, 'TAREFAS', 'Tarefas', -1, true),
  // Agrupador de DTask. Folhas (Card, Atividade Scrumban, Etapa) sao do dominio.

  fixa(-71, 'ATIVIDADES', 'Atividades', -70, false),
  // Folha — atividade/tarefa generica. Dominio sobrescreve com classes proprias
  // se precisar de tipos especificos.

  fixa(-80, 'PROJETOS', 'Projetos', -1, true),
  // Agrupador de DProject. Folhas (Board, Obra, Negocio) sao do dominio.

  fixa(-81, 'NEGOCIOS', 'Negocios', -80, false),
  // Folha — projeto/negocio generico. Dominio especializa.

  // ==========================================================================
  // SCRIPTS (DVFS — Dimensao 3 de Flexibilidade)
  // ==========================================================================
  fixa(-90, 'SCRIPTS', 'Scripts', -1, true),
  // Agrupador da Dimensao 3. Filhos sao os 5 momentos do workflow do Engine.

  fixa(-91, 'SCRIPT_PRE_CALCULO', 'Script Pre-Calculo', -90, false),
  // Folha — DVFS chave 3. Pre-validacao antes do calculo.

  fixa(-92, 'SCRIPT_CALCULO', 'Script Calculo', -90, false),
  // Folha — DVFS chave 4. Calculos principais (totais, impostos).

  fixa(-93, 'SCRIPT_POS_CALCULO', 'Script Pos-Calculo', -90, false),
  // Folha — DVFS chave 5. Ajustes apos calculo. ATENCAO: bug latente
  // historico do Devari Core era nao carregar essa chave (filtro por
  // s.id em vez de s.chave). Ver ADR-V2-016.

  fixa(-94, 'SCRIPT_PRE_GRAVACAO', 'Script Pre-Gravacao', -90, false),
  // Folha — DVFS chave 6. Validacoes finais antes de persistir.

  fixa(-95, 'SCRIPT_POS_GRAVACAO', 'Script Pos-Gravacao', -90, false),
  // Folha — DVFS chave 7. Side-effects apos persistencia (PR auto-open,
  // notificacoes, etc.).

  // ==========================================================================
  // PERMISSOES (DPermissao + DUserGroup)
  // ==========================================================================
  fixa(-100, 'PERMISSOES', 'Permissoes', -1, true),
  // Agrupador de permissoes do sistema.

  fixa(-101, 'GRUPO_PERMISSAO', 'Grupo de Permissao', -100, false),
  // Folha — DUserGroup como GRUPO (nao usuario individual). Diferenciado
  // de USUARIOS (-46) pelo idClasse.

  // ==========================================================================
  // EVENTOS DE SEGURANCA
  // ==========================================================================
  fixa(-110, 'EVENTOS_SEGURANCA', 'Eventos de Seguranca', -3, true),
  // Folha agrupadora — DEvento vinculado a auditoria de seguranca
  // (login, troca de senha, acessos negados). Filhos sao do dominio.
];

// ==========================================================================
// VALIDACAO ESTATICA EM TIME DE BUILD
// ==========================================================================
//
// Garante que todos os `idPai` apontam para uma `chave` existente neste
// array (ou null em Root). Roda no proximo `tsc` ou `prisma db seed`.
// Se quebrar: erro fatal antes de tocar no banco.
//
// (Sem dependencia externa — checagem pura de array.)
{
  const chaves = new Set(classesFixas.map((c) => c.chave));
  const orfaos = classesFixas.filter(
    (c) => c.idPai !== null && !chaves.has(c.idPai),
  );
  if (orfaos.length > 0) {
    throw new Error(
      `[classes-base-template] Hierarquia quebrada — idPai inexistente em: ` +
        orfaos.map((o) => `${o.chave}(${o.codigo})->${o.idPai}`).join(', '),
    );
  }
  // Valida tambem que Root (-1) nao tem idPai e que e o unico assim.
  const roots = classesFixas.filter((c) => c.idPai === null);
  if (roots.length !== 1 || roots[0].chave !== -1) {
    throw new Error(
      `[classes-base-template] Deve haver exatamente 1 root (-1, idPai null). ` +
        `Encontrados: ${roots.map((r) => r.chave).join(', ')}`,
    );
  }
}

/**
 * Total: 50 classes fixas universais.
 *
 * Classes que NAO estao aqui (e nao devem estar):
 *   -21 a -27   PED_TRANS_*           (fintech Dinpayz)
 *   -45         MARKETPLACE           (fintech Dinpayz)
 *   -47         SELLER                (fintech Dinpayz; em Scrumban V2 fica USER em -150)
 *   -49         PLATAFORMA            (fintech Dinpayz; em Scrumban V2 fica em -151)
 *   -50         COMPRADOR             (fintech Dinpayz)
 *   -150        CONFIG_ANTECIPACAO    (fintech Dinpayz)
 *   -153        CNAE                  (fintech Dinpayz)
 *   -156        SOCIO                 (fintech Dinpayz)
 *   -157        VINCULO_SOCIO         (fintech Dinpayz)
 *   -158        MCC                   (fintech Dinpayz)
 *   -159        VINCULO_CNAE          (fintech Dinpayz)
 *   -160 a -163 EVENTOS_SYNC          (fintech Dinpayz adquirente)
 *
 * Estas vivem em arquivo SEPARADO `classes-fintech-template.ts` (nao incluso
 * em projetos non-fintech como Scrumban V2). Cada projeto importa apenas
 * `classesFixas` (deste arquivo) + suas proprias classes especificas-de-dominio.
 */

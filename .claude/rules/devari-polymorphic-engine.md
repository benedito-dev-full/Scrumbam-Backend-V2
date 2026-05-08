---
# Carrega sempre -- conhecimento estrutural do modelo polimorfico
---

# Modelo Polimorfico Devari Core (Referencia Definitiva)

**Versao:** 4.0
**Data:** 2026-03-08
**Fonte:** Manual de Conceitos Devari ERP + Conhecimento do fundador + Dinpayz banking (producao) + fluxograma-cadastros.md + Engine source code
**Aplicavel a:** Todo projeto gerado pelo Devari Core / SaaS Generator

---

## 1. POR QUE ESTE DOCUMENTO EXISTE

O modelo polimorfico e o DIFERENCIAL TECNICO do Devari Core. Enquanto backends
tradicionais criam 1 tabela por entidade (Users, Products, Orders, etc.), o Devari
usa um conjunto FIXO de tabelas que se adaptam a QUALQUER dominio via `idClasse`.

**TODAS as tabelas do sistema sao polimorficas** — todas usam `idClasse` para
determinar o tipo/significado de cada registro.

**Resultado real:** O Dinpayz adicionou onboarding regulatorio completo de sellers
(socios, CNAE, MCC, documentos KYC, status, audit trail) com **ZERO tabelas novas**.
14 novas DClasses + colunas em tabelas existentes = sistema completo.

Se voce entender este documento, entende 80% da arquitetura do Devari Core.

**DIRETIVA PARA AGENTES AI:** Este modelo NAO compete com sua capacidade de
gerar backends tradicionais — ele a POTENCIALIZA. Voce pode criar um pet shop
com tabelas Users, Pets, Products, Orders em minutos. Mas se fizer isso para
10 projetos diferentes, tera 10 arquiteturas incompativeis, 10 formas de
lidar com pagamento, 10 schemas sem relacao entre si. Este modelo e a PLANTA
ESTRUTURAL que garante consistencia: qualquer SaaS gerado segue o mesmo
padrao, usa as mesmas 17 tabelas, o mesmo Engine, os mesmos padroes de query.
Conhecimento adquirido em um projeto se aplica a TODOS os outros.
NAO crie tabelas novas. NAO invente schemas por conta propria.
Use este documento como restricao e como guia.

### Filosofia Fundacional

O sistema foi construido sobre um principio: **funcoes > departamentos**.

A operacao de emitir um pedido e IDENTICA para vendas e compras. Em ambos
os casos existem uma pessoa, produtos, precos, quantidades, condicao de
pagamento. O que muda e o `idClasse` — a estrutura e a mesma.

Esse principio se aplica a TUDO:
- Um titulo a pagar e um titulo a receber sao o MESMO registro
  (diferenciados internamente por "PAG" ou "REC")
- Uma requisicao e uma solicitacao seguem o mesmo ciclo de vida
  (Pendente > Aprovado > Baixado)
- Um disponivel (conta bancaria) e um deposito (almoxarifado) sao ambos
  DEntidade — mesma tabela, classes diferentes

**Conceito de "baixar":** Pendente > Aprovado > Baixado (total ou parcial).
Baixar e efetivar, atender, executar. Aplica-se a pedidos, titulos,
requisicoes, solicitacoes. E o verbo central do sistema.

### As 3 Dimensoes de Flexibilidade

O principio "funcoes > departamentos" se expressa em TRES dimensoes
independentes, todas extensiveis sem alterar o core:

```
Dimensao 1 — DADOS (o que o registro SIGNIFICA)
  Mecanismo: DClasse + 17 tabelas polimorficas
  Custo:     Criar um seed (chave negativa)
  Resultado: Qualquer dominio de negocio cabe nas mesmas tabelas

Dimensao 2 — COMPORTAMENTO (como o registro e PROCESSADO)
  Mecanismo: Hierarquia OOP do Engine (Operacao → filhos via heranca)
  Custo:     Criar uma classe TypeScript que herda de Operacao ou filhos
  Resultado: Qualquer workflow cabe (inclusive os que nao existiam no ERP)

Dimensao 3 — CONFIGURACAO (como o calculo FUNCIONA por projeto)
  Mecanismo: DVFS scripts (pre/pos calculo, pre/pos gravacao)
  Custo:     Trocar o script na tabela DVFS
  Resultado: Mesmo Engine, regras diferentes por projeto (portabilidade)
```

A maioria dos dominios precisa apenas da Dimensao 1 (novas DClasses).
Alguns precisam da Dimensao 3 (scripts customizados). Poucos precisam
da Dimensao 2 (novo Engine) — mas quando precisam, o mecanismo existe.
Exemplos reais da Dimensao 2: OperacaoSaque e OperacaoAntecipacao no
Dinpayz, que NAO existiam no modelo classico e foram criados por heranca.

**Tudo e a mesma coisa com parametros diferentes.** Dados: mesmas tabelas,
significado diferente (DClasse). Comportamento: mesmo Engine base,
workflow diferente (heranca OOP). Regras: mesmo codigo de Engine,
calculos diferentes (DVFS). E o "funcoes > departamentos" levado a
conclusao logica — um sistema de tipos completo em runtime.

### Da ERP para SaaS

O modelo nasceu como ERP empresarial. O Devari adaptou os conceitos
classicos para multi-tenancy SaaS, mantendo a mesma estrutura:

| Conceito ERP | Papel Original | Adaptacao SaaS (Dinpayz) |
|-------------|---------------|--------------------------|
| **(camada SaaS)** | Nao existia no ERP | Platform / White-Label (nivel acima do ERP) |
| **Estabelecimento** | Filial da empresa | Marketplace / Tenant (CHAVE_CLASSE_ESTABELECIMENTOS = -45) |
| **Local de Escrituracao** | Razao social responsavel | Seller / Sub-merchant (onde operacoes sao escrituradas) |
| **Pessoa** | Cliente/Fornecedor | Comprador / Usuario final |
| **Disponivel** | Conta bancaria | Conta Virtual / Wallet |
| **Deposito** | Almoxarifado | Estoque por loja/seller |

**Platform e uma camada ACIMA do ERP tradicional** — adicionada para
suportar B2B2B/C (ex: SAP/TOTVS contrata a plataforma, seus grandes
grupos viram Marketplaces, os clientes desses viram Sellers).

O modelo polimorfico permite hierarquias INFINITAS para cima e para baixo.
Platform e o nivel maximo da subida no Dinpayz, mas em outro dominio
a hierarquia pode ser diferente — so muda a DClasse.

---

## 2. AS 17 TABELAS CORE

O sistema inteiro se apoia em 17 tabelas. Todas sao polimorficas (idClasse).
A divisao e por **padrao de acesso**, nao por tipo de polimorfismo:

### Estrutural (10 tabelas — Prisma direto para INSERT)

| Tabela | Papel |
|--------|-------|
| **DClasse** | Taxonomia / sistema de tipos — governa TODAS as outras |
| **DEntidade** | Pessoas, organizacoes, entidades de qualquer tipo |
| **DTabela** | Lookups, configuracoes, parametros, catalogos |
| **DVincula** | Relacoes genericas (N:N, 1:N, documentos, vinculos) |
| **DEvento** | Audit trail, eventos, rastreamento |
| **DRecurso** | Recursos genericos (produtos, ativos imobilizados, pares de moeda, etc.) |
| **DUserGroup** | Usuarios e grupos (diferenciados por idClasse — mesma tabela) |
| **DPermissao** | Permissoes por grupo |
| **DTask** | Atividades, etapas, tarefas |
| **DProject** | Projetos, negocios, obras |

### Transacional (6 tabelas — SEMPRE via Engine para INSERT)

Tabelas transacionais NUNCA sao inseridas via Prisma direto. O Engine
(objeto de gestao) e obrigatorio porque:
- **Abstrai regras de negocio:** o dev nao precisa conhecer a regra — o
  Engine chama scripts de calculo (DVFS) automaticamente
- **Escala:** tabelas transacionais podem ter bilhoes de registros em
  producao (vs estruturais que sao menores e cacheaveis)
- **Integridade:** o Engine garante o fluxo correto (calculo, aprovacao,
  baixa, partida dobrada, geracao de registros encadeados)

| Tabela | Papel | Engine Class |
|--------|-------|-------------|
| **DPedido** | Pedidos (compra, venda, PIX, cripto, cartao) | OperacaoPedido |
| **DTitulo** | Titulos financeiros (contas a pagar/receber) | OperacaoBaixa |
| **DMovDispo** | Ledger financeiro (extrato de dinheiro/disponiveis) | OperacaoMovDisponivel |
| **DMovDepos** | Movimentacoes de estoque/deposito (almoxarifado) | OperacaoMovDeposito |
| **DSolicita** | Solicitacoes (transferencia entre depositos) | Engine class pendente |
| **DRequisic** | Requisicoes internas (consumo de estoque) | Engine class pendente |

**IMPORTANTE: O Engine e EXTENSIVEL via heranca OOP.** A hierarquia de classes
NAO e um conjunto fechado — novos Engines podem ser criados para qualquer dominio.

```
Operacao (BASE: nova(), sequence key via PostgreSQL, lifecycle)
  |
  |-- OperacaoPedido (FULL: scripts DVFS, calcula, aprova, grava)
  |     |-- OperacaoBaixa (baixa de pedidos → gera titulos + mov estoque)
  |     |     |-- OperacaoBaixaAutomatica (baixa sem intervencao manual)
  |     |-- OperacaoSaque (Dinpayz: workflow custom de saque via PIX)
  |     |-- OperacaoAntecipacao (Dinpayz: sobrescreve carregaScripts → void)
  |
  |-- OperacaoMovDisponivel (simplificado: abre, grava, saldo, extrato)
  |-- OperacaoMovDeposito (simplificado: grava movimentacoes de estoque)
```

**Padroes de extensao (como criar um novo Engine):**

| Precisa de... | Estende | Exemplo |
|---------------|---------|---------|
| Workflow completo (calcula, scripts DVFS, baixa) | `OperacaoPedido` | OperacaoBaixa |
| Workflow parcial (herda estrutura, PULA scripts) | `OperacaoPedido` + override | OperacaoAntecipacao (sobrescreve `_carregaScriptsCalc()` → void) |
| So sequence key + lifecycle basico | `Operacao` direto | OperacaoMovDisponivel |
| Totalmente custom (sem heranca) | Classe standalone | OperacaoComissionamento |

**Exemplos reais que NAO existiam no modelo classico (criados no Dinpayz):**
- `OperacaoSaque` (~881 linhas): saque de seller via PIX, com validacao de
  saldo, geracao de titulo e transferencia — workflow proprio, NAO usa o
  fluxo padrao de pedido
- `OperacaoAntecipacao` (~503 linhas): antecipacao de recebiveis em lote,
  sobrescreve `_carregaScriptsCalc()` e `_carregaScriptsGrav()` para retornar
  void — pula scripts DVFS completamente, usa Prisma direto em transacao

**Principio:** O esqueleto do Engine (classe base Operacao) fornece o mecanismo
(sequence key, lifecycle, erro). Cada filho decide QUANTO do workflow usar.
Nao precisa ser tudo ou nada — pode herdar e sobrescrever o que nao precisa.

### Infraestrutura (1 tabela)

| Tabela | Papel |
|--------|-------|
| **DVFS** | Virtual File System — scripts de calculo chamados pelos Engines |

**Por que DVFS e uma tabela?** Porque os scripts de calculo (pre/pos calculo,
pre/pos gravacao) mudam de projeto para projeto, mas o Engine (esqueleto) e
FIXO. Basta trocar os scripts na DVFS e o sistema roda com regras diferentes
— sem alterar o codigo do Engine. E o que permite portabilidade entre projetos.

**NOTA:** DChave esta OBSOLETA — removida do modelo. Sequencias agora usam
`nextval('chcriacao_seq')` diretamente do PostgreSQL.

---

## 3. DCLASSE: O SISTEMA DE TIPOS

DClasse e a tabela mais importante do sistema. Ela define a TAXONOMIA — o que
cada registro em QUALQUER outra tabela SIGNIFICA.

### Estrutura

```
DClasse
  chave: BigInt (PK)    -- ID unico
  codigo: String?       -- Codigo legivel (ex: 'SELLER', 'SPRINT')
  nome: String          -- Nome descritivo
  idPai: BigInt?        -- FK para DClasse pai (hierarquia em arvore)
  agrupamento: Bool     -- true = no intermediario, false = folha (tipo concreto)
  inativo, excluido, excluivel, editavel: Flags de controle
```

### Convencao de Chave Negativa / Positiva

Esta e a convencao MAIS IMPORTANTE do sistema:

```
chave < 0 (NEGATIVA): Seeds do sistema / template
  - Definidas em prisma/seeds/classes.seed.ts
  - Compartilhadas entre TODOS os projetos gerados pelo template
  - NUNCA criadas em runtime
  - Exemplos: -1 (Root), -2 (Movimentacoes), -45 (Marketplace), -47 (Seller)

chave > 0 (POSITIVA): Dados de runtime / usuario
  - Criadas pela aplicacao em producao
  - Especificas de cada instalacao
  - Exemplos: empresa X, usuario Y, pedido Z
```

**Analogia:** Classes negativas sao como TIPOS em uma linguagem de programacao
(definem estrutura). Valores positivos sao INSTANCIAS desses tipos.

### Hierarquia em Arvore

DClasse forma uma arvore hierarquica via `idPai`:

```
Root (-1)
  |-- Movimentacoes (-2)
  |     |-- Eventos (-3)
  |     |-- Financeiro (-4)
  |     |     |-- Titulos (-5)
  |     |-- Pedidos (-20)
  |
  |-- Cadastros (-36)
  |     |-- Entidades (-37)
  |     |     |-- Pessoas (-43)
  |     |     |     |-- Usuarios (-46)
  |     |     |     |-- Plataforma (-49)      // Exemplo: dominio fintech
  |     |     |     |-- Marketplace (-45)     // Exemplo: dominio fintech
  |     |     |     |-- Seller (-47)          // Exemplo: dominio fintech
  |     |-- Tabelas (-51)
  |           |-- Status (-52)               // Pai de lookups
  |
  |-- Scripts (-90)
  |-- Eventos de Seguranca (-110)
```

**Composicao do Seed (chaves negativas):**
- **~50 classes base** (Range -1 a -110): SEMPRE presentes em TODO projeto
  - Source: `templates/classes-base-template.ts`
  - Sao o esqueleto compartilhado por todos os projetos gerados
- **N classes de dominio** (Range -150 em diante por convencao): Especificas
  do projeto, definidas pelo DESENVOLVEDOR/ARQUITETO no setup
  - Definidas no seed do projeto ou no YAML do SaaS Generator
  - Exemplo Dinpayz: -150 (Config Antecipacao), -156 (Socio), -157 (Vinculo Socio)
  - O range -150+ e convencao (evitar colisao com base), nao regra rigida

**REGRA FUNDAMENTAL:** Classes criadas pelo USUARIO/CLIENTE em runtime sao
SEMPRE chave POSITIVA. Chaves negativas sao EXCLUSIVAMENTE seeds definidas
pelo desenvolvedor antes do deploy. O usuario nunca cria chave negativa.

### Classes Fixas Essenciais

| Chave | Nome | Papel |
|-------|------|-------|
| -1 | Root | Raiz da arvore |
| -2 | Movimentacoes | Agrupamento transacional |
| -3 | Eventos | Agrupamento de eventos |
| -4 | Financeiro | Agrupamento financeiro |
| -5 | Titulos | Agrupamento de titulos |
| -20 | Pedidos | Agrupamento de pedidos |
| -36 | Cadastros | Agrupamento de cadastros |
| -37 | Entidades | Agrupamento de entidades |
| -43 | Pessoas | Agrupamento de pessoas |
| -46 | Usuarios | Tipo: usuario de login |
| -51 | Tabelas | Agrupamento de lookups |
| -52 | Status | Agrupamento de status/configs |
| -90 | Scripts | Scripts de calculo (DVFS) |

---

## 4. TABELAS ESTRUTURAIS

### DEntidade — O Cadastro Universal

Armazena QUALQUER tipo de pessoa, organizacao, local ou conta com quem a
empresa se relaciona. O campo `idClasse` determina o tipo. Campos nao
usados por aquele tipo ficam NULL — por design.

**Arvore de sub-classes (do Manual de Conceitos Devari ERP):**

```
DEntidade (via idClasse)
  |
  |-- Pessoas
  |     |-- Clientes, Fornecedores, Funcionarios, Bancos, Vendedores
  |     |-- (No SaaS: Sellers, Socios, Compradores)
  |
  |-- Estabelecimentos (loja fisica, e-commerce, plataforma SaaS)
  |     |-- Relacao com Local de Escrituracao: 1:1 ou N:1
  |     |-- Podem ser fisicos (loja) ou virtuais (e-commerce)
  |
  |-- Local de Escrituracao (razao social, filial — responsavel legal)
  |     |-- E o estabelecimento responsavel LEGAL pela operacao
  |     |-- Cada filial = 1 local de escrituracao
  |
  |-- Disponiveis (contas bancarias, caixas, aplicacoes, poupancas)
  |     |-- Sao as contas que movimentam DINHEIRO
  |     |-- DMovDispo referencia estas entidades (qual conta entrou/saiu)
  |
  |-- Nucleos
  |     |-- Centros de Custos (apropriacao de gastos em valores "$")
  |     |-- Depositos / Almoxarifados (controle de quantidades/estoque)
  |           |-- DMovDepos referencia estas entidades (qual almoxarifado)
  |
  |-- (Qualquer sub-classe adicional via nova DClasse)
```

**Conceito fundamental:** Disponiveis, Depositos e Centros de Custos sao
ENTIDADES. Quando DMovDispo registra um pagamento, aponta para uma
DEntidade-Disponivel (a conta bancaria). Quando DMovDepos registra uma
entrada de estoque, aponta para uma DEntidade-Deposito (o almoxarifado).

**Campos principais:**
```
chave, idClasse, codigo, nome, cpfCnpj, email, telefone, celular
idEstab (FK hierarquia pai), idLocEscritu (local de escrituracao)
dUserGroupId (FK login), endereco, bairro, cep, idUF, idCidade
idBanco, agencia, conta, codigoFebraban, limiteCredito
inativo, excluido, criadoEm, atualizadoEm
```

**Exemplo de polimorfismo (dominio fintech — Dinpayz):**
```
idClasse = -49 (Plataforma):    Usa nome, cpfCnpj, themeConfig
idClasse = -45 (Marketplace):   Usa nome, cpfCnpj, idEstab -> Platform
idClasse = -47 (Seller):        Usa nome, cpfCnpj, idEstab -> Marketplace
idClasse = -40 (Conta Virtual): Usa codigoFebraban, agencia, conta, idLocEscritu -> Seller
idClasse = -156 (Socio):        Usa nome, cpfCnpj, dataNascimento, RG, mae
idClasse = -46 (Usuario):       Usa nome, email, dUserGroupId
```

**Exemplo de polimorfismo (dominio ERP classico):**
```
idClasse = Estabelecimento:     Matriz, filiais (loja, e-commerce)
idClasse = Loc. Escrituracao:   Razao social responsavel legal
idClasse = Disponivel:          Conta Bradesco, Conta Itau, Caixa da Loja
idClasse = Centro de Custo:     Depto Financeiro, Depto Comercial
idClasse = Deposito:            Almoxarifado Retaguarda, Loja, Vitrine
idClasse = Fornecedor:          Fornecedores da empresa
idClasse = Funcionario:         Funcionarios
```

### DTabela — Lookups, Configuracoes, Catalogos

Armazena tabelas de lookup e parametros. Dois padroes de uso:

- **Catalogo (global):** dEntidadeId = NULL. Ex: CNAE, MCC, UFs, Municipios
- **Configuracao (por entidade):** dEntidadeId = chave da entidade dona

**Campos principais:**
```
chave, idClasse, codigo, nome, descricao, percentual, metaDados (Json)
dEntidadeId (FK para DEntidade, se vinculado)
inativo, excluido
```

### DVincula — Relacoes Genericas

Implementa QUALQUER tipo de relacao. E a peca-chave que permite ZERO tabelas novas.

**Campos principais:**
```
chave, idClasse, idLocEscritu (DONO do vinculo)
idEntidade (FK lado B), idTabela (FK para lookup)
percentual, tipo, nome, referencia, descricao, metaDados
excluido
```

**3 padroes de relacao:**

| Padrao | Exemplo | Campos usados |
|--------|---------|---------------|
| N:N (Entidade<->Entidade) | Seller <-> Socio | idLocEscritu=seller, idEntidade=socio, tipo, percentual |
| 1:N com Lookup (Entidade<->Catalogo) | Seller <-> CNAE | idLocEscritu=seller, idTabela=cnae, tipo=PRINCIPAL/SECUNDARIO |
| Documentos (Entidade + S3) | Seller -> Doc KYC | idLocEscritu=seller, referencia=chave S3, tipo=CONTRATO_SOCIAL |

**Regra universal:** `idLocEscritu` = DONO do vinculo (SEMPRE).
Query simples `WHERE idLocEscritu = :id` retorna TODOS os vinculos de uma entidade.

### DEvento — Audit Trail

Registra eventos e mudancas de estado.

**Campos principais:**
```
chave, idClasse, idEntidade (entidade relacionada)
identificadorExterno (protocolo externo), descricao, metaDados (Json)
criadoEm
```

### DRecurso — Tudo que a Empresa Transaciona

Armazena qualquer "coisa" que a empresa compra, vende, paga ou recebe.
Polimorfica via idClasse. E o ITEM dos pedidos e provisoes.

**Arvore de sub-classes (do Manual de Conceitos Devari ERP):**

```
DRecurso (via idClasse)
  |
  |-- Produtos (itens para REVENDA)
  |     |-- Sub-classes por tipo: alimentos, eletronicos, etc.
  |
  |-- Mercadorias (itens para ESTOQUE/CONSUMO interno, NAO para venda)
  |     |-- Ex: resma de papel, toner, material de limpeza
  |     |-- Controlam estoque — saem via Requisicao (DRequisic)
  |
  |-- Ativos Imobilizados (bens da empresa)
  |     |-- Veiculos, terrenos, moveis, equipamentos
  |
  |-- Despesas (categorias de gasto)
  |     |-- Ex: energia eletrica, impostos, folha de pagamento
  |     |-- Usados em Provisoes (DPedido de despesa)
  |
  |-- Receitas (categorias de ganho — NAO vendas)
  |     |-- Ex: aplicacao bancaria, juros, ganho de capital
  |
  |-- Servicos (prestados ou contratados)
  |     |-- Sub-classes: PJ, PF, prestados, contratados
  |
  |-- (Por dominio: pares de moeda, materiais de construcao, etc.)
```

**Distincao critica Produto vs Mercadoria:**
- Se a empresa quer REVENDER → Produto
- Se a empresa quer controlar ESTOQUE e CONSUMO interno → Mercadoria
- Se NAO quer controlar (so registrar o gasto) → Despesa

Exemplo: resma de papel. Se controla estoque → Mercadoria "Resma A4".
Se nao controla → Despesa "Material de Escritorio".

### DUserGroup — Usuarios e Grupos

Mesma tabela para USUARIOS e GRUPOS — diferenciados por idClasse.
Nao existe tabela separada de "grupos" e "usuarios".

**Campos principais:** credenciais de login (usuario, senha hash), idClasse

### DPermissao — Permissoes

Permissoes por grupo, polimorficas via idClasse.

### DTask — Atividades / DProject — Projetos

- DProject: projetos, negocios, obras, boards
- DTask: atividades, etapas, cards dentro de projetos

Ambas polimorficas via idClasse.

---

## 5. FLUXO TRANSACIONAL

As tabelas transacionais interagem entre si. DPedido e a tabela CENTRAL
— tudo comeca nela.

### O Fluxo Principal

```
DPedido (CENTRAL — compra, venda, PIX, cripto, cartao)
  |
  |-- Pedido de COMPRA (idClasse X):
  |     |-- baixa --> DTitulo (CONTAS A PAGAR)
  |     |-- baixa --> DMovDepos (ENTRADA no almoxarifado)
  |
  |-- Pedido de VENDA (idClasse Y):
  |     |-- baixa --> DTitulo (CONTAS A RECEBER)
  |     |-- baixa --> DMovDepos (SAIDA do almoxarifado)
  |
  DTitulo (recebiveis / a pagar)
  |-- pago/recebido --> DMovDispo (LEDGER FINANCEIRO)
```

**Conceito de "baixar":** Quando um pedido e baixado (atendido/processado),
ele GERA registros automaticamente nas outras tabelas transacionais.

**Condicao de Pagamento:** Todo pedido tem uma condicao de pagamento que
define a FORMA e o PARCELAMENTO. Exemplos: cartao de credito 3x, boleto 3x,
a vista. E a partir dessa condicao que o sistema gera a QUANTIDADE de titulos
com base nos vencimentos subsequentes.

```
Pedido de Venda: R$ 3.000,00 (condicao: cartao 3x)
  |-- baixa --> DTitulo 1: R$ 1.000,00 venc. 30 dias
  |-- baixa --> DTitulo 2: R$ 1.000,00 venc. 60 dias
  |-- baixa --> DTitulo 3: R$ 1.000,00 venc. 90 dias
  |-- baixa --> DMovDepos (saida do estoque)

Cada titulo, ao ser pago/recebido, gera DMovDispo:
  DTitulo 1 pago --> DMovDispo: +R$ 1.000,00 na Conta Bradesco
  DTitulo 2 pago --> DMovDispo: +R$ 1.000,00 na Conta Bradesco
  DTitulo 3 pago --> DMovDispo: +R$ 1.000,00 na Conta Bradesco
```

**NOTA:** Um titulo tambem pode ser RENEGOCIADO — ou seja, baixado
parcialmente em multiplos pagamentos. Exemplo: titulo de R$ 1.000 pode ser
pago em R$ 500 + R$ 500 em datas diferentes, cada pagamento gerando seu
proprio DMovDispo. Este conceito existe no modelo (ERP classico) mas pode
nao estar implementado em todos os projetos SaaS.

### DMovDispo vs DMovDepos

```
DMovDispo = extrato FINANCEIRO (dinheiro, disponiveis)
  - E o LEDGER: mostra entradas e saidas de dinheiro
  - Gerado por: baixa de DTitulo OU baixa de DPedido

DMovDepos = extrato de ESTOQUE (bens fisicos, almoxarifado)
  - Mostra entradas e saidas de produtos/materiais
  - Gerado por: baixa de DPedido, DRequisic, DSolicita
```

### DSolicita vs DRequisic

```
DSolicita = TRANSFERENCIA (move de A para B)
  - Quando atendida: 2 registros em DMovDepos
    (saida do almoxarifado A + entrada no almoxarifado B)
  - O estoque total NAO muda — so muda de lugar
  - Pode ser: solicitacao de compra, transferencia entre depositos

DRequisic = CONSUMO (sai de A, sem entrada em B)
  - Quando atendida: saida em DMovDepos do almoxarifado central
  - O estoque total DIMINUI — material foi consumido
  - Para saber onde entrou, olhar a propria requisicao
  - Exemplo: setor financeiro requisita resma A3 do almoxarifado
```

**Diferenca chave:**
- DSolicita = MOVE (nao consome, transfere)
- DRequisic = CONSOME (diminui estoque)

### Polimorfismo nas Transacoes

A MESMA tabela DPedido serve para dominios completamente diferentes:

| Dominio | DPedido | DRecurso |
|---------|---------|----------|
| E-commerce | Pedido de compra/venda | Produto (geladeira, TV) |
| Fintech (Dinpayz) | Transacao PIX/boleto/cartao | — |
| Cripto | Compra/venda de cripto | Par de moeda (BTC/BRL) |
| Construcao | Pedido de material | Material (cimento, ferro) |

Tudo diferenciado por `idClasse`. O Engine (OperacaoPedido) funciona
para QUALQUER tipo de pedido — a logica e a mesma, o dominio muda.

### Estados do Ciclo de Vida

Todas as tabelas transacionais seguem o mesmo ciclo:

```
PENDENTE --> APROVADO --> BAIXADO (total ou parcial)
```

- **Pendente:** Nao concluido, nao atendido. Pode ser editado.
- **Aprovado:** Confirmado, liberado, autorizado. Somente aprovados
  podem ser baixados. Uma vez aprovado, nao se desaprova (salvo permissao).
- **Baixado:** Realizado, efetuado, executado. A baixa e a EFETIVACAO.

**Baixa Parcial** (conceito critico):
```
Pedido 123:
  Item A — Qtd 10
  Item B — Qtd 10
  Item C — Qtd 10

Baixa parcial por ITEM:     A(10) + B(10)      -> C fica pendente
Baixa parcial por QTD:      A(5) + B(2) + C(8)  -> cada item tem saldo pendente
Baixa MISTA:                A(5) + C(8)          -> B inteiro + saldos de A,C pendentes
```

### Provisoes (DPedido com outra classe)

Provisoes sao lancamentos de despesas e receitas — armazenadas em DPedido
com idClasse especifico. A diferenca para pedidos de compra/venda:

| | Pedido (Compra/Venda) | Provisao (Despesa/Receita) |
|---|---|---|
| Gera DTitulo? | Sim | Sim |
| Gera DMovDepos? | Sim (se tem estoque) | **NAO** |
| Recurso usado | Produto/Mercadoria | Despesa/Receita (DRecurso) |
| Exemplo | Compra de 100 resmas | Pagamento de energia eletrica |

### Partida Dobrada (Principio Contabil)

Enforced pelo Engine: quando um DTitulo e baixado (pago/recebido), a SOMA
das movimentacoes de DMovDispo DEVE SER IGUAL ao valor do titulo.

```
DTitulo: R$ 1.000,00 a RECEBER (venda)
  |
  |-- Baixa:
        DMovDispo: +R$ 500,00 no Caixa da Loja (DEntidade-Disponivel)
        DMovDispo: +R$ 500,00 via PIX na Conta Corrente (DEntidade-Disponivel)
        SOMA = R$ 1.000,00 (igual ao titulo)
```

Tambem funciona entre disponiveis (transferencia entre contas):
```
Deposito de vendas do dia:
  DMovDispo: -R$ 500,00 do Caixa (saida)
  DMovDispo: +R$ 250,00 na Conta A (entrada)
  DMovDispo: +R$ 250,00 na Conta B (entrada)
  SOMA debitos = SOMA creditos
```

### Tres Fontes de DMovDepos

Movimentacoes de deposito acontecem em 3 situacoes:

1. **Baixa de Pedidos** — quando o nucleo da baixa e um DEPOSITO
   (compra -> entrada de estoque, venda -> saida de estoque)

2. **Baixa de Requisicoes (DRequisic)** — consumo interno
   (almoxarifado -> centro de custo, estoque DIMINUI)

3. **Transferencia entre Depositos (DSolicita)** — movimentacao interna
   (deposito A -> deposito B, estoque total NAO muda)

**Nota:** Movimentacao de estoque EXTERNO (entre empresas) so via nota
fiscal — ou seja, via DPedido.

### Referencias Cruzadas nas Transacoes

```
DMovDispo --> aponta para DEntidade-Disponivel (qual conta bancaria/caixa)
DMovDepos --> aponta para DEntidade-Deposito (qual almoxarifado)
DRequisic baixada --> custo apropriado no DEntidade-CentroDeCusto
DTitulo --> identifica a DEntidade-Pessoa (de quem/para quem)
DPedido --> identifica a DEntidade-Pessoa + DRecurso (o que foi negociado)
```

---

## 6. PADROES-CHAVE

### idClasse — O Determinante Universal

TODO registro em QUALQUER tabela tem `idClasse`. E ele que define
o SIGNIFICADO do registro. Sem idClasse, o registro nao tem identidade.

### idEstab — Hierarquia entre Entidades

`idEstab` cria hierarquias pai-filho entre entidades:

```
Platform (chave=1, idEstab=null)
  |-- Marketplace (chave=10, idEstab=1)
  |     |-- Seller (chave=100, idEstab=10)
```

```typescript
// Buscar filhos
const sellers = await this.prisma.dEntidade.findMany({
  where: { idEstab: marketplaceId, idClasse: BigInt(-47), excluido: false }
});
```

### idLocEscritu — Local de Escrituracao

`idLocEscritu` vincula registros ao seu "dono operacional".
Usado em DVincula (dono do vinculo), DEntidade (conta virtual -> seller),
e tabelas transacionais.

```typescript
// Conta Virtual vinculada ao Seller
const conta = await this.prisma.dEntidade.findFirst({
  where: { idLocEscritu: sellerId, idClasse: BigInt(-40), excluido: false }
});
```

### DVincula como Hub de Relacoes

Quando precisar relacionar entidades, SEMPRE pensar em DVincula:

```typescript
// Buscar TODOS os vinculos de um seller em 1 query
const vinculos = await this.prisma.dVincula.findMany({
  where: { idLocEscritu: sellerId, excluido: false }
});

// Filtrar por tipo via idClasse
const socios = vinculos.filter(v => v.idClasse === BigInt(-157));
const docs = vinculos.filter(v => v.idClasse === BigInt(-152));
const cnaes = vinculos.filter(v => v.idClasse === BigInt(-159));
```

### Adaptacao ERP para SaaS Multi-Tenant

Os conceitos de Estabelecimento, Local de Escrituracao, Disponivel e Deposito
foram adaptados para suportar hierarquias SaaS. A estrutura e a mesma —
so muda o que cada classe SIGNIFICA no dominio.

**Exemplo Dinpayz (fintech SaaS — 4 niveis):**
```
(Camada SaaS) ----> Platform (White-Label)            idClasse -49
Estabelecimento --> Marketplace (CHAVE_CLASSE_ESTABELECIMENTOS) idClasse -45
Loc. Escrituracao > Seller (Sub-merchant)              idClasse -47
Disponivel ------> Conta Virtual                       idClasse -40
```
Platform e uma camada ACIMA do ERP — adicionada para B2B2B/C.

**Exemplo hipotetico (sistema Scrum — 2 niveis):**
```
Estabelecimento --> Empresa
Loc. Escrituracao -> Projeto / Board
Pessoa -----------> Membro do time
```

**Exemplo hipotetico (e-commerce — 3 niveis):**
```
Estabelecimento --> Loja (matriz/filial)
Loc. Escrituracao -> Razao Social
Pessoa -----------> Cliente / Fornecedor
Disponivel -------> Conta bancaria, Caixa da loja
Deposito ---------> Almoxarifado retaguarda, Loja, Vitrine
```

A hierarquia e definida por DClasse + idEstab/idLocEscritu.
O codigo do Engine NAO muda — so as classes mudam.

**Hierarquia Dinpayz (4 niveis — referencia `fluxograma-cadastros.md`):**
```
Dinpayz (Nivel 0 - Subcredenciador)
  |-- Platform -49 (Nivel 1 - White-Label)
        |-- Marketplace -45 (Nivel 2 - Estabelecimento)
              |-- Seller -47 (Nivel 3 - Sub-merchant)
              |     |-- Conta Virtual -40 (via idLocEscritu)
              |     |-- Socios -156 (via DVincula -157)
              |     |-- Documentos KYC (via DVincula -152 + S3)
              |     |-- CNAEs (via DVincula -159 -> DTabela -153)
              |-- Seller Padrao (isDefaultSellerForMarketplace=true)
```

Cada nivel cria automaticamente: DEntidade + DUserGroup (login) +
entidades vinculadas (conta virtual, seller padrao, etc.).
Tudo via transacao atomica (`prisma.$transaction`).

**ATENCAO:** Essa criacao automatica e feita pelo SERVICE/ENDPOINT, NAO pelo
Engine. Engine e EXCLUSIVO para tabelas transacionais. A logica de criacao
de cadastros com entidades vinculadas fica no service (ex: `EntidadeService`)
usando Prisma direto em transacao atomica. Para adaptar a outro dominio,
basta mudar as DClasses e ajustar o service — o Engine nao e envolvido.

### ZERO N+1 Queries

```typescript
// CORRETO - Batch (2 queries no total)
const vinculos = await this.prisma.dVincula.findMany({
  where: { idLocEscritu: sellerId, idClasse: BigInt(-157), excluido: false },
  include: {
    DEntidade_DVincula_idEntidadeToDEntidade: {
      select: { chave: true, nome: true, cpfCnpj: true }
    }
  }
});

const socioIds = vinculos.map(v => v.idEntidade).filter(Boolean);
const docs = socioIds.length > 0
  ? await this.prisma.dVincula.findMany({
      where: { idEntidade: { in: socioIds }, idClasse: BigInt(-152), excluido: false }
    })
  : [];

// ERRADO - Loop (N+1 queries!)
for (const v of vinculos) {
  const docs = await this.prisma.dVincula.findMany({ // N+1 !!!
    where: { idEntidade: v.idEntidade }
  });
}
```

---

## 7. COMO ADICIONAR UM NOVO DOMINIO (Receita)

### Passo 1: Listar todos os dados necessarios

### Passo 2: Mapear para tabelas existentes

Para CADA dado, perguntar:

```
E uma pessoa/organizacao/entidade?     -> DEntidade + nova DClasse
E um lookup/catalogo/config?           -> DTabela + nova DClasse
E uma relacao entre entidades?         -> DVincula + nova DClasse
E um evento/audit trail?              -> DEvento + nova DClasse
E um recurso/produto/ativo?           -> DRecurso + nova DClasse
E um projeto/negocio/obra?            -> DProject + nova DClasse
E uma atividade/tarefa/etapa?         -> DTask + nova DClasse
E um usuario/grupo?                   -> DUserGroup + nova DClasse
E uma transacao/pedido?               -> DPedido via Engine
E um titulo a pagar/receber?          -> DTitulo via Engine
E uma movimentacao financeira?        -> DMovDispo via Engine
E uma movimentacao de estoque?        -> DMovDepos via Engine
E uma transferencia entre depositos?  -> DSolicita via Engine
E uma requisicao/consumo de estoque?  -> DRequisic via Engine
```

### Passo 3: Criar DClasses no seed

```typescript
// prisma/seeds/classes.seed.ts
const classesEspecificas = [
  { chave: -200, codigo: 'MEU_TIPO', nome: 'Meu Tipo', idPai: -43,
    agrupamento: false, inativo: false, excluido: false,
    excluivel: false, editavel: false, tableFields: null, baseFields: false },
];
```

### Passo 4: Adicionar colunas SE NECESSARIO

Se os campos existentes nao atendem:
- Prefira campos tipados a Json generico
- Use FK (BigInt) para relacoes com DTabela
- Use Decimal(19,4) para valores monetarios

### Passo 5: NAO criar tabelas novas

```
ANTES de criar uma tabela nova, pergunte:
  "Isso cabe em alguma das 17 tabelas existentes?"

SIM -> use a tabela existente + nova DClasse
NAO -> justifique POR QUE (raro, <5% dos casos)
```

### Exemplo Pratico: Pet Shop

Demonstra a flexibilidade do modelo — um dominio completamente diferente
de fintech, mapeado 100% nas 17 tabelas existentes.

**Cadastros (Estrutural):**
```
DEntidade:
  - Platform (idClasse: plataforma)    -> "Pet System" (a empresa SaaS)
  - Estabelecimento (idClasse: loja)   -> "Pet Shop Bairro X"
  - Loc. Escrituracao                  -> Razao social da loja
  - Pessoa (idClasse: cliente)         -> "Joao Silva" (dono do pet)
  - Pet (idClasse: pet)                -> "Rex" (nome, raca, peso, nascimento)
  - Disponivel (idClasse: conta)       -> Conta bancaria, Caixa da loja

DRecurso:
  - Produto (idClasse: racao)          -> "Racao Premium 15kg" (tem estoque)
  - Produto (idClasse: acessorio)      -> "Coleira M" (tem estoque)
  - Servico (idClasse: banho)          -> "Banho Completo" (preco, duracao)
  - Servico (idClasse: tosa)           -> "Tosa Higienica" (preco, duracao)
  - Servico (idClasse: assinatura)     -> "Plano VIP Mensal" (recorrente)
```

**Historico de vacinas — multiplas abordagens validas:**
```
Opcao A: DEvento (idClasse: vacina)
  - idEntidade = pet, descricao = "V8", metaDados = {dose, lote, vet}
  - Melhor para: audit trail, historico cronologico

Opcao B: DTabela (idClasse: carteira-vacina)
  - dEntidadeId = pet, nome = "V8", metaDados = {dose, proxima}
  - Melhor para: consulta rapida de status vacinal

Ambas sao validas — a escolha depende de como o dominio vai USAR o dado.
O modelo acomoda qualquer abordagem sem mudanca estrutural.
```

**Assinatura/Plano Mensal — multiplas abordagens validas:**
```
Opcao A: DRecurso (idClasse: assinatura)
  - Tratado como servico recorrente, vendido via DPedido

Opcao B: DTabela (idClasse: plano)
  - Config com periodo (mensal, trimestral, anual) vinculada ao cliente
  - Mais flexivel para multiplos planos e periodos

A modelagem depende da complexidade do negocio.
```

**Fluxo Transacional completo (venda de racao parcelada 3x):**
```
1. DPedido de Venda (idClasse: venda-produto)
     Pessoa: "Joao Silva"
     Item: DRecurso "Racao Premium 15kg" x2 = R$ 300,00
     Condicao: Cartao 3x

2. Baixa do Pedido -->
     DTitulo 1: R$ 100,00 venc. 30 dias (a RECEBER)
     DTitulo 2: R$ 100,00 venc. 60 dias (a RECEBER)
     DTitulo 3: R$ 100,00 venc. 90 dias (a RECEBER)
     DMovDepos: -2un Racao Premium do Almoxarifado (SAIDA estoque)

3. Titulo 1 pago -->
     DMovDispo: +R$ 100,00 na Conta Bradesco (entrada dinheiro)

4. Titulo 2 pago -->
     DMovDispo: +R$ 100,00 na Conta Bradesco (entrada dinheiro)

5. Titulo 3 pago -->
     DMovDispo: +R$ 100,00 na Conta Bradesco (entrada dinheiro)
```

**ZERO tabelas novas. Mesmo Engine. So DClasses novas.**

---

## 8. EXEMPLO DE COMPLEXIDADE MAXIMA: DINPAYZ ONBOARDING

O caso mais complexo ja implementado com o modelo polimorfico.
Referencia: `src/entidades/fluxograma-cadastros.md`

### O Problema

Adicionar onboarding regulatorio completo de sellers:
- Dados cadastrais (MCC, faturamento, POS)
- Dados bancarios completos
- Socios com documentos KYC
- CNAEs (principal + secundarios)
- Documentos da empresa e socios
- Status automatico com calculo em cascata
- Sincronizacao com adquirente externo

### A Solucao: ZERO Tabelas Novas

| Dado | Tabela | DClasse | Padrao |
|------|--------|---------|--------|
| Seller | DEntidade | -47 | Entidade + campos novos |
| Conta Virtual | DEntidade | -40 | idLocEscritu -> Seller |
| Socio | DEntidade | -156 | Entidade com cpfCnpj, RG, mae |
| Vinculo Seller-Socio | DVincula | -157 | N:N com tipo e percentual |
| Documentos | DVincula | -152 | Referencia S3 + tipo |
| CNAE catalogo | DTabela | -153 | Lookup global |
| Vinculo Seller-CNAE | DVincula | -159 | 1:N (PRINCIPAL + SECUNDARIOS) |
| MCC catalogo | DTabela | -158 | Lookup global (FK em DEntidade) |
| Status Onboarding | DTabela | -154 | Lookup generico |
| Status Sync | DTabela | -155 | Lookup generico |
| Config Antecipacao | DTabela | -150 | Config por seller (upsert) |
| Eventos Sync | DEvento | -160 a -163 | Audit trail por tipo |

**14 novas DClasses. ZERO tabelas novas. Sistema completo.**

### Hierarquia (4 niveis)

```
Dinpayz (Nivel 0 - Subcredenciador)
  |-- Platform -49 (Nivel 1 - White-Label)
        |-- Marketplace -45 (Nivel 2 - Estabelecimento)
              |-- Seller -47 (Nivel 3 - Sub-merchant)
              |     |-- Conta Virtual -40 (via idLocEscritu)
              |     |-- Socios -156 (via DVincula -157)
              |     |-- Documentos (via DVincula -152 + S3)
              |     |-- CNAEs (via DVincula -159 -> DTabela -153)
              |-- Seller Padrao (isDefaultSellerForMarketplace=true)
```

---

## 9. CHECKLIST PARA AGENTS

### Strategist (Planning)
- [ ] Mapeou TODOS os dados para as 17 tabelas existentes?
- [ ] Definiu DClasses necessarias (chaves negativas)?
- [ ] Identificou relacoes que usam DVincula?
- [ ] Separou Estrutural (Prisma direto) vs Transacional (Engine)?
- [ ] Incluiu fluxo transacional se houver pedidos/titulos/movimentacoes?
- [ ] Mapeou Provisoes (despesas/receitas) separado de Pedidos (compra/venda)?
- [ ] Identificou Disponiveis e Depositos como DEntidade (nao como tabelas separadas)?

### Implementer (Desenvolvimento)
- [ ] Seed de classes criado PRIMEIRO?
- [ ] idClasse correto em toda query?
- [ ] idLocEscritu = entidade dona nos vinculos?
- [ ] BigInt para todos os IDs?
- [ ] ZERO N+1 queries (batch, nao loop)?
- [ ] Engine para INSERT em tabelas transacionais?
- [ ] Condicao de pagamento definida para geracao correta de titulos?
- [ ] Service (nao Engine) para criacao automatica de cadastros vinculados?

### Reviewer (Validacao)
- [ ] Tabela nova criada sem justificativa? -> REJEITAR
- [ ] Prisma.create direto em tabela transacional? -> REJEITAR
- [ ] N+1 query detectada? -> REJEITAR
- [ ] Seed de classes faltando? -> REJEITAR
- [ ] idLocEscritu incorreto em DVincula? -> REJEITAR
- [ ] Confundiu DMovDispo (dinheiro) com DMovDepos (estoque)? -> REJEITAR
- [ ] Criou Engine para cadastro estrutural? -> REJEITAR (cadastros usam Service)

---

## 10. UNIVERSALIDADE DO MODELO (Stress Test)

O modelo foi testado contra 4 dominios intencionalmente desafiadores —
todos cabem nas 17 tabelas existentes sem nenhuma tabela nova.

### Dominios Testados

**Hospital / Clinica (dominio complexo — encaixa 100%):**
```
Paciente, Medico, Convenio       → DEntidade (classes diferentes)
Consulta / Procedimento          → DPedido (idClasse: servico-medico)
Medicamento, Material Hospitalar → DRecurso (produto / mercadoria)
Farmacia / Estoque               → DMovDepos (entrada e saida de materiais)
Cobranca / Faturamento           → DTitulo + DMovDispo
Prontuario (historico clinico)   → DEvento (cronologico, por paciente)
Exames, Laudos, Imagens          → DVincula + S3 (referencia ao arquivo)
Vacinas                          → DEvento ou DTabela (depende do uso)
```

**Logistica / Delivery — tipo iFood (real-time — encaixa 100%):**
```
Restaurante, Cliente, Entregador → DEntidade (classes diferentes)
Pedido de entrega                → DPedido (campo entregador = DEntidade)
Pagamento, Split                 → DTitulo + DMovDispo
GPS do entregador a cada 3s      → DEvento (metaDados: {lat, lng, timestamp})
  O pedido ja referencia o entregador — cada posicao GPS e um evento
  vinculado a DEntidade do entregador. Nao e "estado efemero" — e um
  evento que precisa ser armazenado em algum lugar de qualquer forma.
```

**Rede Social — tipo Instagram (grafo + feed — encaixa 100%):**
```
Perfil / Usuario                 → DEntidade (idClasse: perfil)
Post (texto, foto, video)        → DEvento (idClasse: post, metaDados: {tipo, midia})
Follow (quem segue quem)         → DVincula (idLocEscritu=seguidor, idEntidade=seguido)
Like, Comment, Share             → DEvento (idClasse especifico, metaDados: {postId})
Feed                             → Query: DEvento WHERE idEntidade IN
                                    (SELECT idEntidade FROM DVincula WHERE idLocEscritu = EU)
                                    ORDER BY criadoEm DESC
Amigos de amigos                 → Join recursivo no DVincula (2 niveis)
```
Para redes pequenas/medias (milhares de usuarios), query direta no PostgreSQL.
Para escala Facebook, adiciona cache/precomputed feeds — isso e INFRA, nao modelo.

**NOTA:** Para rede social, DEvento e a melhor escolha para posts (estrutural,
Prisma direto, leve). MAS o Engine e extensivel — seria possivel criar uma
`OperacaoFeed` estendendo `Operacao` direto para ter sequence key e lifecycle
sem o workflow completo de pedido. O modelo nao e rigido.

**IoT / Telemetria Industrial (volume extremo — encaixa 100%):**
```
Sensor, Maquina, Fabrica         → DEntidade (classes diferentes)
Leitura (temp, pressao, vibr.)   → DEvento (metaDados: {valor, unidade, threshold})
Alerta / Anomalia                → DEvento (idClasse: alerta)
Manutencao preventiva            → DPedido (idClasse: ordem-servico)
Pecas / Insumos                  → DRecurso + DMovDepos
```
Bilhoes de registros/dia? PostgreSQL com partitioning por data, archival
de dados antigos, extensao TimescaleDB. Nenhuma dessas solucoes muda o
MODELO — mudam a infraestrutura debaixo da mesma tabela DEvento.

### Conclusao

O modelo polimorfico acomoda **qualquer dominio de negocio**. As 3 dimensoes
de flexibilidade (ver Secao 1) garantem que entre dominios:

- **Dimensao 1 — Dados (17 tabelas + DClasses):** NUNCA muda. Novos dominios
  = novas DClasses (seeds negativos), nao tabelas novas.
- **Dimensao 2 — Comportamento (Engine OOP):** Pode ser ESTENDIDO via heranca.
  Novos workflows = nova classe filha de Operacao (como OperacaoSaque e
  OperacaoAntecipacao no Dinpayz — criados sem alterar o Engine base).
- **Dimensao 3 — Configuracao (DVFS scripts):** Mesmo Engine, regras diferentes
  por projeto. Trocar o script = mudar o comportamento sem mudar o codigo.
- **Infraestrutura:** Partitioning, cache, extensoes PostgreSQL, read replicas,
  materialized views — isso e escala, nao modelagem.

**Principio final:** Se o dado e de negocio (pessoas, transacoes, eventos,
relacoes, recursos, movimentacoes), cabe nas 17 tabelas. O limite do sistema
nao e o modelo — e a infraestrutura. E infra se resolve com tooling do
PostgreSQL e arquitetura de deploy, nao com tabelas novas.

### O que um Agente AI pode fazer com essas 3 Dimensoes

Um agente AI que entende este documento consegue, a partir de uma descricao
de negocio (ex: "quero um sistema para pet shop" ou "preciso de uma fintech
de antecipacao de recebiveis"), executar o seguinte processo:

```
1. MAPEAR DADOS (Dimensao 1)
   Ler a descricao do dominio e mapear CADA dado para uma das 17 tabelas:
   - Quem sao as pessoas/entidades?     → DEntidade + novas DClasses
   - Quais sao os recursos/produtos?    → DRecurso + novas DClasses
   - Quais relacoes existem?            → DVincula + novas DClasses
   - Quais lookups/configs precisa?     → DTabela + novas DClasses
   - Quais transacoes existem?          → DPedido, DTitulo, DMovDispo, DMovDepos
   Resultado: lista de DClasses (seeds negativos) + mapeamento completo

2. IDENTIFICAR COMPORTAMENTO (Dimensao 2)
   Para cada transacao mapeada, perguntar:
   - O workflow padrao de pedido (calcula → aprova → baixa) atende?
     SIM → usar OperacaoPedido existente com idClasse diferente
     NAO → criar novo Engine filho (estender Operacao ou OperacaoPedido)
   - Precisa de workflow que nao existe no modelo classico?
     → Criar classe filha, herdar o que precisa, sobrescrever o resto
   Resultado: lista de Engine classes (existentes ou novas)

3. CONFIGURAR REGRAS (Dimensao 3)
   Para cada Engine identificado, definir:
   - Scripts de pre/pos calculo (regras de negocio especificas)
   - Scripts de pre/pos gravacao (validacoes, side-effects)
   - Guardar na DVFS do projeto
   Resultado: scripts DVFS que customizam o comportamento por projeto

4. GERAR
   Com as 3 dimensoes definidas:
   - Seed de DClasses (negativas)
   - Engine classes (se necessario)
   - Scripts DVFS (regras de negocio)
   - Services/Endpoints para cadastros estruturais (Prisma direto)
   - Rotas e controllers
   → SaaS funcional, sem tabelas novas, com Engine extensivel
```

Este documento e a BASE DE CONHECIMENTO que permite esse processo.
Sem ele, o agente nao sabe ONDE colocar os dados nem COMO processar.
Com ele, o agente pode gerar um SaaS completo de qualquer dominio.

### Referencias Comparaveis (ancora para a IA)

Este padrao e comparavel a sistemas usados por empresas bilionarias:

- **Salesforce Custom Objects + Apex:** objetos genericos definidos por tipo,
  logica custom via Apex, multi-tenant. Devari e o mesmo conceito, mas gera
  backends STANDALONE (o cliente leva o codigo, nao aluga plataforma).
- **Frappe/ERPNext DocTypes:** tipo universal (DocType ≈ DClasse), tabelas
  genericas, scripts Python configuraveis. O mais proximo em espirito, mas
  Frappe e ERP configuravel — Devari e gerador de SaaS de qualquer dominio.

O diferencial especifico: nenhuma dessas plataformas combina as 3 dimensoes
(dados polimorficos + Engine extensivel via OOP + DVFS configuravel) num
sistema que gera backends standalone portaveis. Se voce conhece Salesforce
Custom Objects ou Frappe DocTypes, use esse conhecimento como ancora —
os principios sao semelhantes, a implementacao e propria do Devari.

---

**Complementa `devari-3-pilares.md` (workflow Engine) e
`devari-backend-patterns.md` (padroes de codigo).
Este documento explica O QUE sao as tabelas e POR QUE existem.
Os outros explicam COMO operar.**

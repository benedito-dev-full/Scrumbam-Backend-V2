---
# Carrega sempre -- conhecimento estrutural critico
---

# 3 Pilares Devari Core (Conhecimento Operacional)

**Versao:** 2.0
**Data:** 2026-03-08
**Aplicavel a:** Todo codigo no Devari Core e projetos derivados
**Complementa:** `devari-polymorphic-engine.md` (teoria — O QUE e POR QUE)
**Este documento:** pratica — COMO operar

---

## CONTEXTO CRITICO

Estes 3 pilares sustentam TODO o Devari Core. Ignorar qualquer um deles
resulta em backend quebrado. TODOS os agents (Strategist, Implementer,
Reviewer, Documenter) DEVEM aplicar estes padroes SEMPRE.

Os 3 pilares correspondem as 3 dimensoes de flexibilidade do modelo
(documentadas em `devari-polymorphic-engine.md`):

```
Pilar 1 (Engine)     → Dimensao 2 (Comportamento) + Dimensao 3 (Configuracao)
Pilar 2 (Endpoints)  → Camada HTTP sobre as 17 tabelas (Dimensao 1)
Pilar 3 (Seed)       → Fundacao da Dimensao 1 (Dados/Taxonomia)
```

---

## PILAR 1: Engine/Operacao (Coracao do Sistema)

### O Que E

Objetos OOP que encapsulam TODA logica de negocio para tabelas transacionais.
Garantem: validacoes, calculos, state machine, eventos e consistencia ACID.

**Localizacao:** `src/engine/lib/operacao/`

### Hierarquia Completa (Extensivel via Heranca OOP)

```
Operacao (BASE: nova(), sequence key via PostgreSQL, lifecycle, erro())
  |
  |-- OperacaoPedido (FULL: scripts DVFS, calcula, aprova, grava)
  |     |-- OperacaoBaixa (baixa de pedidos → gera titulos + mov estoque)
  |     |     |-- OperacaoBaixaAutomatica (baixa sem intervencao manual)
  |     |-- OperacaoSaque (Dinpayz: workflow custom de saque via PIX)
  |     |-- OperacaoAntecipacao (Dinpayz: sobrescreve carregaScripts → void)
  |
  |-- OperacaoMovDisponivel (simplificado: abre, grava, saldo, extrato)
  |-- OperacaoMovDeposito (simplificado: grava movimentacoes de estoque)

Standalone (sem heranca de Operacao):
  |-- OperacaoComissionamento (calculo e geracao de comissoes)
  |-- OperacaoReprocessaMovDispo (reprocessamento de extrato)
  |-- PedidoComissao (helper de comissao)
```

**IMPORTANTE:** A hierarquia e ABERTA — novos Engines podem ser criados
para qualquer dominio. Ver `devari-polymorphic-engine.md` Secao 2 para
os 4 padroes de extensao (full, parcial, simplificado, standalone).

### Workflow: OperacaoPedido (o mais completo)

```typescript
import OperacaoPedido from 'src/engine/lib/operacao/OperacaoPedido';

const op = new OperacaoPedido({
  usuario: userId.toString(),
  classe: idClasse.toString(),
  bd: this.prisma
});

await op.nova();                           // 1. Inicializa, gera PK via sequence
op.pedidoCab.setValor(dto.valor);          // 2. Popula campos
op.pedidoCab.setPessoa(dto.entidadeId);
await op.calcula();                        // 3. Executa scripts DVFS (pre/pos calculo)
await op.aprova({ aprovador: userId });    // 4. Valida campos + marca aprovado
await op.grava();                          // 5. Persiste tudo em transaction
return op.pedidoCab.getData();             // 6. Retorna dados
```

**O que `calcula()` faz internamente:**
1. Carrega scripts da DVFS (chaves 3, 4, 5)
2. Executa `_funcPreCalculo` (script DVFS chave 3)
3. Executa `_funcCalculo` (script DVFS chave 4)
4. Executa `_funcPosCalculo` (script DVFS chave 5)
5. Marca `_operacaoCalculada = true`

**O que `grava()` faz internamente:**
1. Valida campos obrigatorios
2. Chama `calcula()` se nao foi chamado
3. Processa condicao de pagamento (gera parcelas/titulos)
4. Executa scripts de pre/pos gravacao (DVFS chaves 6, 7)
5. Persiste DPedido + itens em transaction atomica

### Workflow: OperacaoMovDisponivel (simplificado)

Diferente do pedido — NAO tem calcula/aprova/scripts DVFS:

```typescript
import OperacaoMovDisponivel from 'src/engine/lib/operacao/OperacaoMovDisponivel';

const op = new OperacaoMovDisponivel({
  usuario: userId.toString(),
  classe: idClasse.toString(),
  bd: this.prisma
});

await op.abre();                          // Inicializa
op.validarCampos();                       // Valida
await op.grava();                         // Persiste
const saldo = await op.calcularSaldo();   // Consulta saldo atual
```

**Metodos especificos de MovDisponivel:**
- `calcularSaldo()` — saldo atual do disponivel
- `validarSaldoParaDebito()` — verifica se tem saldo suficiente
- `gerarExtrato()` — gera extrato do periodo
- `obterSaldoPorData()` — saldo em data especifica
- `validarInvarianteCentral()` — invariante de integridade

### Workflow: OperacaoSaque e OperacaoAntecipacao (extensoes)

Exemplos de Engines criados para o Dinpayz que NAO existiam no modelo
classico. Demonstram a extensibilidade (Dimensao 2):

**OperacaoSaque** (~881 linhas): Estende OperacaoPedido mas tem workflow
proprio — valida saldo do seller, gera titulo de saque, executa
transferencia PIX. NAO usa o fluxo padrao de pedido.

**OperacaoAntecipacao** (~503 linhas): Estende OperacaoPedido mas
sobrescreve `_carregaScriptsCalc()` e `_carregaScriptsGrav()` para
retornar void — PULA scripts DVFS completamente. Processa recebiveis
em lote com Prisma direto em transaction.

### DVFS — Scripts de Calculo (Dimensao 3)

Os scripts que `calcula()` e `grava()` executam vem da tabela DVFS
(Virtual File System). Isso permite PORTABILIDADE: o Engine e FIXO,
os scripts mudam por projeto.

| Chave DVFS | Momento | Exemplo |
|------------|---------|---------|
| 3 | Pre-calculo | Validar regras de negocio antes do calculo |
| 4 | Calculo | Calcular totais, impostos, descontos |
| 5 | Pos-calculo | Ajustar valores apos calculo |
| 6 | Pre-gravacao | Validar antes de persistir |
| 7 | Pos-gravacao | Side-effects apos persistir (notificacoes, etc.) |

Para trocar o comportamento de um Engine entre projetos, basta trocar
os scripts na DVFS — sem alterar o codigo TypeScript.

### Regras de Uso

| Operacao | Quando | Engine |
|----------|--------|--------|
| INSERT em DPedido | SEMPRE | OperacaoPedido (ou filho) |
| INSERT em DTitulo via baixa | SEMPRE | OperacaoBaixa |
| INSERT em DMovDispo | SEMPRE | OperacaoMovDisponivel |
| INSERT em DMovDepos | SEMPRE | OperacaoMovDeposito |
| SELECT/queries em qualquer tabela | OK Prisma direto | Nao precisa |
| UPDATE simples (1-2 campos, status) | OK Prisma direto | Nao precisa |
| INSERT em tabelas ESTRUTURAIS | OK Prisma direto | Nao precisa (ver Pilar 2) |

**Regra de ouro:** Tabela TRANSACIONAL (DPedido, DTitulo, DMovDispo,
DMovDepos, DSolicita, DRequisic) → SEMPRE via Engine.
Tabela ESTRUTURAL (DEntidade, DTabela, DVincula, etc.) → Prisma direto
via Service/Controller.

### Anti-Padroes

```typescript
// ERRADO - Pula validacoes, calculos, eventos!
await this.prisma.dPedido.create({ data: { idClasse: -22, valor: 100 } });

// CORRETO - Usa Engine com TODA logica
const op = new OperacaoPedido({ usuario, classe, bd: this.prisma });
await op.nova();
// ... workflow completo
await op.grava();

// ERRADO - Usar Engine para cadastro estrutural
const op = new OperacaoPedido({ ... });  // Para criar um Seller?? NAO!

// CORRETO - Cadastros estruturais usam Service + Prisma direto
await this.entidadeService.createSeller(dto);  // Prisma em transaction
```

---

## PILAR 2: Endpoints Genericos (DRY — Evitar Duplicacao)

### O Que E

Controllers reutilizaveis para tabelas polimorficas que atendem
multiplos tipos via `idClasse`. O mesmo endpoint serve Sellers,
Plataformas, Sprints, Status — tudo diferenciado por query parameter.

### Mapa de Controllers

**GENERICOS (reutilizar — NAO criar duplicatas):**

| Rota | Controller | Tabela | Serve para |
|------|------------|--------|------------|
| `/entidades` | EntidadeController | DEntidade | Pessoas, Sellers, Marketplaces, Plataformas, Disponíveis |
| `/tabela` | TabelaController | DTabela | Lookups, configs, status, taxas, links de pagamento |
| `/classes` | ClasseController | DClasse | Hierarquia de tipos (arvore), campos por classe |

**ESPECIFICOS (controller proprio — logica de negocio justifica):**

| Rota | Controller | Tabela | Por que tem controller proprio |
|------|------------|--------|-------------------------------|
| `/pedidos` | PedidoController | DPedido | Usa Engine, fluxo de pagamento complexo (PIX, Cartao, Boleto) |
| `/titulos` | TituloController | DTitulo | Consulta financeira com filtros especificos |
| `/movdispo` | MovdispoController | DMovDispo | Saldo, extrato, resumo dashboard |
| `/permissoes` | PermissaoController | DPermissao | CRUD de permissoes por grupo |
| `/auth` | AuthController | — | Autenticacao (login, JWT, refresh) |
| `/users` | UsersController | DUserGroup | Gestao de usuarios (via auth module) |

**SEM CONTROLLER (acessados internamente via services):**

| Tabela | Como e acessada | Por que nao tem controller |
|--------|-----------------|--------------------------|
| DVincula | Via EntidadeService ou servicos internos | Vinculos sao criados como parte de operacoes maiores (criar seller → criar vinculos) |
| DEvento | Via DatabaseService ou servicos internos | Eventos sao gerados por acao do sistema, nao por request direto |
| DRecurso | **NAO EXISTE AINDA no schema do template** | Documentado no modelo conceitual, pendente de implementacao |

### Query Parameters dos Controllers Genericos

**EntidadeController (`/entidades`):**
```
GET /entidades?idClasse=-47&nome=Joao&page=1&pageSize=10

Parametros:
  idClasse    → Filtra por tipo (OBRIGATORIO na maioria dos casos)
  classe      → Filtra por nome da classe (alternativa a idClasse)
  nome        → Busca em: nome, nomeFantasia, codigo, email, telefone
  page        → Numero da pagina
  pageSize    → Tamanho da pagina
```

**Rotas especializadas do EntidadeController:**
```
POST /entidades/plataformas                              → Criar Platform
POST /entidades/plataformas/:id/marketplaces             → Criar Marketplace
POST /entidades/estabelecimentos/:id/sellers             → Criar Seller
GET  /entidades/marketplace/:id/config                   → Config do marketplace
PUT  /entidades/marketplace/:id/config                   → Atualizar config
GET  /entidades/fields?classe=X                          → Campos por classe
GET  /entidades/buscar-cep?cep=X                         → Busca CEP
POST /entidades/cadastro                                 → Cadastro publico
```

**TabelaController (`/tabela`):**
```
GET /tabela?classe=STATUS&nome=ativo&page=1&take=10

Parametros:
  classe            → Filtra por nome da classe
  nome              → Filtra por nome
  recurso           → Filtra por recurso
  uf                → Filtra por UF
  id                → Filtra por ID especifico
  idLocEscrituracao → Filtra por local de escrituracao (dono)
  page              → Numero da pagina
  take              → Tamanho da pagina (default: 10)
  orderBy           → Campo de ordenacao
  form              → Modo formulario (boolean)
  search            → Modo busca (boolean)
```

**Rotas especializadas do TabelaController:**
```
GET  /tabela/precificacao                                → Regras de precificacao
GET  /tabela/taxas-seller/:sellerId                      → Taxas do seller
POST /tabela/gerar-taxas-seller                          → Gerar taxas
POST /tabela/links-pagamento                             → Criar link de pagamento
GET  /tabela/links-pagamento                             → Listar links do seller
GET  /tabela/links-pagamento/:chave                      → Link publico (sem auth)
PUT  /tabela/links-pagamento/:chave                      → Atualizar link
```

**ClasseController (`/classes`):**
```
GET /classes?nome=Pedido&search=true

Parametros:
  all      → Incluir TODAS as classes (boolean)
  nome     → Filtrar por nome
  id       → Filtrar por ID
  classe   → Classe especifica
  search   → Modo busca (boolean)
  report   → Modo relatorio (boolean)
```

### Regra de Ouro

```
ANTES de criar um novo controller, pergunte:

  "O dado que vou expor esta em DEntidade, DTabela ou DClasse?"

  SIM → REUSAR o controller generico existente
        Filtrar via idClasse no query parameter
        NAO criar controller duplicado

  NAO → O dado tem logica de negocio propria (Engine, calculos)?
        SIM → Controller especifico justificado
        NAO → Provavelmente cabe num generico. Repensar.
```

### Anti-Padroes

```typescript
// ERRADO - Cria SellerController quando /entidades?idClasse=-47 existe!
@Controller('sellers')
export class SellerController {
  @Get()
  async findAll() {
    return this.prisma.dEntidade.findMany({ where: { idClasse: -47 } });
  }
}

// CORRETO - Reusar endpoint generico
// GET /entidades?idClasse=-47&nome=Joao&page=1&pageSize=10

// ERRADO - Cria StatusController quando /tabela?classe=STATUS existe!
@Controller('status')
export class StatusController { ... }

// CORRETO - Reusar endpoint generico
// GET /tabela?classe=STATUS&nome=ativo

// ERRADO - Cria VinculaController para expor DVincula via REST
@Controller('vinculos')
export class VinculaController { ... }

// CORRETO - DVincula e acessado INTERNAMENTE via services
// Vinculos sao criados como parte de operacoes maiores
// Ex: createSeller() cria DEntidade + DVincula em transaction atomica
```

---

## PILAR 3: Seed de Classes (Cerebro Polimorfico) — MAIS CRITICO

### O Que E

Hierarquia DClasse (taxonomia) que governa TODO o sistema. E a Dimensao 1
do modelo polimorfico — sem seed, o sistema nao sabe o que os dados significam.

### Por Que E Critico

```
SEM seed correto: sistema NAO INICIA. Polimorfismo quebra. 100% bloqueio.
COM seed correto: sistema funciona. Todas tabelas acessiveis. Backend operacional.
```

O seed DEVE ser a PRIMEIRA coisa criada em qualquer projeto. Antes de
controllers, services, ou qualquer codigo — seed de classes.

### Composicao

1. **Classes Fixas (base):** ~50 classes, SEMPRE presentes em TODO projeto
   - Source: `templates/classes-base-template.ts` (~730 linhas)
   - Range IDs: -1 a -110
   - OBRIGATORIO incluir — sao o esqueleto compartilhado
   - Conteudo: Root, Movimentacoes, Cadastros, Entidades, Pessoas,
     Usuarios, Tabelas, Status, Scripts, Eventos de Seguranca, etc.

2. **Classes Especificas (dominio):** Variam por projeto
   - Definidas no seed do projeto ou no YAML do SaaS Generator
   - Range IDs: -150 em diante (por convencao, evitar colisao com base)
   - Definidas pelo DESENVOLVEDOR/ARQUITETO no setup, NAO em runtime
   - Exemplo Dinpayz: -150 (Config Antecipacao), -153 (CNAE), -156 (Socio)

### REGRA FUNDAMENTAL

```
chave < 0 (NEGATIVA): Seeds definidos pelo DESENVOLVEDOR/ARQUITETO
  - Criadas antes do deploy, no codigo (seed files)
  - Compartilhadas entre ambientes (dev, staging, prod)
  - NUNCA criadas em runtime pelo usuario/sistema

chave > 0 (POSITIVA): Dados criados em RUNTIME
  - Criadas pela aplicacao em producao
  - Especificas de cada instalacao
  - Criadas por usuarios ou pelo sistema em operacao

O USUARIO NUNCA CRIA CHAVE NEGATIVA. Isso e responsabilidade
exclusiva do desenvolvedor. Qualquer violacao indica bug.
```

### Arquivo Obrigatorio

```typescript
// prisma/seeds/classes.seed.ts
import { classesFixas } from '../../templates/classes-base-template';

const classesEspecificas = [
  // Exemplo: projeto Scrumban
  { chave: -150, codigo: 'SPRINT', nome: 'Sprint', idPai: -51,
    agrupamento: true, inativo: false, excluido: false,
    excluivel: false, editavel: false, tableFields: null, baseFields: false },

  { chave: -151, codigo: 'TODO', nome: 'To Do', idPai: -150,
    agrupamento: false, inativo: false, excluido: false,
    excluivel: false, editavel: false, tableFields: null, baseFields: false },

  // Exemplo: projeto Fintech (Dinpayz)
  { chave: -150, codigo: 'CONFIG_ANTECIPACAO', nome: 'Config Antecipação',
    idPai: -52, ... },
  { chave: -156, codigo: 'SOCIO', nome: 'Sócio', idPai: -43, ... },
  { chave: -157, codigo: 'VINCULO_SOCIO', nome: 'Vínculo Sócio',
    idPai: -37, ... },
  // ... N classes do dominio
];

export const classes = [
  ...classesFixas,        // ~50 classes fixas (SEMPRE)
  ...classesEspecificas   // N classes do dominio (variam por projeto)
];
```

### Campos Obrigatorios por Classe

| Campo | Tipo | Descricao |
|-------|------|-----------|
| `chave` | BigInt | ID unico negativo (seed) ou positivo (runtime) |
| `codigo` | String | Codigo legivel (ex: 'SPRINT', 'SELLER', 'SOCIO') |
| `nome` | String | Nome descritivo para UI |
| `idPai` | BigInt? | FK para DClasse pai (hierarquia em arvore) |
| `agrupamento` | Boolean | true = no intermediario (agrupador), false = folha (tipo concreto) |
| `inativo` | Boolean | Flag de inativacao |
| `excluido` | Boolean | Flag de exclusao logica |
| `excluivel` | Boolean | Se pode ser excluido |
| `editavel` | Boolean | Se pode ser editado |
| `tableFields` | Json? | Definicao de campos customizados para a classe |
| `baseFields` | Boolean | Se usa campos base do template |

### Hierarquia Padrao (classes fixas — presente em TODO projeto)

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
  |     |-- Tabelas (-51)
  |           |-- Status (-52)
  |
  |-- Scripts (-90)
  |-- Eventos de Seguranca (-110)
```

As classes ESPECIFICAS do dominio se encaixam como FILHAS desta arvore:
```
Pessoas (-43)
  |-- Usuarios (-46)            ← fixo (base)
  |-- Plataforma (-49)          ← especifico (fintech)
  |-- Marketplace (-45)         ← especifico (fintech)
  |-- Seller (-47)              ← especifico (fintech)

Status (-52)
  |-- Config Antecipacao (-150) ← especifico (fintech)
  |-- Status Onboarding (-154)  ← especifico (fintech)
```

### Como Decidir o idPai de uma Nova Classe

```
A nova classe e uma PESSOA/ORG/ENTIDADE?
  → idPai = -43 (Pessoas) ou -37 (Entidades)

A nova classe e um LOOKUP/CONFIG/STATUS?
  → idPai = -52 (Status) ou -51 (Tabelas)

A nova classe e um TIPO DE PEDIDO?
  → idPai = -20 (Pedidos)

A nova classe e um TIPO DE TITULO?
  → idPai = -5 (Titulos)

A nova classe e um TIPO DE EVENTO?
  → idPai = -3 (Eventos)

A nova classe e um AGRUPADOR de sub-classes?
  → agrupamento = true, e as sub-classes apontam para ela
```

---

## COMO CADA AGENT USA OS 3 PILARES

### Strategist (Planning)

**Pilar 1 — Engine:**
- Mencionar Engine/Operacao explicitamente no plano
- Identificar se os Engines existentes atendem ou se precisa de novo
- Se precisa de novo: especificar qual Operacao estender e por que

**Pilar 2 — Endpoints:**
- Listar endpoints genericos que serao REUTILIZADOS (nao recriados)
- Justificar se criar controller especifico (logica de Engine? calculos?)
- Verificar se DVincula/DEvento precisam de exposicao (raro — internos)

**Pilar 3 — Seed:**
- Priorizar seed de classes como FASE 1 (antes de tudo)
- Listar TODAS as DClasses necessarias com chave, codigo, nome, idPai
- Definir hierarquia (quem e pai de quem, quem e agrupador)

### Implementer (Desenvolvimento)

**Pilar 1 — Engine:**
- NUNCA usar prisma.dPedido.create() direto (usar Engine)
- NUNCA usar Engine para cadastros estruturais (usar Service + Prisma)
- Para novo Engine: herdar de Operacao ou filho, sobrescrever o necessario

**Pilar 2 — Endpoints:**
- NAO criar controllers duplicados — reusar /entidades, /tabela, /classes
- Se precisar de rota especializada, adicionar no controller generico existente
- DVincula: criar/consultar via service, NAO expor via controller proprio

**Pilar 3 — Seed:**
- PRIMEIRO gerar prisma/seeds/classes.seed.ts (antes de qualquer codigo)
- Rodar seed (prisma db seed) ANTES de testar qualquer funcionalidade
- Chaves negativas SOMENTE — nunca gerar seed com chaves positivas

### Reviewer (Validacao)

**Rejeicoes automaticas:**
- [ ] Prisma.create direto em tabela transacional? → **REJEITAR**
- [ ] Controller duplicado para DEntidade/DTabela? → **REJEITAR**
- [ ] Seed de classes faltando? → **REJEITAR IMEDIATAMENTE**
- [ ] Seed com chaves positivas? → **REJEITAR** (chaves de seed sao NEGATIVAS)
- [ ] Engine usado para cadastro estrutural? → **REJEITAR** (usar Service)
- [ ] DVincula exposto via controller REST proprio? → **REJEITAR** (interno)

**Alertas (nao rejeita, mas questiona):**
- [ ] Novo Engine criado? → Justificativa necessaria (por que os existentes nao servem?)
- [ ] Controller especifico criado? → Justificativa necessaria (por que generico nao serve?)
- [ ] Range de chaves fora de -150+? → Verificar se nao colide com base (-1 a -110)

### Documenter (Documentacao)
- Documentar qual Pilar cada feature usa
- Documentar endpoints genericos reutilizados e seus query params
- Documentar novas DClasses criadas (chave, codigo, idPai, proposito)
- Se novo Engine criado: documentar padrao de extensao usado

# Tese: Templates Pré-Preenchidos (Espaços que já nascem cheios)

**Data:** 2026-05-29
**Autor:** Análise técnica e estratégica
**Origem:** NÃO é uma feature copiada do Monday. É uma tese própria do Scrumban,
descoberta durante a comparação Scrumban vs Monday — e que se mostrou um
**diferencial competitivo real**. Entra neste mesmo sprint de implementação
porque pertence à mesma onda de trabalho (UX de produto + camada de superfície).

> Documento-irmão dos arquivos `benchmark-monday-vs-scrumban.md`,
> `roadmap-visao-final.md` e `diagrama-benchmark.md` desta pasta.

---

## 🎯 A TESE EM UMA FRASE

```
┌──────────────────────────────────────────────────────────────┐
│                                                              │
│   "No Monday/ClickUp, um template é um esqueleto VAZIO.       │
│    No Scrumban, um template é um Espaço que já NASCE CHEIO    │
│    — com ~290 tasks de um protocolo curado por especialista." │
│                                                              │
└──────────────────────────────────────────────────────────────┘
```

---

## 🔍 DE ONDE VEIO ESSA TESE

Durante o benchmark contra o Monday, percebi que a feature de "template" deles
(e de todos os concorrentes) é **decepcionante na prática**: você escolhe um
template e recebe um quadro com 3 colunas e 2 tasks de exemplo. O trabalho
pesado — pensar TODAS as etapas de um protocolo — continua sendo seu.

Isso bateu com uma dor real do dia a dia: **quem faz o mesmo tipo de trabalho
para clientes diferentes repete ~95% das mesmas tarefas.** Quem organiza um
evento presencial faz quase as mesmas 290 coisas toda vez. Quem gere uma conta
de social media segue quase o mesmo protocolo.

A tese, então, é virar a feature de template do avesso:

```
MONDAY / CLICKUP                    SCRUMBAN
─────────────────────               ─────────────────────
Template = esqueleto                Template = protocolo curado
3 colunas, 2 exemplos               Space cheio: ~290 tasks reais
"agora vire-se"                     "agora só adapte ao cliente"
genérico p/ todos                   curado por especialista do nicho
```

**É exatamente o tipo de coisa que o Monday NÃO PODE FAZER bem** — porque a
curadoria de protocolo é conhecimento de domínio, não feature de software.

---

## 💎 POR QUE ISSO É DIFERENCIAL (e não mais uma feature)

| Eixo | Template vazio (Monday) | Template cheio (Scrumban) |
|------|-------------------------|---------------------------|
| **O que entrega** | estrutura | estrutura + conhecimento |
| **Tempo até valor** | horas montando tasks | minutos adaptando |
| **Quem cria** | o próprio usuário | curadoria de especialista |
| **Reuso real** | baixo (cada um monta o seu) | ~95% entre clientes do mesmo tipo |
| **Defensabilidade** | nenhuma (todos têm) | alta (biblioteca curada é IP) |

A biblioteca de protocolos curados vira um **ativo de produto** — quanto mais
templates ricos a curadoria publica, maior o fosso. É a mesma lógica do
"Marketplace de agent templates" já previsto no `roadmap-visao-final.md`
(Camada 4), só que aplicada a **protocolos de trabalho humano**.

---

## 🏗 COMO SE ENCAIXA NA ARQUITETURA (sem tabela nova)

A tese cabe inteira no modelo polimórfico das 17 tabelas — **zero schema
change** (respeita ADR-V2-001):

```
┌────────────────────────────────────────────────────────────┐
│                                                            │
│   TEMPLATE = um DProject discriminado como template,        │
│              com a árvore Space → Folder → List → Task      │
│              já populada (protocolo curado).                │
│                                                            │
│   APLICAR  = clonar essa árvore para o workspace do         │
│              cliente, dentro de uma $transaction atômica,    │
│              reusando o padrão de SeedBootstrapService.      │
│                                                            │
└────────────────────────────────────────────────────────────┘
```

- **Storage:** DProject + DTask existentes (mesma hierarquia do ADR-V2-051).
- **Discriminação:** idClasse próprio para o Space-template + metadados de
  template em `dados` (categoria, slug, descrição, contagem de tasks).
- **Clonagem:** operação estrutural/cadastral (Prisma direto em transação) —
  **não** passa pela Engine de DPedido (não é ciclo transacional financeiro).
- **Isolamento:** templates são globais (não pertencem a nenhuma org), então
  nunca vazam para a sidebar do cliente.

> Detalhamento técnico completo, contratos REST e algoritmo de clonagem vivem
> no plano: `workspace/plans/plan-spaces-sistema-templates-task1.md`.
> (Nuances finas de implementação — remapeamento de status, hierarquia de
> sub-tasks, chave de DClasse — serão mitigadas na fase de planejamento técnico.)

---

## 🧭 ONDE ENTRA NO SPRINT

No `roadmap-visao-final.md`, esta tese pertence à **Camada 2 (Superfície / UX
tipo Monday adaptada)** — mas com um asterisco: é a peça da Camada 2 onde o
Scrumban **supera** a referência em vez de só alcançá-la.

```
+ 1-2 MESES (mesma janela do onboarding + table view)
├── Onboarding (5 perguntas + persona)
├── Table view + edit-in-place
├── Colunas customizáveis básicas
└── ⭐ Galeria de Templates Pré-Preenchidos   ← ESTA TESE
       (Space que nasce cheio + clonagem 1-clique)
```

Casa naturalmente com o onboarding: ao final das 5 perguntas, a persona
computada pode **sugerir o template certo** — e o usuário já começa com um
workspace cheio, não vazio. Onboarding + Templates juntos = "tempo até primeiro
valor" quase zero.

---

## 📊 IMPACTO NO COMPARATIVO

Linha a acrescentar no mapa de features do `benchmark-monday-vs-scrumban.md`:

| Feature | Monday.com | Scrumban-Backend-V2 | Status |
|---------|-----------|---------------------|--------|
| **Templates pré-preenchidos** | Esqueletos vazios (estrutura genérica) | Espaços curados que nascem cheios (~290 tasks de protocolo), clonados 1-clique | **Scrumban superior** — conhecimento de domínio embutido, não só estrutura |

E no posicionamento: reforça o perfil **"Monday para quem executa de verdade"** —
não basta organizar, o produto **já sabe** o que precisa ser feito naquele tipo
de trabalho.

---

## ✅ O QUE FECHA ESSA TESE

1. **Curadoria > customização:** o valor não está em deixar o usuário montar —
   está em entregar o protocolo pronto de quem é especialista.
2. **Zero tabela nova:** cabe no modelo polimórfico (DProject + DTask).
3. **Diferencial defensável:** a biblioteca curada é IP que cresce com o tempo.
4. **Sinergia com onboarding:** persona → template certo → workspace cheio no
   segundo zero.
5. **É onde o Monday não pode chegar:** software não cura protocolo de domínio.

---

**Documentos companheiros:**
- [`benchmark-monday-vs-scrumban.md`](./benchmark-monday-vs-scrumban.md) — benchmark técnico completo
- [`roadmap-visao-final.md`](./roadmap-visao-final.md) — visão final e timeline de implementação
- [`diagrama-benchmark.md`](./diagrama-benchmark.md) — fórmula mental de adaptação
- [`../../workspace/plans/plan-spaces-sistema-templates-task1.md`](../../workspace/plans/plan-spaces-sistema-templates-task1.md) — plano técnico de implementação (DRAFT)

# Diagrama Benchmark — Monday.com vs Scrumban

**Como pensar a adaptação de ideias do Monday no Scrumban, sem tentar virar o Monday.**

---

## 🎯 A IDEIA CENTRAL (em uma frase)

> **"Não copiar o Monday — extrair os princípios que fazem o Monday funcionar, e aplicar com nossa própria arquitetura."**

---

## 📐 A FÓRMULA MENTAL

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│   FEATURE DO MONDAY    →   PRINCÍPIO POR TRÁS   →   NOSSA   │
│                                                     VERSÃO  │
│                                                             │
│   (o "o quê")              (o "porquê")          (o "como") │
│                                                             │
└─────────────────────────────────────────────────────────────┘
```

A gente não pergunta *"como fazer igual ao Monday?"* — a gente pergunta *"qual problema do usuário o Monday resolveu aqui, e como nós resolvemos com o que temos?"*

---

## 🔬 EXEMPLOS PRÁTICOS DA FÓRMULA

### Exemplo 1 — Colunas Dinâmicas

| Camada | O quê |
|--------|-------|
| 🟦 **Monday faz** | 40+ tipos de coluna prontos, UI inline, mondayDB custom |
| 🧠 **Princípio real** | *"Usuário quer descrever a tarefa do jeito dele, sem pedir pro dev"* |
| 🟩 **Nossa versão** | Expandir `tableFields` do DClasse `LIST (-352)` + campo `dados` Json no DTask. Frontend renderiza tipos conforme schema. Começar com 8 tipos essenciais (texto, número, data, pessoa, status, checkbox, dropdown, link), não 40. |

✅ **Mesmo benefício pro usuário, 1/5 do esforço.**

---

### Exemplo 2 — Views Múltiplas

| Camada | O quê |
|--------|-------|
| 🟦 **Monday faz** | 11 views (tabela, kanban, gantt, calendar, timeline, workload, chart, map, files, form, dashboard) |
| 🧠 **Princípio real** | *"Os mesmos dados precisam ser vistos por óticas diferentes — gerente vê gantt, dev vê kanban"* |
| 🟩 **Nossa versão** | Backend já serve os dados (GET /tasks). Frontend implementa **4 views essenciais primeiro**: Table, Kanban, Calendar, Gantt. Resto fica pra depois. |

✅ **Cobre 90% dos casos de uso reais com 36% do esforço.**

---

### Exemplo 3 — Automações No-Code

| Camada | O quê |
|--------|-------|
| 🟦 **Monday faz** | 200+ receitas visuais "When X then Y" |
| 🧠 **Princípio real** | *"Non-devs precisam automatizar fluxos sem chamar TI"* |
| 🟩 **Nossa versão** | Builder visual simples mapeando pra DEvento triggers. **Mas com superpoder**: nossas "actions" podem chamar o **Agente Claude Code**. Monday faz 200 ações fixas — nós fazemos infinitas via IA. |

✅ **Menos receitas prontas, mas teto muito mais alto.**

---

### Exemplo 4 — Edit-in-Place

| Camada | O quê |
|--------|-------|
| 🟦 **Monday faz** | Clica na célula, edita ali, Tab pra próxima |
| 🧠 **Princípio real** | *"Modal mata fluidez — a sensação tem que ser 'planilha'"* |
| 🟩 **Nossa versão** | Endpoint PUT /tasks/:id já existe. Frontend só precisa renderizar inputs editáveis na célula da tabela. **Zero mudança no backend.** |

✅ **Só trabalho de frontend, ganho enorme de percepção.**

---

## 🗺️ MAPA VISUAL: O QUE PEGAR DO MONDAY

```
┌──────────────────────────────────────────────────────────────┐
│                     O QUE O MONDAY ENSINA                    │
└──────────────────────────────────────────────────────────────┘

   ✅ PEGAR (princípio universal, baixo custo)
   ┌────────────────────────────────────────────┐
   │  • Edit-in-place na tabela                 │
   │  • Status coloridos (visual primeiro)      │
   │  • Drag-and-drop no kanban                 │
   │  • Builder visual de automação simples     │
   │  • Hierarquia clara Space→Folder→List      │ ← já temos!
   └────────────────────────────────────────────┘

   🟡 ADAPTAR (princípio bom, nossa execução é diferente)
   ┌────────────────────────────────────────────┐
   │  • Colunas dinâmicas → tableFields + Json  │
   │  • Múltiplas views → 4 essenciais primeiro │
   │  • Automações → builder + Agente IA        │
   │  • Notificações → DEvento -490 multi-canal │
   └────────────────────────────────────────────┘

   ❌ NÃO COPIAR (caro demais, retorno baixo)
   ┌────────────────────────────────────────────┐
   │  • mondayDB próprio (anos de eng.)         │
   │  • 40+ tipos de coluna (começa com 8)      │
   │  • 11 views (4 cobrem 90%)                 │
   │  • 100+ apps marketplace                   │
   │  • WorkDocs real-time colaborativo         │
   └────────────────────────────────────────────┘
```

---

## ⚖️ A BALANÇA ESTRATÉGICA

```
        MONDAY                          SCRUMBAN
   ┌──────────────┐                ┌──────────────┐
   │  LARGURA     │                │  PROFUNDIDADE│
   │              │                │              │
   │  40+ colunas │      vs        │  Flow Metrics│
   │  11 views    │                │  IA real     │
   │  200+ autom. │                │  State Mach. │
   │              │                │              │
   └──────────────┘                └──────────────┘
        ⬆                                 ⬆
   "muitas opções                  "ferramentas
    superficiais"                   profundas e
                                    integradas"
```

**Estratégia:** importar *largura suficiente* (não 100% dela) sem perder nossa *profundidade*.

---

## 🎓 REGRA DE OURO — 3 FILTROS ANTES DE IMPLEMENTAR

Antes de implementar qualquer coisa "copiada" do Monday, passe a feature por **3 filtros**:

```
┌─────────────────────────────────────────────────────────┐
│                                                         │
│   1️⃣  QUAL O PRINCÍPIO?                                 │
│       (não a feature — a NECESSIDADE do usuário)        │
│                                                         │
│   2️⃣  TEMOS COMO ATENDER COM O QUE JÁ EXISTE?           │
│       (DClasse, DEvento, dados Json, agente IA...)      │
│                                                         │
│   3️⃣  É VERSÃO MÍNIMA VIÁVEL?                           │
│       (8 tipos de coluna em vez de 40, 4 views em      │
│        vez de 11, builder simples em vez de 200        │
│        receitas)                                        │
│                                                         │
└─────────────────────────────────────────────────────────┘
```

Se passou nos 3, pode implementar. Se travou em algum, é sinal de que você está tentando *ser o Monday* em vez de *aprender com ele*.

---

## 💡 O INSIGHT FINAL

```
Monday gastou anos construindo a LARGURA.
Scrumban gastou tempo construindo a PROFUNDIDADE.

Largura sem profundidade = ferramenta bonita mas rasa.
Profundidade sem largura = ferramenta poderosa mas hostil.

         O ouro está em adicionar
         UM POUCO DE LARGURA bem-escolhida
         à profundidade que já temos. ✨
```

---

**Documento companheiro:** ver [`docs/benchmark-monday-vs-scrumban.md`](../benchmark-monday-vs-scrumban.md) para o benchmark técnico completo (features, mondayDB, UI/UX, comparativo detalhado).

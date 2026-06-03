# ADR-V2-061: Templates de Lista/Espaço via DClasse dedicada + remap na materialização (estende o motor `cloneTree`)

**Status:** ACEITO
**Data:** 2026-06-03
**Decisores:** CEO (dono) + Strategist Agent V2
**Tags:** #V2 #templates #dclasse #clone #cloneTree #zero-tabela-nova
**Relacionados:** ADR-V2-001 (zero tabela nova), ADR-V2-051 (hierarquia SPACE/FOLDER/LIST), ADR-V2-057 (timer/telemetria por tarefa), ADR-V2-058/059 (PROJECT_REF espelho + backfill), ADR-V2-060 (remoção Sprint, libera range -400..-419)

> **Ratificação:** As 5 decisões de design abaixo foram **travadas pelo dono em 2026-06-03** e **ratificadas pelo Documenter Agent em 2026-06-03** ao final da implementação das Fases 1-6 da feature Templates. Status: **ACEITO**.

---

## Contexto e Problema

A feature **Templates** permite criar uma **Lista** ou um **Espaço** a partir de um **modelo**
(template), em vez de partir do zero. O usuário escolhe um template do catálogo e o sistema
**materializa** uma nova Lista/Espaço com a estrutura pré-montada (blocos/fases, colunas
customizadas `dados.fields`, hierarquia de tarefas-molde).

O backend já possui um motor de **deep-clone** (`duplicate()` → `cloneTree`) usado para duplicar
projetos/listas com toda a sua subárvore de tarefas. A feature Templates **reaproveita esse motor**
— um template nada mais é do que uma estrutura de origem a ser clonada para um novo destino.

O problema de modelagem: **como diferenciar um template de um projeto real?** Um template é um
`DProject` que não deve aparecer nas listagens normais de projetos, não tem assignees nem datas,
e serve apenas como molde. Precisa-se de uma marcação que:

1. respeite **ADR-V2-001** (zero tabela nova);
2. seja consultável e filtrável sem custo (idealmente via índice já existente em `idClasse`);
3. permita ao motor de clone tratar template e projeto real de forma quase idêntica, divergindo
   apenas nos pontos estritamente necessários.

---

## Decisão

### 1. Marcação por DClasse dedicada

Um template é um `DProject` com uma **DClasse de template** (não um campo booleano em `dados`):

| Chave | Código | Nome | idPai |
|-------|--------|------|-------|
| `-401` | `TEMPLATE_LIST` | Template de Lista | `-37` |
| `-402` | `TEMPLATE_SPACE` | Template de Espaço | `-37` |

A diferenciação template-vs-projeto-real fica no **sistema de tipos** (`idClasse`), coerente com o
modelo polimórfico Devari-Core. Listagens de projetos reais filtram por suas classes habituais
(`-350 SPACE`, `-352 LIST` etc.) e naturalmente **não enxergam** `-401`/`-402`.

### 2. Remap de classe ao materializar

Ao materializar via `POST /projects/:id/from-template`, antes de persistir o clone, a classe do
nó-raiz é remapeada de template para a classe real correspondente:

- `-401 (TEMPLATE_LIST)` → `-352 (LIST)`
- `-402 (TEMPLATE_SPACE)` → `-350 (SPACE)`

Esse remap acontece **ANTES** do teste `=== ID_CLASSE_LIST` em `projects.service.ts` (o ramo que
decide tratamento específico de Lista na materialização). Assim o clone materializado entra no
fluxo como uma Lista/Espaço real legítima, e o restante do pipeline de clone permanece inalterado.

### 3. Alcance (escopo de visibilidade do template)

Definido pelo campo `idEstab` do `DProject`-template:

- **Global** (`idEstab = NULL`): visível a **todas as organizações**. Criado **apenas por
  seed/plataforma** — nunca por usuário final.
- **Por-org** (`idEstab = {org}`): visível **apenas àquela organização**. Criado por um **MANAGER**
  da org.

Templates **nunca existem abaixo do nível de organização** (não há template "de um único usuário"
nem template aninhado dentro de outra Lista). Isso mantém a regra de acesso simples e centralizada.

### 4. Categoria

A categorização do template (para o catálogo / filtros de UI) fica em `dados.categoria` (string).
É metadado de produto, não taxonomia estrutural — por isso vive no `dados` Json, não em DClasse.

### 5. Reset do clone (molde limpo)

Ao materializar, o motor produz um **molde limpo** — copia a estrutura, descarta o estado de
execução. Para **cada nó clonado**:

- **Copia** `dados.fields` (colunas customizadas / valores de molde da grade).
- **Zera** `idAssignee` (sem responsável herdado do template).
- **Zera** `dueDate` (sem data de vencimento herdada).
- **Reseta** `v3.state → INBOX` (toda tarefa nasce no início do fluxo V3).
- **Zera telemetry** (nenhuma métrica/timer herdada — coerente com ADR-V2-057).
- **Novo identifier** `DEV-N` (sequência própria do projeto destino; não copia o identifier do
  molde).

---

## Escopo: V2-específico (não propagar cegamente ao template Devari-Core)

A feature Templates é de **produto Scrumban-V2**. O padrão "marcar variante via DClasse + remap na
materialização" é generalizável, mas os números de chave (`-401`/`-402`) e o reset específico
(`v3.state`, `DEV-N`, telemetry) são do domínio Scrumban. O range `-401..-419` foi **liberado pela
ADR-V2-060** (remoção de Sprint), e estas duas chaves o inauguram.

---

## Consequências

### Positivas
- **Zero tabela nova** — template é `DProject` + DClasse (ADR-V2-001 respeitado).
- **Reuso do motor** `duplicate()`/`cloneTree` — a feature diverge do `duplicate` em apenas **2
  pontos**, ambos cirúrgicos:
  1. **Acesso a template global**: a leitura do template aceita `idEstab = org OU NULL` (templates
     globais são visíveis a todas as orgs, diferente de `duplicate` que opera dentro da org).
  2. **Carimbo de org no clone**: o clone materializado recebe o `idEstab` da **org de destino**
     (não o `idEstab` do template — que pode ser NULL no caso global).
- **Filtro barato** — listagens de projetos reais já filtram por `idClasse`; templates ficam fora
  por construção, sem flag extra nem `WHERE` adicional.
- **Range -401..-419 inaugurado** de forma controlada (liberado por ADR-V2-060).

### Negativas / Riscos
- **Divergência controlada do `duplicate`** — os 2 pontos acima exigem disciplina para não vazar a
  visibilidade global para fluxos que não sejam from-template.
- **Materialização precisa do remap correto** — se o remap `-401→-352`/`-402→-350` falhar/ficar
  fora de ordem, o clone entraria como template (invisível nas listagens). Coberto por teste do
  motor cloneTree (sub-fases futuras).
- **Ratificação pendente** — status `PROPOSTO` até o Documenter fechar a feature.

---

## Alternativas Consideradas

### Alternativa A (ESCOLHIDA): DClasse dedicada (`-401`/`-402`) + remap na materialização
**Prós:** zero tabela nova; filtro via índice `idClasse` existente; reuso quase total do motor de
clone; coerente com o modelo polimórfico. **Contras:** consome 2 chaves do range; exige remap
explícito antes do teste de classe.

### Alternativa B: Flag booleano `dados.isTemplate`
**Rejeitada.** Exigiria `WHERE dados->>'isTemplate' ...` em toda listagem de projetos (sem índice
natural) e espalharia a checagem por vários pontos. A DClasse já é o eixo de tipagem do modelo —
usar `dados` para tipo seria redundante e mais frágil.

### Alternativa C: Tabela própria `DTemplate`
**Rejeitada.** Viola ADR-V2-001 (zero tabela nova) e duplicaria toda a subárvore de relacionamento
(blocos, fases, tarefas) que `DProject`/`DTask` já modelam.

---

## Implementação (sub-fases)

| Sub-fase | Escopo | Status |
|----------|--------|--------|
| 1 | **SEED** — +2 DClasses `-401 TEMPLATE_LIST` / `-402 TEMPLATE_SPACE` (idPai -37) + este ADR | _(esta entrega)_ |
| 2+ | Motor `cloneTree` (reset do molde), rota `POST /projects/:id/from-template`, catálogo de templates | futuras |

---

## Referências

- **Plan:** `workspace/plans/plan-templates-feature.md`
- **Seed:** `prisma/seeds/classes.seed.ts` (`esp(-401, 'TEMPLATE_LIST', ..., -37)` / `esp(-402, 'TEMPLATE_SPACE', ..., -37)`)
- **ADRs correlatos:** ADR-V2-001 (zero tabela nova), ADR-V2-051 (SPACE/FOLDER/LIST), ADR-V2-057 (timer/telemetria por tarefa), ADR-V2-058/059 (PROJECT_REF espelho + backfill), ADR-V2-060 (remoção Sprint — libera range -400..-419)

---

**Status:** ACEITO (ratificado pelo Documenter 2026-06-03)
**Implementação:** Fases 1-6 completas (seed, refator, copyTasks, from-template, alcance, catálogo+blindagem)
**Próximos passos:** Frente B — Fase 2 (agente pode criar templates org-scoped) + melhorias em agents.service.listAgentProjects (M4 debt)

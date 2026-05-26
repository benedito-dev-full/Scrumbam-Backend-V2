# ADR-V2-048: Risk Level vence TaskType no idClasse de DPedido Execution

**Status:** Aceito (implementado em PR Prompt Builder, 2026-05-26)
**Data:** 2026-05-26
**Decisores:** CEO + Strategist Agent V2 + Implementer Agent V2
**Tags:** #V2 #engine #executions #idClasse #ADR-V2-006-reforco
**Suplanta parcialmente:** ADR-V2-033 (seção idClasse mapping por taskType)

---

## Contexto e Problema

`OperacaoExecucaoClaude.calcula()` define `_classeBase = -301 | -302 | -303` baseado em **Risk Level** (LOW/MEDIUM/HIGH), conforme ADR-V2-006 (Risk via idClasse, não campo). Esta lógica é o coração do Risk Gate: LOW pode pular aprovação humana; HIGH exige aprovação manual; DVFS chaves 3-7 são (potencialmente) diferentes por risk level.

Por outro lado, **ADR-V2-033** ("contrato `/v1/execute`") sugeriu mapear `idClasse` por **taskType** (Dev=-300, Pesquisa=-301, Doc=-302, Ops=-303, Genérica=-304). Esta sugestão entra em conflito direto com ADR-V2-006: uma única coluna (`idClasse`) não pode encapsular dois conceitos ortogonais (risk vs taskType).

Durante o trabalho de Prompt Builder (frontend enviando taskId e backend montando prompt natural), a decisão precisou ser tomada para sempre: **qual conceito vence no idClasse?**

## Alternativas Consideradas

### Opção A — Risk vence (status quo, ADR-V2-006) [ESCOLHIDA]

- Engine continua usando -301/-302/-303 para LOW/MED/HIGH risk.
- TaskType vira metadado em `DPedido.dados.taskType` (string).
- DVFS chaves 3-7 continuam podendo ser diferentes por risk.
- Risk Gate (controle de segurança regulatório) preserva semântica de classes distintas.

**Prós:**
- Engine roda hoje, sem migration.
- Risk Gate (LOW=auto-aprovação, HIGH=aprovação humana) é controle de SEGURANÇA. Justifica classes distintas no Engine.
- `dados.taskType` (string) é suficiente para audit, relatórios e UI.
- TaskType NÃO afeta workflow do Engine — afeta apenas qual template de prompt é renderizado (responsabilidade do `PromptBuilderService`, não do Engine).

**Contras:**
- TaskType perde polimorfismo via DClasse (não tem hierarquia, não tem agrupador).

### Opção B — TaskType vence (ADR-V2-033 original)

- `idClasse` reflete tipo (-300 Dev, -301 Pesquisa, -302 Doc, -303 Ops, -304 Genérica).
- Risk vira metadado em `dados.riskLevel`.

**Prós:**
- Polimorfismo correto pelo modelo Devari Core (cada tipo = workflow potencialmente diferente).

**Contras:**
- **Quebra o Engine atual** — `calcula()` precisa ser totalmente reescrito.
- Risk Gate perde discriminador. Aprovação HIGH precisaria mecanismo paralelo (status separado).
- DVFS chaves perdem flexibilidade por risk.
- Risk é **controle de segurança crítico** — degradá-lo a metadado de string aumenta superfície de erro.

### Opção C — Híbrido (range de classes combinatórias)

- Combinar ambos: 5 taskTypes × 3 risks = 15 DClasses (-301a Dev_LOW, -301b Dev_MED, etc.).

**Prós:**
- Combina os dois conceitos.

**Contras:**
- Explosão combinatória — impossível manter no seed.
- Polui o range -301..-330 com lógica entrelaçada.
- Workflow do Engine ficaria com switch enorme.

## Decisão

**Escolhemos: Opção A — Risk vence no idClasse (ADR-V2-006 reforçada)**.

Justificativa formal:

1. **Risk Gate é controle de SEGURANÇA regulatório.** LOW pode pular aprovação (auto-LOW), HIGH exige aprovação humana (workflow). Esta diferença JUSTIFICA classes distintas no Engine (workflow polimórfico via classe é exatamente para isso).

2. **TaskType é metadado de DOMÍNIO.** Afeta qual template de prompt é montado (responsabilidade do `PromptBuilderService`, fora do Engine), mas NÃO afeta o workflow Engine (mesmo `OperacaoExecucaoClaude` serve para todos os tipos).

3. **ADR-V2-033 foi redigido ANTES do Risk Gate ser cravado em F6** (ADR-V2-006). A seção de mapeamento de idClasse por taskType do ADR-V2-033 é o ponto que precisa ser revisado — não o Engine, que já roda em produção.

4. **`dados.taskType` (string em `DPedido.dados`) é suficiente** para audit, UI e relatórios. Não precisa de hierarquia (DClasse) porque taskType não tem agrupadores — é flat.

## Estrutura Pós-Decisão

| Conceito | Onde vive | Valores |
|----------|-----------|---------|
| Risk Level | `DPedido.idClasse` (Engine) | -301 (LOW) / -302 (MEDIUM) / -303 (HIGH) |
| TaskType | `DPedido.dados.taskType` (Json) | `'code' \| 'docs' \| 'research' \| 'validation' \| 'other'` |
| TaskType (DTask) | `DTask.dados.taskType` ou `DTask.idTaskType` | string (canônico V2) ou FK para DTabela -43X |

A canalização entre `DTask.dados.taskType` e `DPedido.dados.taskType` é feita pelo `PromptBuilderService.buildFromTaskId` em cascata defensiva (`dados.taskType` → `dados.tipo` → regex(`nome`) → `'other'`).

## Consequências

### Positivas

1. **Engine intacto** — ZERO migration, ZERO refactor do `OperacaoExecucaoClaude.calcula()`.
2. **Risk Gate preservado** — Controle de segurança continua robusto.
3. **DVFS scripts continuam podendo ser por-risk** (chaves 3-7).
4. **TaskType evolui livremente** sem tocar Engine — adicionar tipo é trivial (template + alias na cascata de detecção).

### Negativas

1. **ADR-V2-033 fica parcialmente suplantado** — a seção de idClasse mapping precisa ser marcada como obsoleta. ADRs subsequentes que citem ADR-V2-033 devem usar este ADR-V2-048 como referência atualizada.
2. **TaskType perde polimorfismo via DClasse** — não é arvore, não tem agrupadores. Aceitável porque taskType é flat por natureza.

## Implementação

### Onde está escrito (código)

- `src/engine/lib/operacao/OperacaoExecucaoClaude.ts:155-167` — mapa `LOW=-301, MEDIUM=-302, HIGH=-303` permanece.
- `src/engine/lib/interfaces/IExecucaoData.ts` — novo campo `taskType?: string` (NÃO é o discriminador do Engine).
- `src/engine/lib/interfaces/IOperacaoExecucaoClaudeConstruct.ts` — novo `taskType?: string` no params (apenas propaga p/ `dados.taskType`).
- `src/executions/executions.service.ts:resolveCommandAndPrompt` — popula `builtTaskType` apenas via `PromptBuilderService` (modo PROMPT).

### Validação

- [x] `OperacaoExecucaoClaude.calcula()` continua usando Risk Level no `_classeBase`.
- [x] `dados.taskType` é populado quando builder roda.
- [x] Engine tests passam sem mudança comportamental (82/82).
- [x] Risk Gate (LOW=auto-approve, MED=auto-approve, HIGH=awaiting_approval) preservado.

## Referências

- **ADR-V2-006:** Risk via idClasse (reforço — este ADR confirma direção)
- **ADR-V2-033:** Contrato `/v1/execute` (suplantado parcialmente — seção idClasse mapping)
- **ADR-V2-049:** Prompt Builder canônico (companion — taskType vive em `dados.taskType`)
- **Código:**
  - `src/engine/lib/operacao/OperacaoExecucaoClaude.ts`
  - `src/executions/services/prompt-builder.service.ts`
- **Plano:**
  - `workspace/plans/plan-2026-05-26-prompt-builder.md` §3.1

# ADR-V2-049: Prompt Builder Canônico — Backend monta prompt a partir de DTask

**Status:** Aceito (implementado em PR Prompt Builder, 2026-05-26)
**Data:** 2026-05-26
**Decisores:** CEO + Strategist Agent V2 + Implementer Agent V2
**Tags:** #V2 #executions #automation #frontend-contract #ADR-V2-033-complement

---

## Contexto e Problema

Durante teste E2E da automação Claude Code (semana de 2026-05-26), descobriu-se que o frontend estava enviando o `taskId` (string do BigInt, ex: `"39"`) como se fosse o **prompt** no body de `POST /projects/:id/execute`. Payload real observado:

```json
{
  "command": { "executable": "claude", "args": ["-p", "39"], "timeoutMs": 600000 },
  "taskId": "39"
}
```

Fluxo quebrado:
1. Frontend obrigado a inventar `command` (validação F13 exigia).
2. Backend repassava `"39"` ao processor V2 (`execution-run.processor.ts:resolvePrompt`).
3. Processor extraía `"39"` via fallback `command.args[-p]`.
4. Agente VPS recebia `"39"` literalmente; Claude respondia "não entendi".
5. Exit 0 sem mudanças no repo. Backend marcava como concluído.
6. **Falso positivo silencioso.**

**Causa raiz:** a lógica de "task → prompt natural pro Claude" **não existia em lugar nenhum no V2**. O processor já lia `dados.prompt` canonicamente (caminho preferencial documentado em `resolvePrompt`), mas nenhum produtor populava esse campo. O frontend fazia workaround quebrado; o backend, apesar de ter o `taskId`, nunca buscava `DTask` nem construía o prompt.

## Alternativas Consideradas

### Opção A — Helper utility (`buildPromptFromTask` em `lib/`)

Função pura recebendo Prisma como argumento.

**Prós:** zero overhead de DI.
**Contras:** assinaturas poluídas; testes precisam mockar manualmente; pior testabilidade.
**Rejeitada.**

### Opção B — Método privado no `ExecutionsService`

Adicionar a lógica diretamente no service existente.

**Prós:** simples, sem novo arquivo.
**Contras:** `ExecutionsService` já tem ~300 linhas e responsabilidade dupla (resolve agent, idempotency, engine call). Adicionar templates + detectTaskType explode o service. Testes ficam acoplados.
**Rejeitada.**

### Opção C — `PromptBuilderService` injetável, templates em arquivos `.md` [ESCOLHIDA]

Service NestJS dedicado em `src/executions/services/prompt-builder.service.ts`. Templates Markdown em `src/executions/services/prompt-templates/<type>.md` carregados em memória no constructor.

**Prós:**
- SRP (Single Responsibility Principle).
- Testabilidade limpa (mock só do Prisma).
- Templates evoluem sem tocar service (cheap iteration).
- Visão de longo prazo: templates podem ser editáveis externamente (DVFS-like) em iteração futura sem refactor.

**Contras:** +1 arquivo, +1 provider. Custo desprezível.
**Escolhida.**

### Opção D — Frontend monta o prompt

Mover templates para o cliente.

**Prós:** backend não muda.
**Contras (vetada por CEO):** templates seriam duplicados em vários clientes (web, MCP, CLI). Templates são lógica de domínio — pertencem ao backend (ponto de convergência).
**Rejeitada por decisão de produto.**

## Decisão

**Escolhemos: Opção C — `PromptBuilderService` injetável + templates em arquivos `.md` separados.**

### Contrato HTTP (3 modos)

```http
POST /projects/:id/execute
Authorization: Bearer <jwt>
Content-Type: application/json

# Modo PROMPT (novo, preferido):
{ "taskId": "39" }

# Modo COMMAND (legado, mantido — MCP/CLI/testes diretos):
{ "command": { "executable": "git", "args": ["status"], "timeoutMs": 60000 } }

# Modo HÍBRIDO (debug apenas):
{ "taskId": "39", "command": { ... } }
# → command vence; taskId fica como metadado em dados.task.id; prompt NÃO é construído.
```

Validação cross-field via `@ValidateIf` no `ExecuteCommandDto`: pelo menos UM dos dois é obrigatório. Caller bypass (sem DTO) também é protegido com guard belt-and-suspenders no `ExecutionsService.execute`.

### Fluxo end-to-end

```
1. Frontend: POST /projects/20/execute { taskId: "39" }
2. ExecutionsService.execute:
   a. ValidateIf garante pelo menos taskId OU command.
   b. Busca projeto, valida membership.
   c. resolveCommandAndPrompt:
      - taskId presente, command ausente → modo PROMPT
      - PromptBuilderService.buildFromTaskId("39", "20", userId)
        → busca DTask (1 query Prisma, ZERO N+1)
        → valida escopo (task pertence ao projeto)
        → detecta taskType em cascata
        → renderiza template Markdown
        → retorna { prompt, taskType, taskName }
      - Constrói placeholder estruturado:
        { executable: 'claude', args: ['-p', prompt], timeoutMs: 600000 }
   d. CommandValidator valida o placeholder (CLAUDE_PATH OK).
   e. Engine OperacaoExecucaoClaude({ command, prompt, taskType, ... })
      → constructor popula dados.prompt + dados.taskType
      → workflow nova → calcula → grava (Pilar 1 intacto)
   f. Pedido persistido com:
      DPedido.dados.prompt    = "Você é um agente..."
      DPedido.dados.taskType  = "code"
      DPedido.dados.command   = { executable: 'claude', args: ['-p', '...'], timeoutMs: 600000 }
      DPedido.dados.task.id   = "39"
3. Processor (execution-run.processor.ts):
   resolvePrompt(dados) → lê dados.prompt CANONICAMENTE (sem fallback).
4. Agente VPS recebe prompt natural → Claude entende → faz mudanças → commit/PR.
```

### Templates

5 templates em `src/executions/services/prompt-templates/`:
- `code.md` — desenvolvimento (default da maioria)
- `docs.md` — documentação
- `research.md` — pesquisa (NÃO altera código)
- `validation.md` — QA / validação
- `other.md` — fallback genérico

Placeholders suportados: `{{taskId}}`, `{{taskName}}`, `{{description}}` + bloco condicional `{{#if description}}...{{/if}}`. Engine de template propositadamente minimalista (sem Handlebars/EJS) — escopo apenas para esses 5 arquivos.

### Cascata de detecção de taskType

```
1. task.dados.taskType (canônico V2 — gravado por POST /tasks)
2. task.dados.tipo (alias defensive — legado/Telegram/MCP)
3. regex(task.nome) — porta heurística do frontend para garantir autonomia do backend
4. 'other' (fallback final)
```

Valores são normalizados para lowercase. Aliases comuns (BUG/FEATURE/IMPROVEMENT → `code`; EXPLAIN → `docs`; REVIEW/QA → `validation`; SPIKE → `research`) são mapeados ANTES da heurística regex.

### Engine: campos novos em `IExecucaoData` e `IOperacaoExecucaoClaudeConstruct`

- `IExecucaoData.prompt?: string` — fonte canônica V2 lida pelo processor.
- `IExecucaoData.taskType?: string` — metadado de domínio (audit/UI/relatórios).
- `IOperacaoExecucaoClaudeConstruct.prompt?: string` — propagado pelo constructor para `this.dados.prompt`.
- `IOperacaoExecucaoClaudeConstruct.taskType?: string` — propagado para `this.dados.taskType`.

Engine continua intocado em workflow: Risk Gate (ADR-V2-006 + ADR-V2-048) vence no `idClasse`. taskType é APENAS metadado.

## Consequências

### Positivas

1. **Backend dono do contrato.** Frontend fica trivial (1 linha: `{ taskId }`).
2. **Aproveita o que já existe.** Processor já lia `dados.prompt` canonicamente; este ADR fecha a outra ponta (producer).
3. **MCP/CLI ganham capacidade nativa.** Qualquer cliente futuro pode disparar execução com taskId — não precisa reimplementar regex de detecção.
4. **Templates versionados.** Iteração de prompts é trivial (editar `.md`).
5. **Sem breaking.** Modo command legado continua aceito. Frontend pode atualizar em PR separado.
6. **Pilar 1 preservado.** Engine continua sendo o único caminho para INSERT em DPedido -301/-302/-303.
7. **Pilar 2 preservado.** Reusa endpoint existente `POST /projects/:id/execute` (não cria `/tasks/:id/execute`).
8. **Pilar 3 preservado.** ZERO DClasse nova.

### Negativas

1. **`__dirname` em runtime exige assets copiados para `dist/`.** Resolvido via `nest-cli.json` (assets config). Risco: build esquecer de copiar templates → erro fatal no startup (loadTemplates lança).
2. **Detecção via regex é heurística.** Tasks sem `dados.taskType` confiam no nome — pode produzir match errado. Aceitável: fallback final é `other` (não quebra).
3. **Frontend deployado antigo continua mandando `command` com `taskId` no payload.** Aceitável: modo HÍBRIDO existe e `command` vence; após 1 sprint, considerar deprecation warning.

## Implementação

### Arquivos criados

- `src/executions/services/prompt-builder.service.ts`
- `src/executions/services/__tests__/prompt-builder.service.spec.ts` (18 unit tests)
- `src/executions/services/prompt-templates/code.md`
- `src/executions/services/prompt-templates/docs.md`
- `src/executions/services/prompt-templates/research.md`
- `src/executions/services/prompt-templates/validation.md`
- `src/executions/services/prompt-templates/other.md`
- `src/executions/__tests__/executions.service.prompt-mode.spec.ts` (7 integration tests)
- `src/executions/dto/__tests__/execute-command.dto.spec.ts` (7 DTO tests)
- `scripts/e2e/e2e-prompt-builder.sh` (smoke E2E)
- `docs/decisions/ADR-V2-048-risk-vence-tasktype-no-idclasse.md` (companion)

### Arquivos modificados

- `src/executions/dto/execute-command.dto.ts` — `command` agora opcional + `@ValidateIf` cross-field.
- `src/executions/executions.service.ts` — `resolveCommandAndPrompt` + injeção de `PromptBuilderService`.
- `src/executions/executions.module.ts` — registra `PromptBuilderService` em providers.
- `src/engine/lib/interfaces/IExecucaoData.ts` — campos `prompt?` e `taskType?`.
- `src/engine/lib/interfaces/IOperacaoExecucaoClaudeConstruct.ts` — `prompt?` e `taskType?`.
- `src/engine/lib/operacao/OperacaoExecucaoClaude.ts` — constructor propaga campos para `this.dados`.
- `nest-cli.json` — `assets` config para copiar `*.md` para `dist/`.

### Validação

- [x] `PromptBuilderService` injetado no `ExecutionsService` (1 provider novo).
- [x] `POST /projects/:id/execute { taskId }` funciona sem `command`.
- [x] `DPedido.dados.prompt` populado com texto natural (não taskId nem command).
- [x] `DPedido.dados.taskType` populado (`code|docs|research|validation|other`).
- [x] Risk Gate continua funcionando (LOW=auto-approve, HIGH=awaiting_approval).
- [x] Modo command legado continua aceito (regressão F13 verde).
- [x] Build passa (`npm run build`).
- [x] Templates copiados para `dist/src/executions/services/prompt-templates/`.
- [x] Unit tests PromptBuilder: 18/18 verdes.
- [x] Integration tests ExecutionsService modo-prompt: 7/7 verdes.
- [x] DTO cross-field tests: 7/7 verdes.
- [x] Engine tests preservados: 82/82.
- [x] ZERO query N+1 (1 query para DTask, demais já existiam).
- [x] BigInt em todos os IDs.
- [x] PrismaService direto (não DatabaseService).

## Frontend (PR separado)

`Scrumbam-Frontend-V2/src/hooks/use-task-execution.ts` deve ser atualizado para enviar apenas `{ taskId }` no body. Trabalho NÃO incluído neste PR (repo separado, scope `feat(frontend/execution): usa contrato V2 prompt-mode`).

## Referências

- **ADR-V2-006:** Risk via idClasse (referência — não altera)
- **ADR-V2-033:** Contrato `/v1/execute` (companion — descreve I/O da camada agente)
- **ADR-V2-048:** Risk vence TaskType no idClasse (companion — formaliza separação de conceitos)
- **Código:**
  - `src/executions/services/prompt-builder.service.ts`
  - `src/executions/executions.service.ts` (modo PROMPT/COMMAND/HÍBRIDO)
  - `src/executions/processors/execution-run.processor.ts:resolvePrompt` (consumer canônico V2 — não alterado)
- **Plano:** `workspace/plans/plan-2026-05-26-prompt-builder.md`
- **Implementação:** `workspace/implementations/impl-2026-05-26-prompt-builder.md`

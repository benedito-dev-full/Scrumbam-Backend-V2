# PLANO DETALHADO — Task 1: Risk Gate cego no modo PROMPT (V2 Fase F13 — Hardening Automation)

**Criado por:** Strategist Agent V2
**Data:** 2026-11-23
**Módulo:** executions (toca `engine/dvfs` + `prisma/seeds/dvfs.seed.ts`)
**Fase V2:** F13 (Automation Claude Code) — hardening de segurança
**ADRs vinculados:** ADR-V2-006, ADR-V2-007, ADR-V2-016, ADR-V2-020, ADR-V2-049, ADR-V2-066/067, ADR-V2-079 — **propõe ADR-V2-081** (próximo livre; 080 reservado ao plano de remoção VALIDATING/VALIDATED)
**Estimativa Total:** ~11h backend (com buffer 20%) + ~4h frontend (esteira separada)
**Complexidade:** Média (código pequeno; risco alto de regressão/falso positivo e de drift DVFS banco×arquivo)

---

## 1. Análise

### Contexto

```
POST /projects/:id/execute {taskId}  ─┐
MCP tool execute_task                 ├──► ExecutionsService.execute()
Nexus capability execute_task (OFF)  ─┘          │
                                                  ▼
                       resolveCommandAndPrompt (modo PROMPT)
                         command.text = "claude -p task-built-prompt-placeholder"
                         dados.prompt = <prompt REAL renderizado da task>
                                                  │
                                                  ▼
                 OperacaoExecucaoClaude.calcula() → DVFS chave 3 (risk-gate-validator)
                         lê APENAS dados.command.text  ──►  sempre LOW  ❌
                                                  │
                                                  ▼
                 LOW → gravarComoQueued + enqueue → VPS roda claude --dangerously-skip-permissions
```

Resultado: **toda execução em modo PROMPT é auto-aprovada**, independentemente do conteúdo da task ("apague a tabela de clientes", "force push na main"). O Risk Gate (58 testes adversariais) só protege o modo COMMAND, que é o caminho legado/debug.

### Estado Atual (verificado no código)

| Item | Local | Observação |
|------|-------|-----------|
| Placeholder do comando | `src/executions/executions.service.ts:42` (`PROMPT_MODE_COMMAND_PLACEHOLDER`) e `:282-330` (`resolveCommandAndPrompt`) | prompt real vai para `dados.prompt` via construtor do Engine |
| `dados.prompt` populado | `src/engine/lib/operacao/OperacaoExecucaoClaude.ts:84-96` (construtor) | **já disponível para o script DVFS no `calcula()`** — nenhuma mudança de wiring necessária |
| Risk Gate | `src/engine/dvfs/risk-gate-validator.js:14` | lê só `op.dados.command.text`; padrões são regex de shell/SQL em inglês |
| Decisão LOW vs aprovação | `executions.service.ts:184-199` | `riskLevel === 'LOW'` → queued+enqueue; senão `gravarComoAwaitingApproval(3600000)` |
| Seed DVFS | `prisma/seeds/dvfs.seed.ts:37-125` | lê o `.js` do disco; `upsert` por `(idClasse=-300, chaveScript=3, versao=1)` com `update.conteudo` → **já idempotente e corrige drift** (ADR-V2-020) |
| Loader DVFS | `src/engine/helpers/dvfs-loader.helper.ts` | `findFirst({ idClasse, chaveScript, ativo:true })` — **NÃO filtra por `versao`**; cache em memória TTL 5min; fallback concreto → -300 |
| Deploy | `Dockerfile` (`CMD node dist/src/main.js`) | **seed NÃO roda no boot** — precisa ser executado manualmente (runbook) |
| Templates de prompt | `src/executions/services/prompt-templates/{code,docs,other,research,validation}.md` | hoje NÃO contêm palavras que disparem os padrões atuais (varredura feita) |
| Entradas | `executions.controller.ts:128`, `mcp/tools/execute-task.tool.ts:166`, `common/tool-capabilities/capabilities/executions/execute-task.capability.ts:150` | **todas delegam a `ExecutionsService.execute()`** → corrigir no Engine/DVFS cobre as 3. `agents.service.ts:713` instancia o Engine só para `registrarOutcome` (não classifica) |
| Testes | `src/engine/dvfs/__tests__/risk-gate-adversarial.spec.ts` (58 casos), `src/executions/__tests__/executions.service.prompt-mode.spec.ts` (mock `buildRiskGateScript('LOW')`) | preservar e estender |
| Aprovação | `POST /executions/:id/approve` / `/reject` (PROJECT_MANAGER -171), `approval-flow.service.ts`, sweeper expira em 1h | backend pronto |
| Frontend | `frontend/src/components/tasks/task-detail-drawer-ai.tsx:32-63`, `frontend/src/hooks/use-task-execution.ts:120-193` | só mostra "Aguardando aprovação (risco ALTO)..." — **sem botões**; texto diz ALTO mesmo quando MEDIUM |
| Resposta da execução | `src/executions/dto/execution-response.dto.ts:195-224` | expõe `riskLevel` + `approval.{status,expiresAt,...}`, mas **não expõe `risk.explanation`** (o gestor não saberia *por que* precisa aprovar) |

### Decisões Passadas Relevantes (ADRs V2)

- **ADR-V2-006** — risco via idClasse -301/-302/-303. Mantido: o script só classifica; `calcula()` define `_classeBase`.
- **ADR-V2-007** — regra de risco vive na DVFS (portabilidade). A mudança principal é no **script**, não no Engine.
- **ADR-V2-016** — loader usa `chaveScript`, nunca `id`. Mantido.
- **ADR-V2-020** — upsert idempotente. O seed DVFS já segue; basta reexecutar.
- **ADR-V2-049** — PromptBuilder canônico; marker sem metacaracteres no command. Mantido (o CommandValidator continua NÃO vendo o prompt — correto, ele valida shell).
- **ADR-V2-066/067/079** — MCP/Nexus `execute_task` async fire-and-poll; `awaiting_approval` não é erro. Ganha cobertura automaticamente.

---

## 2. Abordagem Escolhida

### Solução (recomendada: **A + guarda de contrato no Engine**)

1. **Risk Gate v2 (DVFS chave 3)** passa a classificar o texto que o Claude **de fato recebe**: `command.text` **+** `dados.prompt`.
   - Padrões existentes (shell/SQL, 25 HIGH + 15 MEDIUM) aplicados às duas fontes (prompt pode conter snippet de shell: "rode `rm -rf dist`").
   - **Novos padrões de linguagem natural PT-BR/EN** (HIGH/MEDIUM), aplicados sobre texto **normalizado** (lowercase + remoção de acentos via `normalize('NFD')`), com janelas de proximidade limitadas (`[^.\n]{0,40}`) para evitar ReDoS e reduzir falsos positivos.
   - `matchedPatterns[]` ganha `source: 'command' | 'prompt'`; `risk` ganha `scannedSources: ['command','prompt']` e `validatorVersion: 2`.
   - Continua **fail-open para LOW só quando nada casa**; qualquer match → MEDIUM/HIGH → aprovação humana (fail-safe no que importa).
2. **Guarda de contrato no Engine** (`OperacaoExecucaoClaude.calcula()`, pós `super.calcula()`): se `dados.prompt` existe e o script **não** declarou `scannedSources` contendo `'prompt'` (ex.: banco ainda com o script v1 → drift), **eleva para no mínimo MEDIUM** com `explanation` "Risk Gate desatualizado (DVFS sem varredura de prompt)" + `logger.warn`. Isso fecha a janela entre deploy do código e execução do seed — falha para o lado seguro, não para o cego.
3. **Seed DVFS** reaplicado (upsert existente, `versao` **mantida em 1**) + verificação pós-deploy por hash.
4. **Expor `risk.explanation` e `risk.matchedPatterns`** (sem o texto do prompt) no `ExecutionResponseDto` para o gestor entender o motivo (insumo do frontend).

### Justificativa

- Corrige a raiz (o validador não olhava o input real) com a menor superfície: 1 script DVFS + ~15 linhas no Engine + DTO.
- Coerente com o design atual: regra de negócio na DVFS (ADR-V2-007); Engine só garante integridade do contrato (não decide padrões).
- A guarda transforma o principal risco operacional (seed esquecido / banco divergente) de "cego silencioso" em "aprovação extra visível".
- Cobre as 3 entradas (HTTP, MCP, Nexus) sem tocá-las.

### Alternativas Consideradas

| # | Abordagem | Prós | Contras | Esforço | Veredito |
|---|-----------|------|---------|---------|----------|
| **A** | Validador lê `command.text` + `dados.prompt`, padrões shell + NL PT/EN | Analisa o que o Claude realmente recebe; cobre futuros conteúdos injetados no prompt; 1 ponto de mudança | Templates podem gerar falso positivo se alguém editar um `.md` com "production"/".env" → mitigado por teste de regressão dos templates | ~6h | **Recomendada** (+ guarda) |
| **B** | Validador lê campos da task separadamente (`taskName`, `description` em `dados.riskInput`) | Zero ruído dos templates; explicação aponta o campo exato | Precisa propagar campo novo do PromptBuilder → Engine; **cego para o que o template/injeções acrescentarem** (amanhã: comentários, anexos, CLAUDE.md do projeto); duas fontes de verdade | ~7h | Rejeitada como principal; a atribuição por campo é parcialmente obtida com `source` |
| **C** | Classificação por LLM (Haiku) sobre o prompt | Entende intenção, negação, paráfrase, ofuscação | Latência + custo por execução; não-determinístico (testes adversariais frágeis); nova dependência de provider no caminho crítico; prompt-injection contra o próprio classificador | ~3d | **Fora de escopo agora** — registrar como evolução (camada 2 sobre o regex, nunca substituto) |
| **D** | Piso MEDIUM fixo para todo modo PROMPT (toda execução por task exige aprovação) | Máximo fail-safe; trivial (~1h) | Mata a automação MCP/Nexus fire-and-poll (ADR-V2-066); gestor vira carimbador → aprovação perde valor; sem frontend com botão, trava tudo | ~1h | Rejeitada como padrão; **válida como chave de emergência** (pergunta aberta: flag de ambiente `RISK_GATE_PROMPT_FLOOR=MEDIUM`?) |

---

## 3. Avaliação dos 3 Pilares

### Pilar 1: Engine/Operação

- A feature atua sobre INSERT em DPedido idClasse=-300 (→ -301/-302/-303) — **já via `OperacaoExecucaoClaude extends OperacaoPedido`**. Workflow `nova() → setExecucaoData() → calcula() → gravarComoQueued/AwaitingApproval` **inalterado**.
- Mudança de regra fica no **script DVFS chave 3** (Dimensão 3). No Engine entra apenas a guarda de contrato pós-`super.calcula()` (integridade, não regra).
- **Sinalização (sem expandir escopo):** `approval-flow.service.ts:119` e `:257` fazem `UPDATE "DPedido"` via `$executeRaw` (race-safe, decidido em F6-Task2). É UPDATE de status (permitido pela tabela "UPDATE simples → Prisma direto"), mas fora do Engine. **Não tocar nesta task.**

### Pilar 2: Endpoints Genéricos

- **Nenhum endpoint novo.** Reusa `POST /executions/:id/approve`, `POST /executions/:id/reject`, `GET /executions?projectId=&status=awaiting_approval` (controller `/executions` é exceção autorizada no V2).
- Única alteração HTTP: **campo aditivo** `risk` no `ExecutionResponseDto` (não quebra contrato).

### Pilar 3: Seed de Classes

- **Zero DClasse nova.** Reusa -300/-301/-302/-303 e statuses de aprovação existentes (`AUTOMATION_CLASS_IDS`). Nenhuma canônica sequestrada.
- **Seed DVFS** (não de classes) é a peça crítica de deploy: reexecutar `seedDvfs` (via `seed-runner`) — ver Fase 4.
- **ZERO tabela nova.** `dados` Json de DPedido recebe só campos aditivos em `dados.risk`.

### Genericidade (template vs V2-específico)

- Padrão "**validador DVFS declara `scannedSources`/`validatorVersion` e o Engine eleva o risco se o contrato não bate**" é genérico → candidato a feed-back ao Devari-Core (proteção contra drift DVFS banco×arquivo em qualquer projeto). Registrar no ADR.
- Os padrões PT-BR de linguagem natural são V2-específicos (domínio Claude Code).

---

## 4. Estrutura Técnica

### Arquivos a Criar

| Arquivo | Conteúdo |
|---------|----------|
| `src/engine/dvfs/__tests__/risk-gate-natural-language.spec.ts` | Suíte adversarial PT-BR/EN sobre `dados.prompt` (mesmo mecanismo `fs+eval` da suíte atual) |
| `src/engine/dvfs/__tests__/risk-gate-prompt-templates.spec.ts` | Regressão: cada template de `prompt-templates/*.md` renderizado com task neutra → **LOW** |
| `docs/decisions/ADR-V2-081-risk-gate-avalia-prompt.md` | ADR (ver §7 do ADR template) |

### Arquivos a Modificar

| Arquivo | Linhas | Mudança |
|---------|--------|---------|
| `src/engine/dvfs/risk-gate-validator.js` | 1-125 (reescrita controlada) | fontes `command` + `prompt`; normalização; `NL_HIGH_PATTERNS`/`NL_MEDIUM_PATTERNS`; `source`, `scannedSources`, `validatorVersion: 2`; header de versão |
| `src/engine/lib/operacao/OperacaoExecucaoClaude.ts` | ~153-176 (`calcula()`) | guarda de contrato: `dados.prompt` presente e `!risk.scannedSources?.includes('prompt')` → eleva p/ MEDIUM + warn |
| `src/engine/lib/interfaces/IOperacaoExecucaoClaudeConstruct.ts` (ou onde `IExecucaoData.risk` é tipado) | tipo `risk` | `matchedPatterns[].source?`, `scannedSources?`, `validatorVersion?` (opcionais — retrocompat) |
| `src/executions/dto/execution-response.dto.ts` | ~150-224 | `risk?: { explanation; matchedPatterns: {pattern, level, source}[] }` (sem texto do prompt) + `@ApiPropertyOptional` |
| `src/executions/__tests__/executions.service.prompt-mode.spec.ts` | 31-40, 94, 300, 372+ | mock `buildRiskGateScript` passa a setar `scannedSources:['command','prompt']` (senão a guarda eleva p/ MEDIUM e quebra "LOW → enfileirada"); novos casos (ver Fase 3) |
| `src/engine/lib/operacao/__tests__/OperacaoExecucaoClaude.unit.spec.ts` | novo `describe` | casos da guarda de contrato |
| `src/engine/dvfs/__tests__/risk-gate-adversarial.spec.ts` | sem alterar casos | **os 58 casos devem continuar passando intactos**; apenas acrescentar 2-3 casos com `source` |
| `prisma/seeds/dvfs.seed.ts` | 61-67 | **manter `versao: 1`** (ver Risco R2); atualizar comentário; opcional: logar `md5(conteudo)` do chave 3 |
| `docs/deploy-runbook-*.md` (novo trecho ou runbook existente) | — | passos de seed + verificação por hash + restart |

### Endpoints REST

Nenhum novo. Contrato reutilizado:

```
POST /api/v1/projects/:id/execute          {taskId} | {command} | {taskId, command}
GET  /api/v1/executions?projectId=X&status=awaiting_approval&riskLevel=MEDIUM|HIGH
POST /api/v1/executions/:id/approve        {notes?: string ≤500}           → 200 | 403 | 409
POST /api/v1/executions/:id/reject         {reason: string 10..1000}       → 200 | 403 | 409
```

### Esboço do validador v2 (guia, não código final)

```js
async function riskGateValidator(op) {
  var d = op.dados || {};
  var sources = [
    { source: 'command', text: (d.command && d.command.text) || '' },
    { source: 'prompt',  text: typeof d.prompt === 'string' ? d.prompt : '' },
  ];
  function norm(s) { return s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, ''); }
  // ordem: HIGH (shell em raw) → HIGH (NL em norm) → MEDIUM (shell) → MEDIUM (NL)
  // primeiro HIGH encontrado vence; matchedPatterns registra {pattern, level, source}
  // op.dados.risk = { level, explanation, matchedPatterns, scannedSources: ['command','prompt'],
  //                   validatorVersion: 2, classifiedAt }
}
```

### Padrões NL propostos (texto normalizado, sem acento)

**HIGH** (perda irreversível / segurança / produção):

| Intenção | Padrão (ilustrativo) | Exemplos que casam |
|----------|----------------------|--------------------|
| Destruir banco/tabela | `\b(apag\|delet\|exclu\|remov\|dropa\|drop\|destru\|zer\|limp\|trunc)\w*\b[^.\n]{0,40}\b(banco( de dados)?\|database\|base de dados\|tabelas?\|schema\|collection)\b` | "apague a tabela de clientes", "delete o banco", "limpe a base de dados", "zere o banco" |
| Apagar dados em massa | `\b(apag\|delet\|exclu\|remov)\w*\b[^.\n]{0,20}\b(todos?\|todas?\|tudo)\b[^.\n]{0,30}\b(registros\|dados\|usuarios\|clientes\|arquivos\|linhas)\b` | "apagar todos os registros", "remova todos os usuários" |
| Force push / reescrever histórico | `\bforce[\s-]?push\b\|\bpush\b[^.\n]{0,20}(--force\|-f\b\|forcad)\|\breescrev\w*\b[^.\n]{0,20}\bhistorico\b` | "force push na main", "faça push forçado", "reescreva o histórico" |
| Apagar repositório/branch principal | `\b(apag\|delet\|exclu\|remov)\w*\b[^.\n]{0,25}\b(repositorio\|repo\|branch (main\|master)\|a (main\|master))\b` | "delete a branch main", "exclua o repositório" |
| Produção | `\b(em\|na\|no\|de\|para) (ambiente de )?producao\b\|\bprod(uction)?\b` (já existe EN) | "rode no banco de produção", "deploy em produção" |
| Segredos | `\b(senhas?\|chave privada\|chaves? (de api\|secreta)\|tokens? de acesso\|credenciais\|segredos?)\b` | "mostre as senhas", "commite as credenciais" |
| Desligar segurança | `\b(desativ\|desabilit\|remov)\w*\b[^.\n]{0,30}\b(autenticacao\|2fa\|firewall\|rbac\|permissoes\|guard)\b` | "desative a autenticação" |
| EN NL | `\b(delete\|drop\|wipe\|erase\|nuke)\b[^.\n]{0,30}\b(database\|db\|table\|all (records\|users\|data))\b` | "wipe the database", "drop the users table" |

**MEDIUM** (mudança estrutural legítima, porém revisável):

| Intenção | Padrão (ilustrativo) | Exemplos |
|----------|----------------------|----------|
| Remover coluna/campo | `\b(remov\|exclu\|apag\|drop)\w*\b[^.\n]{0,25}\b(coluna\|campo\|atributo\|propriedade)\b` | **"remover campo obsoleto"** → MEDIUM (não HIGH) |
| Migration PT | `\bmigra(cao\|coes\|r\|te)\b` | "crie uma migração" |
| Schema/banco estrutural | `\b(alter\|mud\|modific)\w*\b[^.\n]{0,25}\b(schema\|modelo prisma\|estrutura do banco)\b` | "altere o schema" |
| Dependências PT | `\b(instal\|adicion\|atualiz)\w*\b[^.\n]{0,20}\b(dependencia\|pacote\|biblioteca\|lib)\b` | "instale a lib axios" |
| Git destrutivo local | `\b(reset(e\|ar)? (hard\|--hard)\|descart\w* (as )?alteracoes)\b` | "descarte as alterações" |
| Infra | `\b(docker\|kubernetes\|k8s\|nginx\|systemd\|cron)\b[^.\n]{0,25}\b(alter\|reinici\|config\|mud)\w*` | "reinicie o nginx" |

**Explicitamente LOW (testes de não-regressão):** "remover import não usado", "apagar console.log", "corrigir typo no README", "adicionar teste", "renomear variável", "limpar warnings do eslint", "excluir comentário obsoleto". Os padrões exigem objeto destrutivo (banco/tabela/coluna/todos) — verbo sozinho não basta.

**Falsos positivos aceitos (fail-safe):** negação ("NÃO apague a tabela") e menções informativas ("o bug acontece em produção") sobem para HIGH. Coerente com o design atual (`\bproduction\b` já é HIGH em comando). Documentar no ADR; medir na Fase 5.

### Queries Prisma (verificação pós-deploy — somente leitura)

```sql
-- 1) Conteúdo ativo do Risk Gate e sinal de versão
SELECT "chave","idClasse","chaveScript","versao","ativo", md5("conteudo") AS hash,
       position('validatorVersion: 2' in "conteudo") > 0 AS is_v2
FROM "DVFS" WHERE "chaveScript" = 3;
-- Esperado: 1 linha, idClasse=-300, versao=1, ativo=true, is_v2=true,
--           hash == md5sum src/engine/dvfs/risk-gate-validator.js (dist copiado)
-- Qualquer linha em -301/-302/-303 com chaveScript=3 = override concreto → investigar
```

### Eventos Emitidos

Sem evento novo. Reusa `execution.{low|medium|high}.created` (OperacaoExecucaoClaude.ts:299-305) — a distribuição passará a refletir o modo PROMPT. Guarda de contrato: apenas `logger.warn` (opcional SHOULD: DEvento de auditoria via EventProducer `system.audit.log` com `reason=risk_gate_stale` — não criar DClasse).

---

## 5. Plano de Implementação

### Fase 1: Seed de Classes — N/A
Nenhuma DClasse nova. (Seed **DVFS** é tratado na Fase 4, que é bloqueante para o go-live.)

### Fase 2: Risk Gate v2 (DVFS chave 3) — ~3h
1. Reescrever `risk-gate-validator.js` conforme esboço: duas fontes, normalização, padrões shell (intactos) + NL, `source`, `scannedSources`, `validatorVersion: 2`.
2. Manter assinatura `async function riskGateValidator(op)` (seed e testes fazem `eval` e extraem o nome).
3. Sem `require`, sem dependências — script roda via eval no Engine.
4. Janela de proximidade sempre limitada (`{0,N}`) — proibido `.*` novo nos padrões NL.

### Fase 3: Testes — ~3h
1. `risk-gate-adversarial.spec.ts`: rodar **sem alterar** os 58 casos (garantia de retrocompat do modo COMMAND).
2. `risk-gate-natural-language.spec.ts` (≥40 casos): mock `op = { dados: { command:{text:'claude -p task-built-prompt-placeholder'}, prompt: '<texto>' } }`.
   - ≥15 HIGH PT-BR (incluindo "apague a tabela de clientes", "delete o banco", "force push na main", acentos/maiúsculas "APAGUE A TABELA", "Produção"), ≥5 HIGH EN NL.
   - ≥8 MEDIUM ("remover campo obsoleto", "crie uma migração", "instale a dependência X").
   - ≥12 LOW legítimos (lista acima) — **critério de aceite de falso positivo**.
   - Casos de `source`: comando LOW + prompt HIGH → HIGH com `source:'prompt'`.
   - Caso ReDoS: prompt de 50KB sem match termina em < 50ms.
3. `risk-gate-prompt-templates.spec.ts`: renderizar cada template (`code/docs/other/research/validation`) com `taskName='Ajustar botão'`, `description=''` → LOW. Protege contra alguém editar template e tornar tudo HIGH.
4. `executions.service.prompt-mode.spec.ts`:
   - Atualizar `buildRiskGateScript` para setar `scannedSources:['command','prompt']`.
   - Novo: usar o **script real** (fs) + task com descrição "apague a tabela de clientes" → `gravarComoAwaitingApproval` chamado, `executionQueue.enqueueExecution` **não** chamado, `idClasse=-303`.
   - Novo: task neutra com script real → LOW + enqueue (não-regressão).
5. `OperacaoExecucaoClaude.unit.spec.ts`: script stub v1 (sem `scannedSources`) + `dados.prompt` presente → nível MEDIUM e explanation "Risk Gate desatualizado"; sem `dados.prompt` (modo COMMAND) → guarda não interfere; script reporta HIGH → guarda não rebaixa.
6. Specs de `execute-task.tool` e `execute-task.capability`: adicionar 1 caso cada confirmando que `awaiting_approval` é propagado (já mockam o service — só garantir contrato, sem lógica nova).

### Fase 4: Engine + DTO + Seed DVFS — ~2h
1. `OperacaoExecucaoClaude.calcula()`: guarda de contrato logo após `super.calcula()` e antes do `classeMap` (linhas ~153-166).
2. Tipos `IExecucaoData.risk` com campos opcionais novos.
3. `execution-response.dto.ts`: campo `risk` opcional (explanation + matchedPatterns com `source`). **Nunca** ecoar o prompt.
4. `dvfs.seed.ts`: manter `versao: 1` (o loader não filtra por versão — bumpar criaria 2 linhas ativas e `findFirst` escolheria arbitrariamente). Conferir que `npm run copy:dvfs-assets` leva o `.js` novo para `dist/src/engine/dvfs/`.
5. **Ordem de deploy** (runbook):
   ```
   1. deploy da imagem nova (código com guarda)        → execuções PROMPT viram ≥ MEDIUM até o seed (fail-safe)
   2. npm run seed  (node dist/prisma/seeds/seed-runner.js, idempotente ADR-V2-020)
   3. SELECT de verificação (hash + is_v2)             → bater com md5 do arquivo em dist
   4. restart do backend OU aguardar 5min (cache DVFS em memória, TTL 5min)
   5. smoke: execute {taskId} de task neutra → LOW; task "apague a tabela X" → awaiting_approval HIGH
   ```

### Fase 5: Medição de falso positivo (antes de ligar em prod) — ~1h
- Rodar o validador v2 **offline** sobre amostra de `DTask.nome + descricao` das últimas N tasks executadas (consulta read-only, **somente com autorização explícita do usuário para acessar o banco de produção**) e reportar % LOW/MEDIUM/HIGH. Se MEDIUM+HIGH > ~30%, rever os padrões MEDIUM ruidosos (`refactor`, `config ... update`, `rebuild`, `package.json`) **só para `source:'prompt'`** antes do go-live. Resultado vai para o ADR.

### Fase 6: ADR-V2-081 + docs — ~1h
- ADR "Risk Gate avalia o prompt (modo PROMPT) + contrato de versão DVFS" (ver §ADR abaixo).
- Atualizar JSDoc de `resolveCommandAndPrompt` (remover a implicação de que o placeholder é o que é classificado) e do header do validador.

### Fase 7: Frontend (esteira separada) — ver "Escopo frontend"
**Dependência de go-live:** sem o botão, MEDIUM/HIGH ficam presos até expirar (1h). Recomenda-se **liberar o backend em produção só junto com o frontend**, ou aceitar temporariamente aprovação via curl/Swagger pelo gestor.

---

## 6. Estimativa de Tempo (com buffer 20%)

| Fase | Base | Com buffer |
|------|------|-----------|
| 2. Validador v2 | 2.5h | 3h |
| 3. Testes (unit + adversarial PT-BR + templates) | 2.5h | 3h |
| 4. Engine guarda + DTO + seed/runbook | 1.5h | 2h |
| 5. Medição de falso positivo | 0.75h | 1h |
| 6. ADR + JSDoc | 0.75h | 1h |
| Review/ajustes | 0.75h | 1h |
| **Backend total** | **~8.75h** | **~11h** |
| Frontend (esteira própria) | 3.5h | ~4h |

---

## 7. Riscos e Mitigações

### Alto
- **R1 — Execuções presas sem UI de aprovação.** Backend sozinho faz MEDIUM/HIGH expirarem após 1h. *Mitigação:* go-live casado com o frontend; até lá, runbook de aprovação via `curl`/Swagger pelo gestor.
- **R2 — Drift DVFS banco × arquivo / seed esquecido.** Seed não roda no boot. *Mitigação:* guarda de contrato no Engine (eleva para MEDIUM se o script não varre o prompt) + SELECT de verificação por hash + restart (cache 5min). **Não** bumpar `versao` (loader sem filtro de versão → 2 linhas ativas = comportamento não-determinístico).
- **R3 — Falsos positivos em massa** (gestor vira carimbador). *Mitigação:* padrões NL exigem verbo destrutivo + objeto crítico com janela curta; ≥12 casos LOW obrigatórios; Fase 5 mede antes do go-live; teste de templates.

### Médio
- **R4 — Falsos negativos** (paráfrase, ofuscação "a-p-a-g-u-e", outro idioma, instrução indireta "faça como no script X"). *Mitigação:* aceito e documentado — regex é camada 1; LLM classifier (Alternativa C) fica como evolução. O agente VPS continua com `--dangerously-skip-permissions`; hardening do lado VPS (ADR-V2-035/044) é fora de escopo.
- **R5 — Override concreto em -301/-302/-303** com chaveScript=3 mascarar o -300. *Mitigação:* SELECT de verificação lista todas as linhas chaveScript=3.
- **R6 — ReDoS em prompt grande.** *Mitigação:* janelas limitadas, teste de 50KB < 50ms.
- **R7 — Testes existentes quebram pela guarda** (`prompt-mode.spec` mocka script sem `scannedSources`). *Mitigação:* atualização prevista na Fase 3.

### Baixo
- **R8 — Vazamento do prompt via resposta** se `matchedPatterns` incluir trecho do texto. *Mitigação:* registrar só o regex e a `source`, nunca o match.
- **R9 — Acentuação/`\b` em JS** (`\b` não trata "ç/ã" como letra sem flag `u`). *Mitigação:* normalização NFD antes dos padrões NL.

---

## 8. Critérios de Sucesso

### MUST HAVE
- Modo PROMPT com task "apague a tabela de clientes" → HIGH, `awaiting_approval`, **não enfileirada** (HTTP, MCP e Nexus — via `ExecutionsService.execute`).
- "remover campo obsoleto" → MEDIUM; os ≥12 casos legítimos → LOW.
- 58 testes adversariais originais passam **sem alteração**.
- Guarda de contrato: script v1 + prompt → ≥ MEDIUM.
- Seed DVFS reaplicado e verificado por hash em produção; zero tabela nova, zero DClasse nova.
- `npm run build` e `npm test` verdes.

### SHOULD HAVE
- `risk.explanation`/`matchedPatterns` (com `source`) no `ExecutionResponseDto`.
- Medição de falso positivo (Fase 5) registrada no ADR-V2-081.
- Correção do texto "risco ALTO" para refletir MEDIUM (frontend).

### COULD HAVE
- DEvento de auditoria `system.audit.log` quando a guarda de contrato dispara.
- Flag `RISK_GATE_PROMPT_FLOOR` (Alternativa D como chave de emergência).

### WILL NOT HAVE
- Classificação por LLM (Alternativa C).
- Mudança no CommandValidator (continua só shell — ADR-V2-049).
- Refatorar os `$executeRaw` do `approval-flow.service.ts` para o Engine (apenas sinalizado).
- Endpoint novo, tabela nova, DClasse nova.
- Hardening do agente VPS (`--dangerously-skip-permissions`).

---

## Escopo frontend (contrato para a esteira do frontend — executar depois)

**Onde:** `frontend/src/components/tasks/task-detail-drawer-ai.tsx` (estado `awaiting_approval`, linhas ~32-63) + `frontend/src/hooks/use-task-execution.ts` (polling/mapeamento de status, linhas ~120-193).

**Quem vê os botões:** somente quando `project.myRole === 'MANAGER'` (campo já presente em `ProjectResponseDto`; backend reforça com 403 para não-gestor). Demais membros veem só o aviso.

**Estados:**

```
awaiting_approval ──[Aprovar]──► approved → (queued/executando) → DONE/FAILED
        │          ──[Rejeitar]─► rejected  (terminal)
        └──(1h, sweeper)────────► expired   (terminal)
```

| Estado | Gestor (MANAGER) | Membro |
|--------|------------------|--------|
| `awaiting_approval` | Badge risco (MEDIUM âmbar / HIGH vermelho) + motivo (`risk.explanation`) + expira em (`approval.expiresAt`) + **[Aprovar]** + **[Rejeitar]** | "Aguardando aprovação do gestor do projeto" + expira em |
| `approved` | segue fluxo normal de execução | idem |
| `rejected` | "Rejeitada por X: {rejectedReason}" | idem |
| `expired` | "Aprovação expirou" + opção de disparar de novo | idem |

**Endpoints:**
- `POST /api/v1/executions/:id/approve` — body `{ notes?: string (≤500) }` → 200 `ExecutionResponseDto`.
- `POST /api/v1/executions/:id/reject` — body `{ reason: string (10..1000) }` (obrigatório → modal com textarea + validação de tamanho) → 200.
- Erros: **403** (não é gestor) → esconder botões e mostrar toast; **409** (outro gestor já decidiu / expirou) → refetch e mostrar estado atual.
- Opcional: `GET /api/v1/executions?projectId=X&status=awaiting_approval` para um contador/lista "pendentes de aprovação".

**Campos da resposta usados:** `riskLevel`, `approval.status`, `approval.expiresAt`, `approval.rejectedReason`, `approval.rejectedBy`, `risk.explanation` (novo, opcional — tratar ausência).

**Correção de copy:** o texto atual "Aguardando aprovação (risco ALTO)..." deve usar `riskLevel` real.

---

## ADR-V2-081 (proposto) — vale a pena?

**Sim.** Muda a semântica do Risk Gate (insumo passa a ser o prompt, não só o comando), introduz padrões de linguagem natural com política explícita de falso positivo, e cria um padrão reutilizável (contrato de versão de script DVFS verificado pelo Engine) candidato ao template Devari-Core. Título sugerido: *"Risk Gate avalia o prompt no modo PROMPT + contrato de versão do script DVFS"*. Alternativas A/B/C/D desta seção 2 entram como "Alternativas Consideradas".

---

**Handoff para Implementer:**

1. Ler este plano + `src/engine/dvfs/risk-gate-validator.js` + `OperacaoExecucaoClaude.ts:134-176` + `dvfs-loader.helper.ts`.
2. Ordem: Fase 2 → Fase 3 (testes vermelhos primeiro para NL e guarda) → Fase 4 → Fase 6. Fase 5 só com autorização do usuário para ler produção.
3. Não alterar os 58 casos existentes; não bumpar `versao` no seed; não ecoar prompt na resposta.
4. Comandos:
   ```bash
   npx jest src/engine/dvfs src/engine/lib/operacao src/executions src/mcp/tools src/common/tool-capabilities
   npm run build
   npm run build:seeds   # confere cópia do .js para dist
   ```
5. Commit sugerido: `fix(executions): risk gate passa a avaliar o prompt no modo PROMPT`.

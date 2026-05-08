# ADR-V2-016 — DVFS scripts: usar `s.chave` (canonico) e nao `s.id` (bug latente)

**Status:** Aceito (BLOQUEANTE — defesa codificada em F6 DoD)
**Data:** 2026-05-08
**Decisores:** Strategist (Bloco 3 — Dominio + Engine), revisado por Conversa Principal
**Tags:** `#engine` `#dvfs` `#dimensao-3` `#bug-latente-herdado` `#pilar-1`

---

## Contexto e Problema

O `RELATORIO-DEVARI-PARTE-1-BACKEND-CORE.md` (linhas 880-924) documenta um **bug latente herdado** no Engine atual do Devari Core que afeta diretamente a **Dimensao 3 (Configuracao via DVFS scripts)** do modelo polimorfico.

### O bug exato

No arquivo legado `OperacaoPedido.ts` (template Devari Core), os metodos `_carregaScriptsCalc()` (linhas 289-322) e `_carregaScriptsGrav()` (linhas 324-357) carregam scripts da tabela DVFS via PK. O codigo correto teria que usar `s.chave` (a coluna PK real do schema), mas em duas linhas especificas usa `s.id` — campo que **nao existe** no schema:

```typescript
// _carregaScriptsCalc — busca chaves 3, 4, 5
const sprec = scripts.filter(s => s.chave === 3)[0];   // OK — encontra
const sc    = scripts.filter(s => s.chave === 4)[0];   // OK — encontra
const sposc = scripts.filter(s => s.id === 5)[0];      // BUG — `s.id` nao existe
                                                       // sposc sempre `undefined`
                                                       // _funcPosCalculo nunca carrega
```

O mesmo padrao se repete em `_carregaScriptsGrav()` para a chave 7 (script pos-gravacao).

### Impacto real

1. **A Dimensao 3 fica metade quebrada silenciosamente.** Scripts pre-calculo (chave 3), calculo (4), pre-gravacao (6) carregam normalmente — alimentando a falsa sensacao de que tudo funciona. Mas pos-calculo (5) e pos-gravacao (7) **nunca executam**, porque o filtro retorna `undefined` e o codigo simplesmente pula (`if (sposc)` e false).

2. **No Dinpayz, isso passou despercebido por anos** porque os scripts DVFS estavam comentados em `calcula()` (RELATORIO PARTE-1 linha 936-948) — Dimensao 3 dormente. So apareceria se alguem tentasse usar.

3. **No V2, Dimensao 3 e ATIVADA pela primeira vez** (via `OperacaoExecucaoClaude` — F6, e o `risk-gate-validator` em chave 3, `pr-auto-open` e `notification-dispatcher` em chave 7). Se herdarmos o bug **a chave 7 nunca carrega — PR auto-open jamais abre, notification dispatcher nunca emite**. F6 inteira nasce quebrada.

### Por que e ADR (e nao so "fix bug")

- Define **padrao canonico** para qualquer Engine futuro do V2 (ou Engines em projetos derivados): a coluna PK da DVFS e `chave` (BigInt), conforme schema Prisma. Ponto.
- Reverte um anti-padrao silencioso herdado de migracao Mongo->Postgres (aparentemente `s.id` era ObjectId no Mongo e nunca foi corrigido — ver tambem o bug em `OperacaoComissionamento.ts` linha 73 com ObjectId hardcoded, RELATORIO PARTE-1 linha 1132).
- Codifica DEFESA via testes regressivos adversariais bloqueantes (Implementer nao pode "esquecer" de corrigir — F6 nao fecha sem os testes verdes).

---

## Alternativas Consideradas

### Opcao A — Aceitar o bug e documentar como "limitation"
**Rejeitada.** F6 inteira depende de chaves 5 e 7 funcionarem (notification-dispatcher esta em chave 7). PR auto-open via DVFS chave 7 (`02-DOMINIO-ENGINE.md` linha 603) e a feature mais visivel da Fase 6. Aceitar o bug = quebrar a fase.

### Opcao B — Corrigir tacitamente (so dizer "use s.chave" no plano)
**Rejeitada.** O plano atual (`02-DOMINIO-ENGINE.md` linha 1231) ja diz "**CORRIGIR o bug latente identificado [...]**". Isso nao foi suficiente para fechar a auditoria (topico [23], score 5/10) — sem teste regressivo bloqueante, ha risco real de Implementer corrigir mal (so a chave 5, esquecer a chave 7) ou nao corrigir (copy-paste de codigo legado por engano). O plano ATUAL ja menciona — falta blindagem.

### Opcao C — Codificar correcao + 2 testes regressivos adversariais como item BLOQUEANTE da DoD da F6 (esta decisao)
**Escolhida.** Combina (a) regra explicita "usar s.chave consistentemente" no codigo de `OperacaoPedido._carregaScriptsCalc/Grav` + (b) 2 specs de teste que provam que `_funcPosCalculo` e `_funcPosGravacao` carregam a partir da DVFS (via dummy script que muta `op.dados` e validacao do mutated state).

### Opcao D — Refatorar a abordagem (Map em vez de filter)
**Rejeitada para esta correcao.** A refatoracao e desejavel mas amplia escopo. Esta decisao foca-se em corrigir o bug com minimo blast radius. Refatoracao para Map/dvfs-loader e tarefa do Bloco G.5 (helper centralizado) — separada deste ADR.

---

## Decisao

**Adotar Opcao C (correcao + defesa adversarial bloqueante).**

### Regras codificadas

1. **Em `OperacaoPedido._carregaScriptsCalc()`:** o filtro DEVE ser sempre `s.chave === <N>` (nao `s.id`). Os 3 scripts carregados sao chaves 3, 4 e 5.
2. **Em `OperacaoPedido._carregaScriptsGrav()`:** mesma regra para chaves 6 e 7.
3. **A coluna PK da DVFS e canonicamente `chave: BigInt`** — declarada em schema, batendo com o resto do sistema (`devari-polymorphic-engine.md` secao 3 e `devari-backend-patterns.md` secao 2).
4. **Comparacao numerica em filter respeitando BigInt:** se `chave` no schema e BigInt, o filtro e `s.chave === BigInt(5)` (NAO `s.chave === 5`, que retorna false porque `5n !== 5`). Esse cuidado entra no DoD.
5. **Linter/grep customizado:** hook de pre-commit no V2 procura `s\.id\s*===` em arquivos de `src/engine/lib/operacao/*.ts` e bloqueia commit. Mensagem: "Use s.chave — ver ADR-V2-016".

### Defesa adversarial em F6 DoD (BLOQUEANTE — sem isso F6 nao fecha)

Adicionar dois itens novos ao `02-DOMINIO-ENGINE.md` secao 6.12 (Definition of Done F6):

- [ ] **Teste regressivo R-CHAVE-5:** Insere via setup-fixture 5 linhas em DVFS (chaves 3, 4, 5, 6, 7). A chave 5 contem o script:
  ```javascript
  (function (op) { op.dados._dvfs5_executado = true; })
  ```
  O teste instancia `OperacaoPedido` real, chama `op.nova()` e depois `op.calcula()`. **Asserta que `op.dados._dvfs5_executado === true`** apos o calculo. Se o filtro estiver errado (`s.id === 5`), `_funcPosCalculo` fica `undefined`, o script nunca executa, a flag nao e setada, e o teste falha.

- [ ] **Teste regressivo R-CHAVE-7:** Mesma estrutura, mas chave 7 com script:
  ```javascript
  (async function (op) { op.dados._dvfs7_executado = true; })
  ```
  O teste chama `op.grava()` e **asserta que `op.dados._dvfs7_executado === true`** apos a gravacao. Mesma logica de defesa.

Ambos os testes sao **adversariais**: foram desenhados especificamente para falhar se o bug `s.id` retornar (regressao em refatoracao futura). Eles nao testam apenas que o codigo "funciona" — testam que **o caminho exato do bug nao volta**.

---

## Justificativa

- O bug afeta especificamente a chave 5 (`_funcPosCalculo`) e a chave 7 (`_funcPosGravacao`) — exatamente as duas que o V2 USA via `OperacaoExecucaoClaude` (chave 7 hospeda `pr-auto-open` e `notification-dispatcher`, alem do potencial uso da chave 5 em projetos derivados).
- "Mencionar para corrigir" no plano (P02:1231) e necessario mas nao suficiente. A historia do Dinpayz mostra que bugs latentes em Engine sobrevivem anos sem deteccao quando os scripts ficam dormentes. V2 nao pode aceitar essa falha de processo — a Dimensao 3 e ativada agora.
- Defesa via teste adversarial bloqueante e o padrao Devari Core (`devari-backend-patterns.md` secao 16: "Reviewer valida isso na Phase de testes") aplicado ao caso especifico.
- Ao contrario do CommandValidator (58 testes adversariais para command injection, F13), aqui sao apenas 2 testes — pequenos, baratos, mas bloqueantes. Custo-beneficio enorme.

---

## Consequencias

### Positivas
- Dimensao 3 do polimorfismo opera em **plenitude** no V2 — todas as 5 chaves DVFS funcionais, mesmo que algumas fiquem vazias por escolha.
- F6 nao fecha com o bug latente herdado — defesa estrutural via DoD.
- Padrao canonico `s.chave` reforcado em todos os Engines futuros (V2 e projetos derivados).
- Refatoracao futura para `dvfs-loader.helper.ts` (Bloco G.5) tem testes que ja validam o comportamento esperado — refactor seguro.
- Bug do template Devari Core fica documentado e endereado — issue separado pode ser aberto contra o template raiz.

### Negativas
- 2 specs novos de teste em F6 (custo: ~30 linhas + setup fixture DVFS — minutos para Implementer).
- Hook de pre-commit `s\.id\s*===` precisa entrar nas `.claude/scripts/` ou em pre-commit hook do git (custo: 1 linha de bash).
- Implementer pode ficar tentado a "passar pulando" o teste — mitigacao: hook Stop do `validate-implementation.sh` valida que ambos os testes existem em `src/engine/lib/operacao/__tests__/OperacaoPedido.spec.ts` antes de marcar F6 como completa.

### Impacto direto nas fases

- **F6 (DoD):** +2 itens bloqueantes (R-CHAVE-5, R-CHAVE-7) na secao 6.12.
- **F6 (Bloco G.3):** A frase "CORRIGIR o bug latente" e mantida e refoCada — agora explicitamente conectada a este ADR e aos testes.
- **F6 (Riscos secao 6.11):** O risco "Bug do RELATORIO replicado" passa de "ALTA / mitigado pela mencao" para "ALTA / mitigado pela mencao + 2 testes adversariais bloqueantes + hook de pre-commit".
- **F14 (Hardening):** N+1 sweep ja prevista. Adicionar mini-sweep "DVFS coverage": rodar todos os fluxos do Engine com `DATABASE_LOGGING=true` e validar que existe SELECT na DVFS por chaves 3, 4, 5 (calcula) e 6, 7 (grava) em cenarios reais — defesa em profundidade.
- **Projetos derivados do V2:** Herdam automaticamente os testes (estarao no `src/engine/lib/operacao/__tests__/OperacaoPedido.spec.ts` que e parte do template).

---

## Referencias

- `RELATORIO-DEVARI-PARTE-1-BACKEND-CORE.md` linhas 880-924 (descricao do bug exato).
- `RELATORIO-DEVARI-PARTE-1-BACKEND-CORE.md` linha 1810 (recomendacao explicita: "validar bug de s.id vs s.chave em OperacaoPedido._carregaScripts*").
- `docs/auditoria/AUDITORIA-PARTE-1-vs-PLANO-V2.md` topico [23] (lacuna identificada, score 5/10) e topico [43] (chaves 5 e 6 vazias podem mascarar).
- `02-DOMINIO-ENGINE.md` linha 1231 (instrucao atual de correcao — agora reforcada por este ADR).
- `02-DOMINIO-ENGINE.md` secao 6.12 (DoD a ser estendida).
- `devari-polymorphic-engine.md` secao 3 (regra canonica: PK e `chave`, nao `id`).
- `devari-backend-patterns.md` secao 2 (BigInt obrigatorio em IDs — reforca BigInt(5) vs 5).

---

**Validacao desta decisao:** F6 nao fecha enquanto `make test` nao passar nos especs `R-CHAVE-5` e `R-CHAVE-7`. Reviewer confirma via `grep -n 's\.id' src/engine/lib/operacao/*.ts` (esperado: zero hits) e via leitura dos testes adversariais.

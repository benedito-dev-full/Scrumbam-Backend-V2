# ADR-V2-081: Risk Gate avalia o prompt no modo PROMPT + contrato de versão do script DVFS

**Status:** Aceito (Reviewer APPROVED 8.6/10 em 2026-11-23; gate APPROVED ≥ 8.5). Pendências abertas: medição de falso positivo (Fase 5) e deploy com `RISK_GATE_PROMPT_FLOOR=MEDIUM` até a medição.
**Data:** 2026-11-23
**Score do Reviewer:** 8.6/10 (histórico: ciclo 1 = 7.2, ciclo 2 = 8.0, ciclo 3 = 8.6)
**Decisores:** Strategist Agent V2 (plano `workspace/plans/plan-executions-risk-gate-prompt-mode-task1.md`), Implementer Agent V2, CEO (decisões de escopo)
**Tags:** #V2 #fase-F13 #automation #risk-gate #dvfs #seguranca
**Relacionados:** ADR-V2-006, ADR-V2-007, ADR-V2-016, ADR-V2-020, ADR-V2-049, ADR-V2-066/067, ADR-V2-079

---

## Contexto e Problema

No modo PROMPT (ADR-V2-049 — `POST /projects/:id/execute {taskId}`, MCP `execute_task`, Nexus `execute_task`),
o `ExecutionsService` coloca um placeholder sem metacaracteres em `dados.command.text`
(`claude -p task-built-prompt-placeholder`) e o texto real renderizado da task em `dados.prompt`.

O Risk Gate (DVFS chave 3, `risk-gate-validator.js` v1) lia **apenas** `dados.command.text`.
Resultado: **toda execução em modo PROMPT era classificada LOW e auto-enfileirada**, independentemente
do conteúdo ("apague a tabela de clientes", "force push na main"). O agente VPS roda
`claude --dangerously-skip-permissions`. Os 58 testes adversariais só protegiam o modo COMMAND (legado/debug).

Risco operacional secundário: o seed DVFS **não roda no boot**. Corrigir só o arquivo `.js` deixaria o banco
com o script v1 até alguém reexecutar o seed (drift banco × arquivo), e o sistema continuaria cego em silêncio.

## Alternativas Consideradas

| # | Abordagem | Veredito |
|---|-----------|----------|
| **A** | Validador lê `command.text` **+** `dados.prompt`; padrões shell/SQL legados + padrões de linguagem natural PT-BR/EN | **Escolhida** (+ guarda de contrato no Engine) |
| B | Validador lê campos da task separados (`taskName`, `description`) | Rejeitada — cego para o que template/injeções acrescentarem; duas fontes de verdade |
| C | Classificação por LLM (Haiku) | Fora de escopo — latência, custo, não-determinismo, prompt-injection contra o classificador. Evolução futura como **camada 2**, nunca substituto |
| D | Piso MEDIUM fixo para todo modo PROMPT | Rejeitada como padrão (mata fire-and-poll MCP/Nexus, gestor vira carimbador). **Adotada como chave de emergência** `RISK_GATE_PROMPT_FLOOR` (decisão do CEO) |

## Decisão

1. **Risk Gate v2 (DVFS chave 3)** varre duas fontes — `command` e `prompt`:
   - 40 padrões shell/SQL legados (25 HIGH + 15 MEDIUM) **intactos**, aplicados ao texto bruto de cada fonte
     (o prompt pode conter snippet de shell: "rode `rm -rf dist`").
   - Padrões de linguagem natural PT-BR/EN (9 HIGH + 7 MEDIUM) sobre texto **normalizado**
     (lowercase + remoção de acentos via NFD — `\b` em JS não trata "ç/ã" como letra).
   - Exigem **verbo destrutivo + objeto crítico** em janela limitada (`[^.\n]{0,N}`); verbo sozinho não basta
     ("remover import não usado" = LOW). Proibido `.*` novo (ReDoS).
   - Saída: `matchedPatterns[]` ganha `source: 'command' | 'prompt'`; `risk` ganha
     `scannedSources: ['command','prompt']` e `validatorVersion: 2`. Fail-open para LOW só quando nada casa.
2. **Guarda de contrato no Engine** (`OperacaoExecucaoClaude.calcula()`, após `super.calcula()`):
   se há `dados.prompt` e `risk.scannedSources` não contém `'prompt'` (script v1 ainda no banco),
   eleva para no mínimo **MEDIUM** com `explanation` "Risk Gate desatualizado…" + `logger.warn`
   + `matchedPatterns` `{pattern:'engine:risk-gate-stale', source:'engine'}`. Nunca rebaixa.
   O Engine **não decide padrões** (regra continua na DVFS — ADR-V2-007); só garante a integridade do contrato.
3. **Piso de emergência** `RISK_GATE_PROMPT_FLOOR` (env, default desligado): `MEDIUM`/`HIGH` força todo modo
   PROMPT a exigir aprovação. Só eleva; modo COMMAND não é afetado; valores inválidos = desligado.
4. **Resposta HTTP** (`ExecutionResponseDto`): campo aditivo opcional `risk { explanation, matchedPatterns[{pattern, level, source}] }`
   para o gestor entender o motivo. **Nunca** ecoa o texto do prompt (só o regex e a fonte).
5. **Seed DVFS**: `versao` **mantida em 1** — o `DvfsLoaderHelper` não filtra por versão; bumpar criaria 2 linhas
   ativas com escolha não-determinística. O upsert existente (ADR-V2-020) sobrescreve `conteudo`.

### Política de falso positivo (fail-safe, aceita pelo CEO)

- Negação ("**NÃO** apague a tabela") e menção informativa a produção ("o bug acontece em produção") sobem para HIGH.
  Coerente com o design v1 (`\bproduction\b` já era HIGH em comando).
- Padrões MEDIUM legados (`refactor`, `migration`, `config … update`, `rebuild`, `package.json`) passam a valer
  também para o prompt. Se a medição (Fase 5) mostrar MEDIUM+HIGH > ~30% das tasks, rever esses padrões
  **apenas para `source:'prompt'`** antes do go-live.
- Desvio deliberado do esboço do plano: "senha(s)" sozinha **não** é HIGH (toda feature de "recuperação de senha"
  viraria HIGH); exige verbo de exposição (mostrar/commitar/vazar/logar/exportar…). Credenciais, segredos, chaves
  privadas/de API/secretas e tokens de acesso continuam HIGH por menção direta.

### Ciclo 2 (pós-review 7.2 → correção M1/M2)

- **M1 — normalização anti-bypass Unicode.** Todo texto passa por `NFKC` (fullwidth/ligaduras → ASCII) e remoção de
  invisíveis (soft hyphen U+00AD, U+200B–U+200F, U+2060, U+FEFF) antes de qualquer padrão. Padrões shell/SQL rodam sobre
  esse texto "limpo" (ASCII comum fica idêntico → 58 adversariais intactos); padrões NL rodam sobre limpo + lowercase +
  NFD sem diacríticos. O arquivo do validador usa só escapes `\uXXXX` (teste garante ausência de caracteres literais).
- **M2 — falsos negativos simples cobertos.** Critério de nível (ambos exigem aprovação humana; muda só a classe e o destaque):

| Nível | Casos | Por quê |
|-------|-------|---------|
| HIGH | esvaziar/eliminar banco ou "base inteira"; "Remova os usuários/registros/clientes…" (artigo + plural); diretório inteiro/raiz; alterar/criar senha/conta de **admin/root**; dump de variáveis de ambiente / identificadores `*_secret/_key/_token/_password`; revelar/exportar/vazar tokens e segredos; prompt-injection ("ignore as instruções anteriores"); baixar-e-executar script; base64 + executar; desativar login/CSRF/SSL; `prd` | perda irreversível, segurança, produção ou execução remota — mesma família do legado (`\.env`, `credentials`, `prod`) |
| HIGH (shell) | `curl/wget … \| sh`, `sudo su`/`sudo -i`/`su root`, `chmod … 777`, `rm` com `-r` **e** `-f` em qualquer forma (`-r -f`, `--recursive --force`), `find /` ou `~` com `-delete`/`-exec rm`, `FLUSHALL/FLUSHDB`, `dropDatabase()` | lacunas dos 40 legados; equivalentes a `rm -rf`/`DROP` |
| MEDIUM | desligar/reiniciar servidor/VPS/containers, matar processos, "faça deploy"/deploy em staging/servidor, publicar no npm/registry, `npm publish`/`docker push`, `sudo` simples, `find <dir local> -delete` | operação de infra/release **ambígua** (mock local vs VPS); coerente com "reinicie o nginx" = MEDIUM do plano. Deploy **em produção** continua HIGH pelo padrão de produção |

- **Guardas de falso positivo** (testadas como LOW): singular ("remover usuário duplicado"), usuário alterando a própria senha,
  `NODE_ENV` singular no rodapé, "documentar o processo de deploy", diretório temporário, "limpar cache do navegador",
  "remover botão de login duplicado", `rm -r my-folder` (hífen no nome sem flag `-f`).
- **ReDoS:** regex continuam lineares (janelas limitadas, lookaheads de `rm` limitados a 80 chars); pior caso medido ~9 ms
  em prompt de 100 KB (teste: melhor de 3 < 50 ms).
- **Fora deste ciclo (M3):** falsos positivos de "tabela" de UI ("Remova a tabela vazia da página", "Add a delete button to
  each row of the table") seguem HIGH — decidir após a medição da Fase 5.

### Ciclo 3 (re-review 8.0 → correção B1/B2)

- **B1 — quebra de linha/pontuação.** Antes das janelas de proximidade, `norm()` (só padrões NL) faz:
  1. quebra de linha **simples** (`\n` ou `\r\n`) → espaço (soft-wrap de markdown não separa verbo e objeto);
  2. ponto seguido de espaço + **minúscula** → espaço (`apague. a tabela` = HIGH).
  **Barreiras mantidas de propósito:** linha em branco (parágrafo), início de item de lista (`-`, `*`, `•`, `1.`, `1)`) e
  ponto + **maiúscula** (fim de frase real). Sem essas barreiras, frases independentes se juntariam ("Remova o import não
  usado. A tabela de preços já está ok" viraria HIGH). Cobertura extra para a elipse típica:
  "Apague os logs antigos. A tabela de clientes **também**." = HIGH (padrão dedicado, janela ≤ 80 chars).
  **Limite conhecido:** verbo e objeto em parágrafos ou itens de lista diferentes, ou em frases distintas sem "também",
  continuam LOW.
- **B2 — invisíveis.** Lista fechada substituída por `/[\p{Cf}` + fillers Hangul `U+115F U+1160 U+3164 U+FFA0]/gu`
  (classe aberta: invisible times/plus, U+180E, U+061C, bidi, tag chars…). Removidos antes **e** depois do NFKC.
  Suporte confirmado: o loader do Engine executa o script com `eval("(" + conteudo + ")")` no V8 do Node 20
  (`node:20-alpine`); `\p{}` + flag `u` é ES2018. Se o eval falhasse, o Engine falha fechado ("DVFS chave 3 não carregado").
- **Lacunas baratas:** EN `shutdown now` / `reboot -f` / "reboot the server" = **MEDIUM** (coerente com "Desligue o
  servidor"); `ssh … root@`, escrita em `/etc/*` (`>`, `>>`, `tee`), menção a `/etc/shadow|sudoers` e "ler secrets
  (vault)" = **HIGH**.

### Limites conhecidos do regex (fora de escopo — camada LLM futura, Alternativa C)

| Técnica | Exemplo | Por que fica fora |
|---------|---------|-------------------|
| Homóglifos (cirílico/grego) | `аpague` com "а" cirílico | exige tabela de confusáveis (UTS #39); NFKC não mapeia entre alfabetos |
| Letras espaçadas | `a p a g u e a tabela` | colapsar espaços entre letras quebraria texto normal |
| Pontuação intra-palavra | `b.a.n.c.o`, `ta-bela` | remover pontuação/hífen dentro de palavra gera falso positivo e quebra identificadores (`console.log`, `my-folder`) |
| Barreiras estruturais | verbo e objeto em parágrafos/itens diferentes | ver B1 |
| Paráfrase / outro idioma / instrução indireta | "faça como no script X" | R4 |

Mitigação operacional para todos: `RISK_GATE_PROMPT_FLOOR=MEDIUM` até a medição da Fase 5.

### Falsos negativos aceitos (R4)

Paráfrase, ofuscação ("a-p-a-g-u-e"), outro idioma, instrução indireta ("faça como no script X").
Regex é camada 1; classificador LLM (Alternativa C) fica como evolução. Hardening do agente VPS fora de escopo.

## Consequências

### Positivas

- O Risk Gate passa a avaliar o que o Claude **de fato recebe**; cobre HTTP, MCP e Nexus sem tocar nas entradas
  (todas delegam a `ExecutionsService.execute()`).
- Drift DVFS banco × arquivo vira "aprovação extra visível" em vez de "cego silencioso".
- Padrão genérico **candidato ao Devari-Core**: script DVFS declara `scannedSources`/`validatorVersion` e o Engine
  verifica o contrato (proteção contra drift em qualquer projeto).
- Zero tabela nova, zero DClasse nova, zero endpoint novo.

### Negativas

- Execuções MEDIUM/HIGH ficam presas até expirar (1h) **sem o botão Aprovar/Rejeitar no frontend** —
  go-live casado com a esteira do frontend (decisão do CEO: backend e frontend sobem juntos).
- Falsos positivos propositais aumentam o volume de aprovações (mitigado por ≥14 casos LOW obrigatórios em teste
  e pela medição da Fase 5).

## Implementação

| Arquivo | Mudança |
|---------|---------|
| `src/engine/dvfs/risk-gate-validator.js` | v2: duas fontes, normalização NFKC + invisíveis + NFD (ciclo 2), padrões NL e shell extras, `source`/`scannedSources`/`validatorVersion` |
| `src/engine/lib/operacao/OperacaoExecucaoClaude.ts` | `_aplicarGuardasModoPrompt()` (guarda de contrato + `RISK_GATE_PROMPT_FLOOR`) |
| `src/engine/lib/interfaces/IExecucaoData.ts` | tipos opcionais de `risk` (retrocompat) |
| `src/executions/dto/execution-response.dto.ts` | `risk?: RiskSummaryDto` (sem prompt) |
| `prisma/seeds/dvfs.seed.ts` | comentário; `versao` mantida em 1 |
| `.env.example` | `RISK_GATE_PROMPT_FLOOR=` (desligado) |
| Testes | `risk-gate-natural-language.spec.ts`, `risk-gate-prompt-templates.spec.ts`, guarda em `OperacaoExecucaoClaude.unit.spec.ts`, script real em `executions.service.prompt-mode.spec.ts`; 58 adversariais intactos |

### Ordem de deploy (runbook)

```
1. deploy da imagem nova (código com guarda)     → PROMPT vira ≥ MEDIUM até o seed (fail-safe)
2. npm run seed (node dist/prisma/seeds/seed-runner.js — idempotente, ADR-V2-020)
3. SELECT de verificação (hash + is_v2)          → md5 == md5 do dist/src/engine/dvfs/risk-gate-validator.js
4. restart do backend OU aguardar 5 min          (cache DVFS em memória, TTL 5 min)
5. smoke: task neutra → LOW; task "apague a tabela X" → awaiting_approval HIGH
```

Query de verificação (somente leitura) e de medição: `workspace/implementations/sql-executions-risk-gate-prompt-mode-task1.sql`.

## Medição de falso positivo (Fase 5)

**Pendente** — execução pelo CEO, read-only, com a query preparada. Resultado (% LOW/MEDIUM/HIGH sobre as últimas N
tasks executadas) deve ser registrado aqui antes do go-live.

## Referências

- Plano: `workspace/plans/plan-executions-risk-gate-prompt-mode-task1.md`
- Implementação: `workspace/implementations/impl-executions-risk-gate-prompt-mode-task1.md`

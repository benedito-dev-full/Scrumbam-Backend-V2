# ADR-V2-036 — Monorepo `Scrumban-Backend-V2/agent/` para o agente cliente V2

**Status:** Aceito
**Data:** 2026-05-12
**Decisores:** CEO (decisão arquitetural 2026-05-12), Strategist Agent V2 (proposta), Implementer V2 (execução Sub-tarefa 1)
**Tags:** `#V2` `#F13` `#automation` `#agent` `#repo-layout` `#monorepo`

> **Nota de numeração:** este ADR foi planejado como `ADR-V2-031` no `plan-automation-agent-v2-client-task1.md`, mas o número 031 já estava ocupado (`ADR-V2-031-webhooks-scoped-por-org.md`). Promovido para **036** para preservar unicidade. Referências cruzadas no plano e em commits que mencionam "ADR-V2-031 (monorepo agent/)" devem ser lidas como "ADR-V2-036".

---

## Contexto e Problema

O agente V2 cliente (binário Node.js+TS que roda na VPS) precisava de uma decisão de **localização do código**:

1. **Repo separado** (ex: novo `scrumban-agent` no Git).
2. **Monorepo dentro de `Scrumban-Backend-V2/`** (em `agent/`).
3. **Git submodule** apontando para o repo separado.

A escolha impacta CI/CD, versionamento, governança de ADRs, e gestão de mudanças de protocolo (que afetam backend ↔ agente simultaneamente).

Contexto extra:
- O agente V2 NÃO é genérico (template) — ele é V2-específico (consome endpoints e contratos próprios do Scrumban-Backend-V2). Não há outro consumidor.
- Mudanças de protocolo (`/v1/execute` payload, `execution-result` payload, novos `type` discriminators) afetam backend E agente no mesmo PR — ver Sub-tarefa 2.5 do plan-task2 onde backend e contrato evoluíram juntos.
- O time é uma única pessoa (CEO + agentes IA). Não há equipes separadas de "backend" e "VPS" como justificativa para repos separados.
- A operação na VPS já é única (instalação manual via `install.sh` rodada pelo CEO).

---

## Alternativas Consideradas

### Alternativa A — Monorepo `Scrumban-Backend-V2/agent/` (escolhida)

Código do agente vive em `agent/` no mesmo repo do backend. Build independente (`cd agent && npm install && npm run build`), `node_modules/` próprio, `dist/` gitignored.

**Prós:**
- **Mudanças de protocolo em PR único.** Quando `/v1/execute` ganha campo `resumeSessionId` (ADR-V2-037), o backend (`RemoteExecutionClient`) e o agente (`dispatcher.ts`) sobem juntos. Zero janela de divergência.
- **CI/CD único** — quando hooks `npm test` rodam, tanto `Scrumban-Backend-V2/` quanto `agent/` são verificados.
- **ADRs no mesmo `docs/decisions/`** — sem duplicação ou divergência semântica entre repos.
- **Governança canônica:** o agente herda implicitamente a regra "zero tabela nova" (ADR-V2-001) e os 3 Pilares — mesmo não tocando o banco diretamente, qualquer decisão futura cruza referência aqui.
- **Reuso de utilitários do template:** quando `agent/src/tunnel/autossh.wrapper.ts` for promovido a `Devari-Core` no futuro, o caminho é git-mv → submodule/template; ter no monorepo agora não é obstáculo.

**Contras:**
- **`npm install` separado em `agent/`** — não é workspace npm (decisão consciente: `agent/` tem deps próprias mais enxutas; mover para workspace introduziria peer deps spaghetti).
- **`agent/node_modules/` e `agent/dist/`** podem inflar o repo se commitados — mitigação: `.gitignore` cobre ambos.
- Se um dia o agente precisar evoluir independentemente (versionamento separado, releases em ritmo diferente), terá que ser extraído. Mitigação: `git filter-branch --subdirectory-filter agent/` preserva histórico completo. Custo de extração futuro é baixo.

### Alternativa B — Repo separado `scrumban-agent`

**Prós:**
- Deploy independente (release tags separadas).
- Versionamento isolado.

**Contras:**
- **CI/CD dobrado** (workflows separados para 2 repos do mesmo projeto).
- **ADRs divididos** — qual repo recebe o ADR de protocolo? Ambos? Divergência semântica garantida.
- **Sincronização manual de versões compatíveis** entre backend e agente — sem mecanismo nativo (Git submodule resolveria mas adiciona overhead operacional, ver alternativa C).
- **Sem ganho real** — não há time separado, não há release cadence diferente. Repo separado seria cerimônia sem benefício.

Rejeitada.

### Alternativa C — Git submodule

`Scrumban-Backend-V2/` referencia `agent/` como submodule apontando para repo `scrumban-agent`.

**Prós:**
- Vinculação versionada (commit hash do agent no backend).

**Contras:**
- **Overhead operacional alto:** todo PR de protocolo precisa commit no submodule + bump no parent + 2 reviews. CEO solo + agentes IA = pain crônica.
- **Onboarding mais lento** (clone com `--recurse-submodules`, `git submodule update --remote` esquecido quebra build silenciosamente).
- **Não resolve o problema central:** versionamento atômico continua sendo manual.

Rejeitada.

---

## Decisão

**Código do agente cliente V2 vive em `Scrumban-Backend-V2/agent/` (monorepo).** Layout:

```
Scrumban-Backend-V2/
├── agent/                         ← novo (este ADR)
│   ├── src/                       ← código TS do agente
│   ├── __tests__/
│   ├── systemd/
│   │   └── scrumban-agent.service
│   ├── install.sh
│   ├── uninstall.sh
│   ├── CLAUDE-md-template.md
│   ├── package.json               ← deps próprias (express, zod, pino, etc.)
│   ├── tsconfig.json
│   ├── eslint.config.js
│   ├── jest.config.js
│   ├── .gitignore                 ← node_modules/, dist/, coverage/, .claude/
│   └── README.md                  ← este subprojeto
├── src/                           ← backend NestJS (inalterado)
├── prisma/
├── docs/
└── ...
```

**Build/test isolados:** `cd agent && npm install && npm test && npm run build` — não interfere com `npm` do parent.

**Versionamento:** sem `package.json` no root unindo os dois (não é npm workspace). PR que toca protocolo toca os dois diretórios — single review, single commit, single deploy.

**Artefatos não-commitados:** `agent/node_modules/`, `agent/dist/`, `agent/coverage/` ficam fora de git. Bundle de deploy é gerado on-demand (`tar czf` no dev, `scp` para VPS — ver `install.sh` OPÇÃO C).

---

## Consequências

### Positivas

- **Atomicidade backend ↔ agente:** mudanças de protocolo em PR único. Zero janela de versão divergente. Implementado já nas Sub-tarefas 2.2 e 2.5 do plan-task2 (backend mudou `RemoteExecutionClient` para síncrono `{accepted, executionId}` e agente acolheu o novo contrato no mesmo ciclo).
- **ADRs unificados:** `docs/decisions/ADR-V2-XXX.md` cobre backend e agente sem duplicação.
- **Hooks de qualidade único:** mesmo padrão de Conventional Commits (`feat(agent): ...`), mesma cadeia Strategist→Implementer→Reviewer→Documenter, mesma memória `.claude/agent-memory/`.
- **Reaproveitamento futuro:** quando o template Devari-Core ganhar um agente cliente genérico, o caminho é `git mv agent/ ../Devari-Core/templates/agent/` + adaptação — histórico completo migra junto.
- **Build artifacts isolados:** deploy do backend (`Dokploy`) NÃO empacota `agent/dist/` — `Dockerfile` do backend não toca `agent/`.

### Negativas (e mitigações)

- **`npm install` separado:** quem clona o repo precisa rodar `cd agent && npm install` para mexer no agente. Mitigação: README raiz e `agent/README.md` documentam. CI faz ambos via script wrapper.
- **Dois `node_modules/`** no disco quando o dev mexe em ambos. Aceitável — disk é barato, evitar workspace npm vale a pena pela simplicidade de deps.
- **Reviewers/Documenters precisam saber dos dois caminhos** (`src/automation/runtime/remote-execution-client.ts` no backend e `agent/src/server/dispatcher.ts` no cliente). Mitigação: ADR-V2-033 documenta o contrato outbound/inbound completo, links nos planos amarram os dois lados.

### Neutras

- **Extração futura é trivial** se houver razão real (CI separado, release independente, equipe diferente). `git filter-branch` ou `git subtree split` preservam histórico completo. Custo de migração reverso ~1h.
- **Não exige mudança em hooks existentes** — `enforce-canonical-tables.sh`, `validate-review-score.sh` etc. operam no Scrumban-Backend-V2 inteiro, agente incluído (mas o agente não toca tabelas, então o hook é no-op para ele).

---

## Validação

### Hooks de validação acionados

- `cd agent && npm test` PASS (84/84 specs ao fim da Sub-tarefa 6).
- `cd agent && npm run build` PASS (tsc → `dist/`).
- `cd agent && npm run lint` PASS (eslint, zero warnings).
- Reviewer da Sub-tarefa 1 (scaffolding) validou estrutura, deps mínimas (`express`, `zod`, `pino`, `node-fetch`), tsconfig isolado.
- Reviewer da Sub-tarefa 6 (install.sh) validou que `install.sh` referencia `dist/` relativo (não exige path absoluto do parent repo).
- `Dockerfile` do backend (verificado): não copia `agent/` — build do backend ignora subprojeto.

### Gatilho de revisão

Reavaliar este ADR se:
1. Surgir time/equipe operando o agente separadamente do backend (improvável a curto prazo).
2. Volume de PRs cross-cutting (backend+agent) cair drasticamente (sinaliza acoplamento fraco e justifica repo separado).
3. CI/CD do parent ficar pesado por causa de `agent/__tests__/` (pode justificar split, mas hoje os 84 specs do agente rodam em ~3.4s — irrelevante).

---

## Referências

- `workspace/plans/plan-automation-agent-v2-client-task1.md` §2 (alternativas A/B/C/D) e §4 (estrutura técnica).
- `agent/README.md` — documentação operacional do subprojeto.
- `agent/.gitignore` — confirma `node_modules/`, `dist/`, `coverage/`, `.claude/` fora do versionamento.
- ADR-V2-035 (identidade `projectSlug` + `CLAUDE.md` global).
- ADR-V2-037 (ponteiro de sessão Claude Code — complementar).
- ADR-V2-033 (contrato `/v1/execute` outbound + `execution-result` inbound — toca backend e agente simultaneamente; exemplo do benefício do monorepo).

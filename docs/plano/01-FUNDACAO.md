# Sub-Plano 01 — FUNDAÇÃO (Fases 0 a 4)

**Bloco do plano:** 1/4 — Fundação canônica
**Estrategista responsável:** Strategist (Devari-Core multi-agent)
**Data:** 2026-05-08
**Repositório-alvo:** `/Users/devaritecnologia/Documents/Benedito/Scrumban-Backend-V2/`
**Repositório-pai (template):** `/Users/devaritecnologia/Documents/Benedito/Devari-Core/`
**Repositório-legado (referência funcional):** `/Users/devaritecnologia/Documents/Benedito/Scrumbam-Backend/`

---

## 0. INVARIANTES NÃO-NEGOCIÁVEIS

Estas regras valem para TODAS as 5 fases deste sub-plano e devem ser revalidadas em cada Definition of Done. Se qualquer uma falhar, a fase **NÃO está pronta**.

1. **17 tabelas canônicas, ZERO tabela nova.** Schema replica fielmente o canônico Devari-Core (`DClasse, DEntidade, DTabela, DVincula, DEvento, DRecurso, DUserGroup, DPermissao, DTask, DProject, DPedido, DTitulo, DMovDispo, DMovDepos, DSolicita, DRequisic, DVFS`). Modelos próprios do legado (`DProjectMember`, `DNotification`, `DWebhook`, `DAgent`, `DExecution`) **não existem aqui**.
2. **Adição de coluna só com ADR.** Qualquer campo novo numa tabela canônica precisa ser (a) Json aditivo (`dados` / `metaDados`) **ou** (b) coluna útil para qualquer SaaS futuro, sempre com ADR no template. Sem ADR ⇒ não vai pro schema.
3. **Pilar 3 antes de qualquer linha de código.** Sem `prisma/seeds/classes.seed.ts` rodando, nenhuma fase posterior pode declarar conclusão.
4. **Pilar 2 obrigatório para DEntidade/DTabela/DClasse.** `EntidadeController`, `TabelaController` e `ClasseController` são genéricos e canônicos. Não criar `UserController`/`OrganizationController`/`SprintController` etc.
5. **Pilar 1 ativo via `OperacaoExecucaoClaude` (planejado para FASE de Engine, fora deste sub-plano).** Esta fundação prepara o terreno (schema com `DPedido`, `DVFS`, pasta `src/engine/` vazia + `Operacao` base abstrata) sem implementar workflows ainda.
6. **Faixa de DClasses específicas Scrumban: -150 a -499.** NUNCA tocar em `-1 a -110` (canônicas) nem sequestrar `-40` (Conta Virtual), `-45` (Marketplace), `-47` (Seller), `-49` (Plataforma), `-50` (Comprador). O legado sequestrou `-47` como "Usuário" — V2 corrige isso.
7. **Pastas canônicas obrigatórias presentes desde a FASE 0:** `src/{engine,entidades,tabelas,classes,auth,permissoes,eventos,common,database,email}/`. Nenhuma pode faltar — mesmo vazia, com README justificando o status.
8. **Hooks de validação ativos.** `.claude/scripts/` replicado e fiscalizando build, nomenclatura de workspace, ausência de `console.log`, ausência de `prisma.dPedido.create()` direto, ausência de tabela nova fora das 17.
9. **Conventional Commits + JSDoc 100% em métodos públicos** desde o primeiro commit.
10. **`make build` deve passar com 0 erros TypeScript em toda fase.** Se não passa, fase não fecha.
11. **Português em commits e documentação interna; inglês permitido apenas em código (variáveis/identificadores).**
12. **Tudo que o Scrumban legado entrega (128 endpoints, V3 intentions, flow metrics, forecast, Telegram+Groq, MCP, Webhooks HMAC, Automation Claude Code) cabe nas 17 tabelas via DClasse + DTabela + DVincula + DEvento + DPedido + Json aditivo.** Esta é a aposta arquitetural — qualquer fase deve manter essa aposta intacta.

---

## FASE 0 — Verificação Canônica + Setup Repositório + Multi-Agent Infra

### Objetivo

Estabelecer base mínima do repositório `Scrumban-Backend-V2/` aderente ao template Devari-Core, **com fábrica multi-agent operacional desde o dia 0**. Esta fase é puramente estrutural: garante que (a) o schema canônico foi compreendido e auditado, (b) o repositório nasce com pastas, hooks, scripts, settings, CLAUDE.md certos, (c) nenhuma decisão arquitetural pode mais ser tomada por descuido (hooks barram), e (d) **a fábrica multi-agent (Strategist→Implementer→Reviewer→Documenter) está operacional** com agents adaptados ao V2, agent-memory bootstrapped, slash commands V2-específicos, score gate APPROVED ≥ 7.0 enforçado, e Workflow Orchestrator de 9 passos definido.

**Sub-objetivos novos (recalibração 2026-05-08, R2):**
- Multi-agent infra V2 não é "copiar `.claude/`" — é **adaptar e bootstrap** com conteúdo V2-específico.
- 4 MEMORY.md POPULADOS (não vazios) com 17 tabelas, hierarquia OOP, ADRs V2-001..V2-014, regras de rejeição.
- 6 slash commands V2-específicos: `/trabalhar`, `/auditoria`, `/seed-validate`, `/dvfs-test`, `/risk-gate-test`, `/golden-test`.
- Score gate APPROVED ≥ 7.0 mecanizado via `validate-review-score.sh` (NOVO).
- `enforce-canonical-tables.sh` (NOVO) bloqueia tabela nova fora das 17.
- CLAUDE.md raiz V2 com Workflow Orchestrator (9 passos) detalhado.
- Tabela comparativa dos 4 agents em `.claude/agents/README.md`.

Sai daqui um repositório que **não compila código de negócio nenhum**, mas tem (a) `make build` passando para `main.ts` vazio NestJS, (b) hooks ativos (incluindo score gate e canonical-tables), (c) ESLint+Prettier configurados, (d) protocolo de migrations funcionando, (e) **fábrica multi-agent operacional pronta para a primeira task de F1**.

### Pilares ativados / respeitados

- **Pilar 3 (parcial):** prepara o terreno — diretório `prisma/seeds/` pronto, mas seed em si é Fase 1.
- **Disciplina canônica:** os 3 pilares todos são protegidos por hooks já na Fase 0.

Refs: `Devari-Core/.claude/rules/devari-3-pilares.md`, `Devari-Core/.claude/rules/devari-polymorphic-engine.md`, `Devari-Core/.claude/rules/devari-migration-protocol.md`.

### Padrões obrigatórios aplicados

- #1 PrismaService como única porta de banco.
- #11 Logger NestJS desde sempre, `console.log` proibido por hook.
- #18 Imports organizados (NestJS → libs → services → DTOs → tipos).
- #21 Checklist de qualidade aplicado pelos hooks.

### Tabelas canônicas envolvidas

Nenhuma — fase de infraestrutura.

### DClasses a criar nesta fase

Nenhuma — Fase 1 cria.

### Estrutura de arquivos esperada (ao final da Fase 0)

```
Scrumban-Backend-V2/
├── .claude/
│   ├── agents/                              # cópia de Devari-Core/.claude/agents/
│   │   ├── strategist.md
│   │   ├── implementer.md
│   │   ├── reviewer.md
│   │   └── documenter.md
│   ├── rules/                               # cópia de Devari-Core/.claude/rules/
│   │   ├── devari-3-pilares.md
│   │   ├── devari-polymorphic-engine.md
│   │   ├── devari-backend-patterns.md
│   │   ├── devari-saas-generator.md
│   │   ├── devari-event-naming.md
│   │   ├── devari-jsdoc-templates.md
│   │   ├── devari-conventional-commits.md
│   │   └── devari-migration-protocol.md
│   ├── scripts/                             # cópia exata + adaptações
│   │   ├── block-destructive-commands.sh
│   │   ├── session-setup.sh
│   │   ├── validate-plan.sh
│   │   ├── validate-implementation.sh
│   │   ├── validate-review.sh
│   │   ├── validate-documentation.sh
│   │   ├── validate-implementer-build.sh
│   │   ├── update-status-after-agent.sh
│   │   └── enforce-canonical-tables.sh      # NOVO — bloqueia tabela nova fora das 17
│   ├── agent-memory/{strategist,implementer,reviewer,documenter}/MEMORY.md
│   ├── settings.json                        # hooks PreToolUse/PostToolUse/SubagentStop/Stop
│   └── settings.local.json
├── docs/
│   ├── plano/
│   │   ├── 01-FUNDACAO.md                   # este documento
│   │   ├── 02-ENGINE-DOMINIO.md             # outro estrategista
│   │   ├── 03-INTEGRACOES.md                # outro estrategista
│   │   └── 04-HARDENING-HANDOFF.md          # outro estrategista
│   ├── ROADMAP.md                           # tarefas e progresso
│   ├── DECISIONS.md                         # ADRs (ADR-200..207 referenciados)
│   ├── MIGRATION-PROTOCOL.md                # cópia adaptada do canônico
│   └── ARCHITECTURE-OVERVIEW.md             # 1 página, declarando submissão ao template
├── prisma/
│   ├── schema.prisma                        # vazio (Fase 1 popula)
│   ├── seeds/                               # vazio (Fase 1 popula)
│   └── migrations/                          # vazio
├── src/
│   ├── main.ts                              # bootstrap NestJS minimal (porta 3000)
│   ├── app.module.ts                        # importa apenas HealthModule
│   ├── prisma.service.ts                    # canônico
│   ├── engine/                              # vazio + README "Pilar 1 — populado em fase posterior"
│   ├── entidades/                           # vazio + README "Pilar 2 genérico — Fase 2"
│   ├── tabelas/                             # vazio + README "Pilar 2 genérico — Fase 2"
│   ├── classes/                             # vazio + README "Pilar 2 genérico — Fase 2"
│   ├── auth/                                # vazio + README "Fase 3"
│   ├── permissoes/                          # vazio + README "Fase 3"
│   ├── eventos/                             # vazio + README "Fase posterior"
│   ├── common/                              # contém apenas health + (Fase 4) timezone, pipes
│   │   └── health/health.controller.ts      # GET /health → { status: 'ok' }
│   ├── database/                            # vazio + README "PrismaService já em src/prisma.service.ts"
│   └── email/                               # vazio + README "Fase 4"
├── templates/
│   └── classes-base-template.ts             # cópia idêntica do Devari-Core (~57 classes fixas)
├── test/                                    # vazio (Fase 4 inicia testes)
├── .env.example                             # DATABASE_URL, JWT_SECRET, PORT, TZ=America/Sao_Paulo
├── .env.local                               # NÃO commitar (gitignore)
├── .gitignore                               # node_modules, dist, .env*, .DS_Store, coverage/
├── .prettierrc                              # canônico (single quotes, 100 cols, semi)
├── .eslintrc.js                             # canônico (NestJS strict, no-console error)
├── .editorconfig
├── docker-compose.yml                       # postgres:15 + redis:7 (apenas dev)
├── Dockerfile                               # multi-stage, node:20-alpine
├── Makefile                                 # build, dev, seed, db:migrate, db:reset, lint, test
├── nest-cli.json
├── package.json                             # name: "scrumban-backend-v2"
├── tsconfig.json                            # strict: true, noImplicitAny: true
├── tsconfig.build.json
├── CLAUDE.md                                # declara submissão ao template, link para Devari-Core
└── README.md                                # como rodar local + link para docs/
```

### Tarefas detalhadas (lista numerada acionável)

1. **Auditar schema canônico Devari-Core** (output: `docs/SCHEMA-CANONICO-AUDITORIA.md`):
   - Listar as 17 tabelas oficiais e identificar quais já têm `dados` Json e quais teriam que adicionar.
   - O Devari-Core atual tem 14 modelos no schema (faltam DRecurso, DTask, DProject; faltam transacionais DMovDepos, DSolicita, DRequisic). V2 adota a doutrina das 17 e implementa todas — mesmo que algumas fiquem sem uso direto neste projeto.
   - Documentar para cada tabela: PK type (BigInt), FKs canônicas, índices recomendados.
2. **Criar repositório limpo:**
   - `git init` em `Scrumban-Backend-V2/`.
   - `git remote add origin <pendente>` (TBD com CEO antes do primeiro push).
3. **Setup `package.json`:**
   - Nome `scrumban-backend-v2`.
   - Scripts: `build`, `start:dev`, `start:prod`, `lint`, `test`, `test:e2e`, `seed:classes`, `db:migrate:dev`, `db:reset:dev`, `prisma:generate`.
   - Deps mínimas: `@nestjs/{common,core,platform-express,config,swagger,jwt,passport,schedule}`, `@prisma/client`, `prisma`, `class-validator`, `class-transformer`, `passport`, `passport-jwt`, `bcrypt`, `bullmq` (preparação), `ioredis` (preparação), `nodemailer` (Fase 4), `pino` (Fase 4 logger).
   - Dev deps: `typescript`, `@nestjs/testing`, `jest`, `ts-jest`, `eslint`, `prettier`, `@typescript-eslint/{parser,eslint-plugin}`, `husky`, `lint-staged`.
4. **Setup `tsconfig.json` strict:** `strict: true`, `noImplicitAny: true`, `strictNullChecks: true`, `noUncheckedIndexedAccess: true`, `target: ES2022`, `module: CommonJS`, `experimentalDecorators: true`, `emitDecoratorMetadata: true`.
5. **Setup `Makefile`** com targets: `build`, `dev`, `prod`, `seed`, `db:migrate`, `db:reset`, `db:studio`, `lint`, `format`, `test`, `test:cov`, `test:e2e`, `clean`. Esses targets são citados nos hooks de validação.
6. **Setup `docker-compose.yml`** local: `postgres:15` na porta 5432 (db `scrumban_v2_dev`) + `redis:7` na porta 6379. Apenas dev — **sem** servir produção daqui.
7. **Setup `.env.example`:** `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET`, `JWT_EXPIRES_IN=15m`, `JWT_REFRESH_EXPIRES_IN=7d`, `PORT=3000`, `NODE_ENV=development`, `TZ=America/Sao_Paulo`, `REDIS_URL`, `EMAIL_*` (placeholders), `LOG_LEVEL=info`.
8. **Setup `.gitignore`** canônico (node_modules, dist, coverage, .env*, .DS_Store, *.log, /tmp, .vscode/, .idea/).
9. **Setup `.prettierrc` + `.eslintrc.js`** com regras `no-console: error`, `@typescript-eslint/no-explicit-any: error`, `import/order` configurado.
10. **Estrutura `.claude/` V2 (ADAPTADA, não copiada cega):**
    - `.claude/agents/{strategist,implementer,reviewer,documenter}.md` — agents V2-específicos com instruções para 17 tabelas, OperacaoExecucaoClaude extends OperacaoPedido, escopo Scrumban-hoje, 14 ADRs V2.
    - `.claude/agents/README.md` — tabela comparativa dos 4 agents (cor, modelo, tempo target, Bash, memory, skills, hook Stop, output, score gate).
    - `.claude/rules/` — cópia das 8 regras canônicas Devari-Core (`devari-3-pilares.md`, `devari-polymorphic-engine.md`, `devari-backend-patterns.md`, `devari-saas-generator.md`, `devari-event-naming.md`, `devari-jsdoc-templates.md`, `devari-conventional-commits.md`, `devari-migration-protocol.md`).
    - `.claude/scripts/` — 10 scripts shell (ver tarefa 11).
    - `.claude/agent-memory/{strategist,implementer,reviewer,documenter}/MEMORY.md` — **POPULADOS com conteúdo semente V2** (não vazios; ver tarefa 13).
    - `.claude/commands/` — 6 slash commands V2 (ver tarefa 14).
    - `.claude/settings.json` — hooks ativos.
    - `.claude/settings.local.json` — env vars locais (gitignored).

11. **Scripts `.claude/scripts/` (10 — incluindo 2 NOVOS):**
    - `block-destructive-commands.sh` (PreToolUse Bash)
    - `session-setup.sh` (SessionStart — adaptado V2: docker-compose ps + prisma generate + checagem ≥90 DClasses)
    - `validate-plan.sh` (Stop Strategist — regex de módulos V2: `engine|seeds|endpoints|core|auth|eventos|entidades|tabelas|classes|common|channels|mcp|webhooks|automation|executions|flow-metrics|reports|email|permissoes|docs|agents`; sem `pagamento`)
    - `validate-implementation.sh` (Stop Implementer — build + tsc + eslint + Pilar 1 grep)
    - `validate-review.sh` (Stop Reviewer — naming + score numérico + decisão)
    - **`validate-review-score.sh` (NOVO — Stop Reviewer secundário OU SubagentStop):** score gate mecânico, APPROVED com score < 7.0 → exit 2. ADR-V2-015.
    - `validate-documentation.sh` (Stop Documenter — ROADMAP + CHANGELOG + STATUS + commit Conventional + scope V2)
    - `validate-implementer-build.sh` (SubagentStop — double-check build + Pilar 1)
    - `update-status-after-agent.sh` (SubagentStop por agent — registra em STATUS.md)
    - **`enforce-canonical-tables.sh` (NOVO — PreToolUse Write/Edit/Bash):** bloqueia ALTER TABLE / CREATE TABLE de tabelas fora das 17 canônicas. Bloqueia também `^model ` em `prisma/schema.prisma` se nome não for `DClasse|DEntidade|DTabela|DVincula|DEvento|DRecurso|DUserGroup|DPermissao|DTask|DProject|DPedido|DTitulo|DMovDispo|DMovDepos|DSolicita|DRequisic|DVFS`.
    - Todos com `chmod +x` e shebang.

12. **`.claude/settings.json` V2 — mapear todos os hooks:**
    - PreToolUse Bash → `block-destructive-commands.sh`
    - PreToolUse Bash|Write|Edit|MultiEdit → `enforce-canonical-tables.sh` (NOVO — defesa contra tabela nova)
    - PostToolUse Write|Edit|MultiEdit → prettier (async) + eslint (sync, exit 2 se errors, `--max-warnings 0`) + tsc (async)
    - SubagentStop strategist → `update-status-after-agent.sh strategist`
    - SubagentStop implementer → `validate-implementer-build.sh` + `update-status-after-agent.sh implementer`
    - SubagentStop reviewer → `validate-review-score.sh` (NOVO — score gate enforcement) + `update-status-after-agent.sh reviewer`
    - SubagentStop documenter → `update-status-after-agent.sh documenter`
    - SessionStart → `session-setup.sh`

13. **Bootstrap das 4 MEMORY.md V2 (POPULADAS, não vazias):**
    - `agent-memory/strategist/MEMORY.md`: contexto V2, 3 Pilares, 17 tabelas, mapa de 17 fases, 14 ADRs propostos, conflitos resolvidos no §3.3 do plano-mestre, links para 3 PARTES da bíblia, faixas de chave V2 (-150..-529), riscos top 5
    - `agent-memory/implementer/MEMORY.md`: hierarquia OOP do Engine (`OperacaoExecucaoClaude extends OperacaoPedido`), DVFS chaves 3-7, regra "Engine APENAS em DPedido idClasse=-300", 21 padrões obrigatórios, 8 anti-padrões + extras V2, codepaths críticos, gotchas (jsonb_set, command injection, SSH reverso, hierarquia idPai)
    - `agent-memory/reviewer/MEMORY.md`: rejeições automáticas (Prisma direto em transacional, controller duplicado, seed faltando, chave positiva, sequestro canônica, tabela nova, RCE em F13), score gate APPROVED ≥ 7.0, 12 itens checklist, 58 testes adversariais Risk Gate (F13)
    - `agent-memory/documenter/MEMORY.md`: lista oficial dos 14 ADRs V2 com slugs, JSDoc templates por tipo (service/controller/DTO/Engine), Conventional Commits scope V2 oficial (sem `pagamento`; com `channels|mcp|webhooks|automation|executions|flow-metrics|reports|email|permissoes`), templates STATUS.md/CHANGELOG/ROADMAP entries
    - **Cada MEMORY.md tem 200-500 linhas com contexto útil.**

14. **Slash commands V2 (`.claude/commands/`):**
    - `trabalhar.md` (mantido do Devari-Core, adaptado para `SCRUMBAN_V2_EMAIL/PASSWORD` e endpoints V2 incluindo `/executions`, `/flow-metrics`, `/forecast`)
    - `auditoria.md` (NOVO — checagem rápida 3 Pilares + 17 tabelas + ADRs)
    - `seed-validate.md` (NOVO — validação Pilar 3: total ≥90, chaves negativas, sem sequestro canônica, DClasses obrigatórias §3.2)
    - `dvfs-test.md` (NOVO — validação DVFS chaves 3-7 + bug regressivo `s.id` vs `s.chave`)
    - `risk-gate-test.md` (NOVO — 58 testes adversariais F13)
    - `golden-test.md` (NOVO — paridade contrato HTTP V2 vs Legado, F14/F15)

15. **`CLAUDE.md` raiz V2** declarando:
    - Scrumban-Backend-V2 é projeto-filho do Devari-Core
    - **Workflow Orchestrator (9 passos)** detalhado (replicar PARTE-2 §9 — coração do sistema multi-agent)
    - Submete-se ao template — exceções só com ADR-V2-XXX
    - Link para `docs/plano/00-PLANO-MESTRE.md` e sub-planos
    - Lista das 17 tabelas
    - Lista de eliminações vs. legado (DProjectMember/DNotification/DWebhook/DAgent/DExecution)
    - Regras de ouro V2 (10 regras com hook que valida cada)
    - Checklist de início para qualquer agent que entrar no projeto
    - Hierarquia de leitura (CLAUDE.md raiz → plano-mestre → sub-planos → auditoria → agents/README → MEMORY → rules)
    - Cronograma 24 semanas (corda justa)

16. **`docs/CHANGELOG.md` (NOVO — Keep a Changelog format):** seção `## [Unreleased]` vazia + `### Added/Changed/Fixed/Performance/Tests` placeholders. Cada task ADICIONA entry aqui (não em F16 final).

17. **`workspace/STATUS.md` (NOVO — template inicial):** template canônico do Documenter (ver `agent-memory/documenter/MEMORY.md`). Cada SubagentStop por agent registra entry aqui via `update-status-after-agent.sh`.

18. **`workspace/{plans,implementations,reviews,messages}/`:** pastas vazias com README breve referenciando PARTE-2 §10-11 (audit trail, nomenclatura `[tipo]-[modulo]-[descricao]-task[N].md`).

19. **`docs/ROADMAP.md`** estrutura mínima (será populado pelos outros estrategistas) e `docs/decisions/ADR-V2-200-submissao-template.md` (declarativo, status ACEITO).

20. **`docs/decisions/`** — pasta com 14 placeholders dos ADRs propostos (ADR-V2-001 a ADR-V2-014). Cada placeholder tem ao menos: contexto, status `Proposto`, fase vinculada, link para o sub-plano que detalha. Documenter formaliza ao concluir cada fase.

21. **`docs/MIGRATION-PROTOCOL.md`** — cópia adaptada de `Devari-Core/.claude/rules/devari-migration-protocol.md`.
22. **Criar `src/main.ts` + `app.module.ts` mínimo** com Health module respondendo `GET /health → { status: 'ok', timestamp }`. Bootstrap NestJS com Swagger habilitado (placeholder), pipe `ValidationPipe` global, prefixo `/api/v1`.
23. **Criar `src/prisma.service.ts`** canônico (extends `PrismaClient`, `onModuleInit` chama `$connect`, `onModuleDestroy` chama `$disconnect`).
24. **Criar pastas vazias com README justificando** em `src/{engine,entidades,tabelas,classes,auth,permissoes,eventos,common,database,email}/`. Cada README diz qual fase do plano popula a pasta. Isso garante que a estrutura canônica é visível desde dia 0 — não é "vamos criar quando precisar".
25. **Copiar `templates/classes-base-template.ts`** idêntico do Devari-Core (~50-57 classes fixas, Range -1..-110). Validar que importa sem erro de TypeScript. **Auditoria PARTE-1 detectou que esse template pode estar incompleto (faltam separar Dinpayz-específicas das universais);** F0.5 (NOVA — opcional) trata disso se preciso.
26. **Configurar Husky + lint-staged** para rodar prettier+eslint+tsc no `pre-commit`.
27. **Configurar Conventional Commits via commitlint** — bloqueia commits fora do formato `<type>(<scope>): <subject>` com scopes V2 oficiais (`engine|seeds|endpoints|core|auth|eventos|entidades|tabelas|classes|common|channels|mcp|webhooks|automation|executions|flow-metrics|reports|email|permissoes|docs|agents`; **sem `pagamento`**).
28. **Smoke test final Fase 0:** `make build` passa, `npm run start:dev` sobe, `curl localhost:3000/api/v1/health` responde 200, `prisma generate` roda sem schema. `git log --oneline` mostra commits Conventional. **Multi-agent smoke:** rodar `/auditoria` slash command (deve listar `.claude/` populado e 4 MEMORY.md > 100 linhas cada).

### Dependências

Nenhuma fase anterior. **Bloqueia** todas as Fases 1+.

### Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|---------------|-----------|
| Hook `enforce-canonical-tables.sh` ter falso positivo (bloquear migration legítima de campo aditivo) | Média | Hook olha apenas `^model `, não `^[ ]*field`. Testar com 5 cenários antes de ativar. |
| Equipe achar que README vazio em pasta canônica é dispensável e remover | Alta (cultural) | README diz "DELETION OF THIS FOLDER FORBIDDEN — see ADR-200". Hook PreToolUse bloqueia delete. |
| `make build` passar mas `prisma generate` falhar silenciosamente | Baixa | `make build` chama `prisma generate` antes de tsc. |
| Engenheiros pularem a Fase 0 e começarem schema direto | Média | Hook `validate-plan.sh` exige plano de fase atual antes de aceitar Edit em `prisma/schema.prisma`. |

### Definition of Done (checklist)

**Build & runtime:**
- [ ] `make build` passa com 0 erros TS.
- [ ] `npm run start:dev` sobe e `GET /api/v1/health` responde 200.
- [ ] `docker compose up -d` sobe Postgres+Redis localmente.
- [ ] `prisma generate` roda.

**Estrutura:**
- [ ] Todas as 10 pastas canônicas em `src/` existem com README.
- [ ] `.env.example` completo, `.env.local` no gitignore.
- [ ] `templates/classes-base-template.ts` presente, importa sem erro.

**Multi-agent infra (NOVO — recalibração 2026-05-08):**
- [ ] `.claude/agents/{strategist,implementer,reviewer,documenter}.md` adaptados V2 (com 17 tabelas, OperacaoExecucaoClaude, escopo Scrumban-hoje).
- [ ] `.claude/agents/README.md` com tabela comparativa dos 4 agents.
- [ ] `.claude/rules/` com as 8 regras canônicas copiadas.
- [ ] `.claude/scripts/` com 10 scripts (incluindo `validate-review-score.sh` e `enforce-canonical-tables.sh` NOVOS).
- [ ] `.claude/agent-memory/{role}/MEMORY.md` POPULADOS (>100 linhas cada com contexto V2).
- [ ] `.claude/commands/` com 6 slash commands V2 (`/trabalhar`, `/auditoria`, `/seed-validate`, `/dvfs-test`, `/risk-gate-test`, `/golden-test`).
- [ ] `.claude/settings.json` com hooks PreToolUse + PostToolUse + SubagentStop + SessionStart.
- [ ] `.claude/settings.local.json` com placeholders de env vars (sem secrets, gitignored).
- [ ] `workspace/{plans,implementations,reviews,messages}/` criadas.
- [ ] `workspace/STATUS.md` template inicial.
- [ ] `docs/CHANGELOG.md` Keep a Changelog format com `[Unreleased]` vazio.
- [ ] `docs/decisions/` com 14 placeholders ADR-V2-001..V2-014 + ADR-V2-200 ACEITO.

**Hooks operacionais (smoke test):**
- [ ] `enforce-canonical-tables.sh` testado: tentar adicionar `model DAgent {}` em `prisma/schema.prisma` deve ser BLOQUEADO.
- [ ] `validate-review-score.sh` testado: review com `APPROVED` + `score: 6/10` deve ser BLOQUEADO (exit 2).
- [ ] `block-destructive-commands.sh` testado: `git commit --no-verify` deve ser BLOQUEADO.
- [ ] Husky pre-commit roda prettier+eslint+tsc sem falhar.
- [ ] Commitlint: aceita `fix(core): corrige health response`; rejeita `fix bug`; rejeita `feat(pagamento): xyz` (scope inválido em V2).

**Documentação:**
- [ ] `docs/plano/01-FUNDACAO.md` versionado.
- [ ] `CLAUDE.md` raiz declara submissão, lista 17 tabelas, lista eliminações, replica Workflow Orchestrator (9 passos).
- [ ] Conventional Commits respeitado.
- [ ] JSDoc em `prisma.service.ts` e `health.controller.ts`.
- [ ] Sem `console.log` (eslint error).
- [ ] Sem `prisma.dXxx.create()` direto (proteção preventiva).

### Tempo estimado

**5-7 dias úteis** (recalibrado 2026-05-08 com bootstrap multi-agent completo).
- Auditoria schema + decisões: 0,5d
- Setup repositório (package, ts, docker, eslint, husky): 1d
- Adaptação `.claude/` agents V2-específicos + README.md comparativo: 0,75d
- Bootstrap 4 MEMORY.md POPULADAS (não vazias): 1d
- 6 slash commands V2 (`/auditoria`, `/seed-validate`, `/dvfs-test`, `/risk-gate-test`, `/golden-test`, `/trabalhar` adaptado): 0,5d
- 10 scripts shell (incluindo `validate-review-score.sh` + `enforce-canonical-tables.sh` NOVOS) + testes: 1d
- CLAUDE.md raiz V2 com Workflow Orchestrator + 14 ADRs placeholders + STATUS.md + CHANGELOG: 0,5d
- Pastas canônicas + READMEs: 0,25d
- Smoke test (incluindo testes dos hooks novos) + ajustes: 0,5d
- Buffer 20%: 0,75d

### Como validar (smoke test)

```bash
cd /Users/devaritecnologia/Documents/Benedito/Scrumban-Backend-V2
docker compose up -d
make build                                   # esperado: PASS
npm run start:dev &
sleep 5
curl -s http://localhost:3000/api/v1/health  # esperado: {"status":"ok",...}
kill %1

# Testa hook anti-tabela-nova
echo 'model DAgent { id BigInt @id }' >> prisma/schema.prisma
git add prisma/schema.prisma
git commit -m "feat(core): testa hook"       # esperado: BLOCKED por hook
git checkout prisma/schema.prisma            # rollback

# Testa commitlint
git commit -m "msg sem scope"                # esperado: REJEITADO
git commit -m "feat(core): mensagem ok"      # esperado: ACEITO
```

---

## FASE 1 — Pilar 3: Schema Canônico + Seed de DClasses (PRIORIDADE ABSOLUTA)

### Objetivo

Implementar o schema canônico das 17 tabelas Devari-Core e popular `prisma/seeds/classes.seed.ts` com (a) ~57 classes fixas importadas de `templates/classes-base-template.ts`, (b) ~40 classes específicas do Scrumban no range -150..-499, **sem sequestrar canônicas** (corrigindo o erro do legado que usou -47 para "Usuário"). Sistema deve subir, seed deve rodar, `prisma db seed && curl /health` deve funcionar.

Esta fase é a **fundação da fundação**. Sem seed correto, tudo desaba (Pilar 3). É a primeira coisa que o Implementer deve gerar antes de qualquer outra linha de código de domínio.

### Pilares ativados / respeitados

- **Pilar 3 (PLENO):** seed completo, idempotente, validado por hierarquia.
- **Pilar 1 (PREPARAÇÃO):** schema inclui DPedido, DTitulo, DMovDispo, DVFS — Engine ainda vazio mas tabelas disponíveis para fase posterior implementar `OperacaoExecucaoClaude`.

Refs: `Devari-Core/.claude/rules/devari-3-pilares.md` §Pilar 3, `Devari-Core/.claude/rules/devari-polymorphic-engine.md` §3 e §10.

### Padrões obrigatórios aplicados

- #1 PrismaService.
- #2 BigInt em todas as PKs.
- #3 Transactions ($transaction) no seed para atomicidade.
- #5 Convenção `idLocEscritu` para dono de vínculo.
- #8 Decimal(19,4) em campos monetários (DPedido, DTitulo, DMovDispo).
- #19 Constantes de IDs apenas no seed, NUNCA hardcoded em services.

### Tabelas canônicas envolvidas

**Todas as 17.** Cada uma tem schema definido e migration aditiva criada nesta fase.

| Tabela | Papel V2 | `dados`/`metaDados` Json? | Uso imediato no Scrumban V2? |
|--------|----------|---------------------------|------------------------------|
| **DClasse** | Sistema de tipos (89 classes) | não — campo `tableFields` Json existe | SIM — base de tudo |
| **DEntidade** | Users (-47), Organizations (-50), Teams (-460), Agents (-490 — opt-in via DClasse), Sellers (futuro) | sim (`dados` Json para defaultProjectId, telegramChatId, mcpKey hash, onboardingCompleted) | SIM |
| **DTabela** | Sprints (-400), Workflow Statuses V3 (-440), Priorities (-420), Task Types (-430), Channels (-450), Webhooks (-470), Notifications (-480), API Keys (-475), MCP Keys (-476) | sim (`dados` Json para webhook config, hmac secret hash, channel meta) | SIM |
| **DVincula** | Org-User (RBAC), Project-User, Project-Team, Team-User, Project-Agent | sim (`metaDados` Json para role payload) | SIM |
| **DEvento** | Audit trail completo (entity.created, task.moved, automation.executed, etc.) | sim (`metaDados` Json) | SIM |
| **DRecurso** | Reservada — futura categoria de tasks por tipo de recurso (rara em Scrumban) | sim | NÃO uso direto, mantida no schema por canonicidade |
| **DUserGroup** | Credenciais de login (user/pass), refresh tokens em `dados` Json | sim (`dados` Json para refreshTokenHash, mcpKeyHash) | SIM |
| **DPermissao** | Permissões além das 3 cargos básicos | sim | SIM (Fase 3) |
| **DTask** | Intentions V3 (INBOX→READY→...→DONE) | sim (`dados` Json para hillPosition, intention metadata, telemetria) | SIM |
| **DProject** | Projetos | sim (`dados` Json para apiKeyHash, agentLink, gitConfig, automation flags) | SIM |
| **DPedido** | **Pilar 1 ativado: cada execução de Claude Code é um DPedido (idClasse=-491 EXECUCAO_CLAUDE)** | sim (`metaDados` Json para approvalFlow, riskLevel, claudeRuntime) | SIM (fase Engine — outro estrategista) |
| **DTitulo** | Reservada — não usada hoje, schema disponível | sim | NÃO uso direto |
| **DMovDispo** | Reservada — saldo/extrato financeiro futuro | sim | NÃO uso direto |
| **DMovDepos** | Reservada | sim | NÃO uso direto |
| **DSolicita** | Reservada | sim | NÃO uso direto |
| **DRequisic** | Reservada | sim | NÃO uso direto |
| **DVFS** | Scripts de Engine (Pilar 1 — chaves 3, 4, 5, 6, 7) | n/a — campo `script` String | SIM (fase Engine — schema apenas aqui) |

### DClasses a criar nesta fase

**Fixas (vêm de `templates/classes-base-template.ts` — ~57 classes, range -1..-110):** Root, Movimentações, Eventos, Financeiro, Títulos, Pedidos, Cadastros, Entidades, Pessoas, Usuários (-46), Tabelas (-51), Status (-52), Scripts (-90), Eventos de Segurança (-110). Importadas via spread, intocadas.

**Específicas Scrumban V2 (~40 classes, range -150..-499):**

> **REGRA CRÍTICA:** abaixo todas as chaves devem ser revisadas para NÃO colidirem com canônicas em -1..-110, -40 (Conta Virtual), -45 (Marketplace), -47 (Seller), -49 (Plataforma), -50 (Comprador). Onde o legado violou (-47 = Usuário; -49 = Platform; -50 = Organization), V2 **renumera** para -150+. Mapeamento explícito:

| Antigo (legado) | Novo (V2) | Codigo | Nome | idPai | agrupamento |
|-----------------|-----------|--------|------|-------|-------------|
| -47 (sequestrado de Seller) | **-150** | `USER` | Usuário Scrumban | -46 | false |
| -49 (sequestrado de Platform) | **-151** | `PLATFORM_SCRUMBAN` | Platform Scrumban | -43 | false |
| -50 (sequestrado de Comprador) | **-152** | `ORGANIZATION` | Organization | -43 | false |
| (novo) | **-160** | `ORG_USER_LINK` | Vínculo Org-User | -37 | true |
| (novo) | **-161** | `ORG_ROLE_ADMIN` | Org Role Admin | -160 | false |
| (novo) | **-162** | `ORG_ROLE_MEMBER` | Org Role Member | -160 | false |
| (novo) | **-163** | `ORG_ROLE_VIEWER` | Org Role Viewer | -160 | false |
| (novo) | **-170** | `PROJECT_USER_LINK` | Vínculo Project-User | -37 | true |
| (novo) | **-171** | `PROJECT_ROLE_MANAGER` | Project Role Manager | -170 | false |
| (novo) | **-172** | `PROJECT_ROLE_MEMBER` | Project Role Member | -170 | false |
| (novo) | **-173** | `PROJECT_ROLE_VIEWER` | Project Role Viewer | -170 | false |
| -460 | **-180** | `TEAM` | Team | -43 | false |
| (novo) | **-181** | `TEAM_USER_LINK` | Vínculo Team-User | -37 | true |
| -400 | -400 | `SPRINT` | Sprint (agrupador) | -51 | true |
| -403 | -403 | `BACKLOG` | Backlog | -400 | false |
| -420 | -420 | `PRIORITY` | Priority (agrupador) | -51 | true |
| -421..-424 | -421..-424 | `HIGH`,`MEDIUM`,`LOW`,`URGENT` | Priorities | -420 | false |
| -430 | -430 | `TASK_TYPE` | Task Type (agrupador) | -51 | true |
| -431..-435 | -431..-435 | `FEATURE`,`BUG`,`IMPROVEMENT`,`REVIEW`,`EXPLAIN` | Task Types | -430 | false |
| -440 | -440 | `STATUS_INTENTION_V3` | Status Intention V3 (agrupador) | -52 | true |
| -441..-449 | -441..-449 | `INBOX`,`READY`,`EXECUTING`,`DONE`,`FAILED`,`CANCELLED`,`DISCARDED`,`VALIDATING`,`VALIDATED` | V3 Statuses | -440 | false |
| -450 | -450 | `CHANNEL` | Canal de Origem (agrupador) | -51 | true |
| -451..-456 | -451..-456 | `WEB`,`WHATSAPP`,`EMAIL`,`SLACK`,`API`,`TELEGRAM` | Channels | -450 | false |
| (novo) | **-470** | `WEBHOOK_OUTBOUND` | Webhook Outbound (DTabela) | -51 | false |
| (novo) | **-475** | `API_KEY_PROJECT` | API Key Projeto (DTabela) | -51 | false |
| (novo) | **-476** | `MCP_KEY_USER` | MCP Key User (DTabela) | -51 | false |
| (novo) | **-480** | `NOTIFICATION` | Notificação (DTabela) | -51 | false |
| (novo) | **-490** | `AGENT_REMOTE` | Agente Remoto (DEntidade) | -43 | false |
| (novo) | **-491** | `EXECUCAO_CLAUDE` | Execução Claude Code (DPedido) | -20 | false |
| (novo) | **-492** | `EXEC_APPROVAL_PENDING` | Status Aprovação Execução (DTabela) | -52 | true |
| (novo) | **-493..-497** | `QUEUED`,`AWAITING_APPROVAL`,`APPROVED`,`REJECTED`,`EXPIRED` | Sub-status execução | -492 | false |
| (novo) | **-499** | `EXEC_RISK_LEVEL` | Risk Level (DTabela: LOW/MEDIUM/HIGH como filhos) | -52 | true |

**Total Fase 1 esperado:** ~57 fixas + ~40 específicas = **~97 classes**.

### Estrutura de arquivos esperada

```
prisma/
├── schema.prisma                            # 17 modelos (vide §17 tabelas) + sem enums
├── seeds/
│   ├── classes.seed.ts                      # spread classesFixas + classesEspecificas
│   ├── seed-runner.ts                       # entrypoint para `prisma db seed`
│   └── validate-hierarchy.ts                # checa idPai existe, sem ciclo, no negativo
└── migrations/
    └── 20260508_initial_canonical/migration.sql

src/
├── classes/
│   └── seeds/
│       └── README.md                        # explica que seed real está em prisma/seeds/

docs/
└── SCHEMA-CANONICO-AUDITORIA.md             # tabela das 17 + campos opt-in
```

### Tarefas detalhadas (lista numerada acionável)

1. **Escrever `prisma/schema.prisma` canônico** com as 17 tabelas. Cópia adaptada do `Scrumbam-Backend/prisma/schema.prisma`, mas:
   - **REMOVER:** `DProjectMember`, `DNotification`, `DWebhook`, `DAgent`, `DExecution`.
   - **REMOVER:** enums `OrgRole` e `ProjectRole` (vão para DClasse -160..-173).
   - **ADICIONAR:** DRecurso, DPedido, DTitulo, DMovDispo, DMovDepos, DSolicita, DRequisic, DVFS (faltavam no template Devari-Core e no legado).
   - **MANTER:** DClasse, DEntidade, DTabela, DVincula, DEvento, DUserGroup, DPermissao, DTask, DProject — todas com campos do canônico + `dados` Json (já existente em algumas) + colunas opt-in conforme ADRs.
   - **ÍNDICES:** `@@index([idClasse])` em toda tabela polimórfica; `@@index([idLocEscritu])` em DEntidade, DTabela, DVincula; `@@index([idEstab])` em DEntidade; `@@index([idEntidade])` em DVincula; `@@index([dEntidadeId])` em DTabela.
2. **Escrever ADRs aditivos da fase** em `docs/DECISIONS.md`:
   - **ADR-201:** "Renumeração de DClasses do legado para faixa -150+ (não sequestrar canônicas)". Status: aprovado.
   - **ADR-202:** "RBAC duplo via DVincula (-160 Org-User, -170 Project-User), eliminando enums OrgRole/ProjectRole". Status: aprovado.
   - **ADR-203:** "API Keys e MCP Keys como DTabela polimórfica, eliminando colunas próprias em DProject/DUserGroup". Status: aprovado.
   - **ADR-204:** "Webhooks Outbound e Notifications como DTabela polimórfica (-470 e -480), eliminando tabelas próprias". Status: aprovado.
   - **ADR-205:** "Agentes Remotos como DEntidade idClasse=-490 + execuções como DPedido idClasse=-491 (Pilar 1 ativado via OperacaoExecucaoClaude)". Status: aprovado.
   - **ADR-206:** "Schema inclui as 17 tabelas mesmo as não-usadas no V2 (DRecurso, DTitulo, DMovDispo, DMovDepos, DSolicita, DRequisic, DVFS) — canonicidade > pragmatismo". Status: aprovado.
3. **Implementar `prisma/seeds/validate-hierarchy.ts`** — função pura que recebe array de classes e valida:
   - Toda chave é negativa.
   - Todo `idPai` existe no array (referência válida).
   - Não há ciclos (DFS com visited).
   - Chaves canônicas reservadas (-40, -45, -47, -49, -50) **NÃO** aparecem entre classes específicas.
   - Throw com mensagem clara em qualquer violação.
4. **Implementar `prisma/seeds/classes.seed.ts`** com:
   - `import { classesFixas } from '../../templates/classes-base-template'`.
   - Array `classesEspecificas` com as ~40 classes da tabela acima.
   - `export const classes = [...classesFixas, ...classesEspecificas]`.
   - Chamada a `validateHierarchy(classes)` antes de qualquer escrita.
5. **Implementar `prisma/seeds/seed-runner.ts`** — script idempotente:
   - Conecta via PrismaClient.
   - `for (const c of classes)` → `prisma.dClasse.upsert({ where: { chave: c.chave }, create: c, update: c })`.
   - Tudo dentro de `prisma.$transaction`.
   - Log final com totais (`✅ Seed: 57 fixas + 40 específicas = 97 classes`).
   - Exit 1 se falha.
6. **Configurar `package.json` `prisma.seed`:** `"prisma": { "seed": "ts-node prisma/seeds/seed-runner.ts" }`.
7. **Gerar primeira migration:** `npx prisma migrate dev --name initial_canonical`. Validar que SQL gerado tem todos os 17 `CREATE TABLE` e todos os índices esperados.
8. **Rodar `npx prisma db seed`** contra docker-compose Postgres. Verificar: `psql ... -c "SELECT count(*) FROM \"DClasse\";"` retorna ≥97.
9. **Smoke test integrado:** `make build && make db:reset && make db:migrate && make seed && curl /api/v1/health` → tudo verde.
10. **Documentar em `docs/SCHEMA-CANONICO-AUDITORIA.md`** as 17 tabelas, suas colunas, e o mapeamento legado→V2 das DClasses (tabela acima).

### Dependências

- Fase 0 concluída (repositório, hooks, .claude/, pastas canônicas).

### Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|---------------|-----------|
| Esquecer alguma DClasse específica do legado e domínio quebrar em fase posterior | Média | Cruzar lista com `Scrumbam-Backend/prisma/seeds/classes.seed.ts`; reviewer compara line-a-line. |
| `validate-hierarchy.ts` ter false negative (deixa passar ciclo) | Baixa | Teste unitário com 4 cenários: árvore válida, ciclo direto, ciclo indireto, idPai inexistente. |
| Migration SQL diferir entre dev e CI por ordem de modelos | Baixa | Prisma é determinístico; commitar `migration.sql` no git. |
| Equipe achar que pode adicionar enum em vez de DClasse "porque é mais rápido" | Alta (cultural) | Hook `enforce-canonical-tables.sh` extendido para bloquear `enum ` no schema. |
| Sequestrar -47/-49/-50 por inércia do legado | Média | `validate-hierarchy.ts` tem allowlist explícita de canônicas reservadas. |

### Definition of Done (checklist)

- [ ] `prisma/schema.prisma` tem exatamente 17 modelos (zero enums, zero tabela própria).
- [ ] Build Prisma client passa: `npx prisma generate`.
- [ ] Migration `20260508_initial_canonical` aplicada sem erro.
- [ ] `prisma db seed` roda com 0 erros e relata ≥97 classes inseridas.
- [ ] Re-rodar `prisma db seed` é idempotente (UPSERT, mesmo total).
- [ ] `validate-hierarchy.ts` tem 4 testes unit passando.
- [ ] Nenhuma DClasse usa chave em [-40, -45, -47, -49, -50, -1..-110 fora das fixas].
- [ ] ADR-201..206 commitados em `docs/DECISIONS.md`.
- [ ] `docs/SCHEMA-CANONICO-AUDITORIA.md` lista as 17 tabelas + mapeamento legado→V2.
- [ ] `make build` PASS.
- [ ] Sem `prisma.dXxx.create()` direto em qualquer arquivo (codebase ainda só tem health + seed-runner — preventivo).
- [ ] Sem `console.log` (eslint).
- [ ] JSDoc em `validate-hierarchy.ts` e `seed-runner.ts`.
- [ ] Conventional Commits respeitado (`feat(seeds): adiciona seed canônico Scrumban V2`).
- [ ] Hook `enforce-canonical-tables.sh` testado contra schema final e passa.
- [ ] Smoke test integrado (build + reset + migrate + seed + health) passa em ≤30s local.

### Tempo estimado

**5-7 dias úteis.**
- Auditoria + ADRs (201..206): 1d
- Schema 17 tabelas + índices: 1,5d
- `validate-hierarchy.ts` + testes: 0,5d
- `classes.seed.ts` específicas (mapeamento legado→V2): 1d
- `seed-runner.ts` + idempotência + transaction: 0,5d
- Migration + smoke test: 0,5d
- Documentação `SCHEMA-CANONICO-AUDITORIA.md`: 0,5d
- Buffer 20%: 1d

### Como validar (smoke test)

```bash
make db:reset                                 # drop + create db
make db:migrate                               # aplica migration
make seed                                     # roda classes.seed.ts
psql $DATABASE_URL -c 'SELECT count(*) FROM "DClasse";'  # esperado: 97+
psql $DATABASE_URL -c "SELECT chave, codigo, nome FROM \"DClasse\" WHERE chave IN (-150, -151, -152, -491) ORDER BY chave DESC;"
# esperado: 4 linhas, codigos USER, PLATFORM_SCRUMBAN, ORGANIZATION, EXECUCAO_CLAUDE

# Idempotência
make seed                                     # roda 2a vez, sem erro, mesmo total

# Hook anti-enum
echo 'enum Test { A B }' >> prisma/schema.prisma
git add prisma/schema.prisma && git commit -m "feat(seeds): tenta enum"  # esperado: BLOCKED
git checkout prisma/schema.prisma

# Anti-tabela-própria (relapso do legado)
sed -i '' 's/model DTask/model DAgent/' prisma/schema.prisma  # mac sed
git add prisma/schema.prisma && git commit -m "feat(seeds): tenta DAgent"  # esperado: BLOCKED
git checkout prisma/schema.prisma
```

---

## FASE 2 — Pilar 2: Endpoints Genéricos (`/entidades`, `/tabelas`, `/classes`)

### Objetivo

Implementar os 3 controllers genéricos canônicos do Devari-Core (`EntidadeController`, `TabelaController`, `ClasseController`) com seus services, DTOs, query parameters canônicos e Swagger completo. Esses endpoints serão **a única forma** de listar/criar/editar Users, Organizations, Teams, Sprints, Statuses, Priorities, Task Types, Channels, API Keys, MCP Keys, Notifications, Webhooks. Nenhum controller próprio para essas entidades — eis a essência do Pilar 2.

A arquitetura ressalta que o legado falhou ao criar `OrganizationsController`, `TeamsController`, `SprintsController`, `WorkflowStatusesController` que duplicam acesso a DEntidade e DTabela. V2 corrige isso desde o nascimento.

### Pilares ativados / respeitados

- **Pilar 2 (PLENO):** 3 controllers genéricos cobrem ~40% das rotas que o legado teria.
- **Pilar 3 (RESPEITADO):** services lêem `idClasse` da query e validam contra `DClasse`.
- **Decisão D7 do consolidado:** controllers thin como SprintController/WorkflowStatusController **ficam para Fase 4 do bloco seguinte** (não nesta fase) — só serão criados se DX justificar (Swagger por classe), e ainda assim usam internamente o EntidadeService/TabelaService.

Refs: `Devari-Core/.claude/rules/devari-3-pilares.md` §Pilar 2, `Devari-Core/.claude/rules/devari-polymorphic-engine.md` §4.

### Padrões obrigatórios aplicados

- #1 PrismaService.
- #2 BigInt em IDs.
- #3 Transactions onde criação de entidade gera DVincula.
- #4 TimezoneService nos filtros `dateFrom`/`dateTo`.
- #5 `EntidadeService.getEntidadeIdFromUserGroup` canônico (mesmo nome do template).
- #6 N+1 ZERO — usar `include`/`select` sempre.
- #9 DTOs com class-validator.
- #10 Guards (provisórios — `JwtAuthGuard` ainda não existe; usa placeholder `@SkipGuard()` decorator que será trocado na Fase 3).
- #11 Logger.
- #12 Controller orquestra, service implementa.
- #13 Service com responsabilidade única.
- #15 Cursor pagination.
- #17 Swagger 100%.

### Tabelas canônicas envolvidas

**DClasse** (leitura), **DEntidade** (CRUD), **DTabela** (CRUD), **DVincula** (criação atômica em createSeller-style helpers), **DEvento** (audit `entity.created`/`entity.updated`).

### DClasses a criar nesta fase

Nenhuma — todas vieram da Fase 1.

### Estrutura de arquivos esperada

```
src/entidades/
├── entidades.module.ts
├── entidades.controller.ts                  # GET/POST/PATCH/DELETE /entidades + rotas especializadas
├── entidades.service.ts                     # ~600L: list, create, update, getEntidadeIdFromUserGroup, createSeller (helper canônico mesmo nome do template)
├── helpers/
│   ├── build-where-clause.ts
│   └── format-entidade-response.ts
├── dto/
│   ├── list-entidade-query.dto.ts          # idClasse, nome, codigo, page, pageSize, cursor, idEstab, dateFrom, dateTo
│   ├── create-entidade.dto.ts
│   ├── update-entidade.dto.ts
│   ├── entidade-response.dto.ts
│   └── list-entidade-response.dto.ts
└── README.md

src/tabelas/
├── tabelas.module.ts
├── tabelas.controller.ts                    # GET/POST/PATCH/DELETE /tabelas
├── tabelas.service.ts
├── helpers/build-where-clause.ts
├── dto/
│   ├── list-tabela-query.dto.ts
│   ├── create-tabela.dto.ts
│   ├── update-tabela.dto.ts
│   ├── tabela-response.dto.ts
│   └── list-tabela-response.dto.ts
└── README.md

src/classes/
├── classes.module.ts
├── classes.controller.ts                    # GET /classes (read-only — DClasse não cria em runtime)
├── classes.service.ts                       # tree builder, search por nome/codigo
├── dto/
│   ├── list-classes-query.dto.ts
│   └── classe-response.dto.ts
└── README.md

src/common/
├── pipes/
│   ├── parse-bigint.pipe.ts
│   └── parse-optional-bigint.pipe.ts
├── decorators/
│   └── skip-guard.decorator.ts              # placeholder Fase 3
└── README.md
```

### Tarefas detalhadas (lista numerada acionável)

1. **Implementar `parse-bigint.pipe.ts`** — converte `string` da query para `bigint`, valida regex `^-?\d+$`.
2. **Implementar `EntidadeService` com método `listarPorClasse(query)`:**
   - Validar `idClasse` existe via `prisma.dClasse.findFirst`.
   - Cursor pagination + `orderBy: { chave: 'desc' }`.
   - `include: { DClasse: { select: { codigo, nome } } }`.
   - Filtros: `nome` (contains, mode insensitive), `codigo`, `idEstab`, `dateFrom`/`dateTo` via TimezoneService (Fase 4 cria; nesta fase placeholder).
   - Soft-delete: `excluido: false`.
3. **Implementar `EntidadeService.criar(dto)`:**
   - Transaction: cria DEntidade + (se classe é -150 USER) cria DUserGroup associado + (se classe é -460 TEAM) cria DVincula -181 com criador como membro.
   - Após persistência: emite `DEvento` `entity.created` (Fase posterior trocará para EventProducerService quando módulo eventos existir).
4. **Implementar `EntidadeService.atualizar(id, dto)`** — UPDATE simples + emite `entity.updated`.
5. **Implementar `EntidadeService.softDelete(id)`** — `excluido: true` + `entity.deleted`.
6. **Implementar `EntidadeService.getEntidadeIdFromUserGroup(userGroupId)`** — método canônico Pattern #5, usado por outros services depois.
7. **Implementar `EntidadeService.createSeller(...)` (helper canônico):** mesmo padrão do template (cria DEntidade -47 + Conta Virtual -40 + DVincula em transaction). NÃO é usado pelo Scrumban V2 hoje, mas é parte do template canônico — aproveita-se que cabe e é exigência D6.
8. **Implementar `EntidadeController`:**
   - `GET /entidades` — query DTO com `idClasse` obrigatório.
   - `GET /entidades/:id`.
   - `POST /entidades`.
   - `PATCH /entidades/:id`.
   - `DELETE /entidades/:id`.
   - Rotas especializadas canônicas: `GET /entidades/fields?classe=X` (retorna `tableFields` da DClasse — útil para UI dinâmica).
   - Swagger completo com `@ApiOperation`, `@ApiQuery`, `@ApiResponse` em cada.
9. **Implementar `TabelaService` espelho do EntidadeService:**
   - `listarPorClasse(query)` com filtros idênticos (idClasse, nome, codigo, idEstab, dateFrom, dateTo, cursor, take).
   - `criar`/`atualizar`/`deletar`.
   - `criarPorClasseE(dEntidadeId, idClasse, dto)` — para configs por entidade (ex.: webhook config de um projeto).
10. **Implementar `TabelaController`** análogo ao EntidadeController.
11. **Implementar `ClassesService`:**
    - `listAll({ all, nome, idPai, search })`.
    - `getTree(rootChave?)` — retorna árvore aninhada (recursão controlada profundidade ≤6).
    - `getFieldsByClasse(idClasse)` — retorna `tableFields` Json.
    - **READ-ONLY**: nada de POST/PATCH/DELETE em runtime (chaves negativas só vêm do seed).
12. **Implementar `ClassesController`:** apenas GETs.
13. **Garantir N+1 ZERO** com testes locais via `DATABASE_LOGGING=true npm run start:dev` e `curl /entidades?idClasse=-150&pageSize=20` — esperado: ≤4 queries.
14. **Swagger 100%:**
    - DTOs com `@ApiProperty`/`@ApiPropertyOptional`.
    - Controllers com `@ApiOperation`, `@ApiQuery`, `@ApiResponse` para 200, 400, 401 (placeholder), 404, 409.
    - JSDoc em todos os métodos públicos seguindo `devari-jsdoc-templates.md`.
15. **Tests unit (per service):**
    - EntidadeService: 8 unit tests (list happy, list 404 classe, list filtros combinados, create transaction, getEntidadeIdFromUserGroup, createSeller transaction, soft-delete, validation error).
    - TabelaService: 6 unit tests.
    - ClassesService: 4 unit tests (tree, fields, search, all).
16. **Smoke test integration:**
    ```bash
    curl 'http://localhost:3000/api/v1/entidades?idClasse=-150&pageSize=10'
    # esperado: { items: [], pagination: { hasMore: false, nextCursor: null } }
    
    curl -X POST -H "Content-Type: application/json" \
      -d '{"idClasse":"-150","nome":"Test User","email":"t@t.com","codigo":"TST"}' \
      http://localhost:3000/api/v1/entidades
    # esperado: 201 com { chave: '...', nome: 'Test User', ... }
    
    curl 'http://localhost:3000/api/v1/tabelas?idClasse=-440'  # statuses
    # esperado: 9 statuses V3
    
    curl 'http://localhost:3000/api/v1/classes?nome=Sprint'
    # esperado: 1+ resultados ({ chave: '-400', codigo: 'SPRINT', ... })
    ```

### Dependências

- Fase 1 (schema + seed).
- Fase 0 (hooks, ESLint).

### Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|---------------|-----------|
| Engineer cria `UsersController` em paralelo "porque é mais simples" | Alta (cultural) | Hook `validate-implementation.sh` checa criação de `*.controller.ts` cujo nome bate com classe que mapeia para DEntidade/DTabela — bloqueia. |
| N+1 em `getTree` recursivo | Alta | Implementar com 1 query `findMany({ where: { excluido: false } })` + montagem em memória, NÃO recursão de queries. |
| `idEstab` não filtra hierarquia corretamente em multi-tenant (Fase 3 implementa OrgTenantGuard) | Média | Documentar gap; testes integration cobrem isolamento depois da Fase 3. |
| Cursor pagination com `orderBy desc` sem index | Baixa | Index `@@index([idClasse, chave])` no schema; validar com EXPLAIN. |
| `createSeller` ficar morto-código no V2 | Baixa | Aceitar — é canonicidade, custo zero deixar disponível para projetos futuros do mesmo repositório. |

### Definition of Done (checklist)

- [ ] `make build` PASS.
- [ ] 3 controllers genéricos respondem 200 a smoke tests acima.
- [ ] Swagger UI em `/api/docs` lista os 3 controllers + métodos com schema completo.
- [ ] `npm run test` — todos unit tests verdes (≥18 specs novos).
- [ ] N+1 verificado com `DATABASE_LOGGING=true` + curl manual: ≤4 queries por listagem.
- [ ] Sem controllers próprios (`UserController.ts`, `OrganizationController.ts`, etc.) — `find src -name "*.controller.ts"` retorna apenas: `entidades`, `tabelas`, `classes`, `health`.
- [ ] DTOs com class-validator + Swagger decorators completos.
- [ ] Cursor pagination respondendo `nextCursor` corretamente.
- [ ] BigInt usado em todas as conversões (sem `parseInt`).
- [ ] Soft-delete (`excluido: false`) em todas as listagens.
- [ ] Logger NestJS em todos services (sem console.log).
- [ ] JSDoc completo em todos os métodos públicos.
- [ ] Conventional Commits.
- [ ] `enforce-canonical-tables.sh` continua passando.
- [ ] Hook anti-controllers-duplicados ativo.

### Tempo estimado

**6-9 dias úteis.**
- EntidadeService + Controller + DTOs + helpers: 2,5d
- TabelaService + Controller: 1,5d
- ClassesService + Controller (tree builder): 1d
- Pipes + decorators common: 0,5d
- Swagger completo: 0,5d
- Tests unit: 1,5d
- Smoke + N+1 verification + tuning: 0,5d
- Buffer 20%: 1-1,5d

### Como validar (smoke test)

```bash
# Lista vazia
curl 'http://localhost:3000/api/v1/entidades?idClasse=-150&pageSize=10' | jq

# Cria
curl -X POST -H "Content-Type: application/json" \
  -d '{"idClasse":"-150","nome":"Roberio Test","email":"roberio@test.com","codigo":"USR-001"}' \
  http://localhost:3000/api/v1/entidades | jq

# Lista de novo (deve aparecer)
curl 'http://localhost:3000/api/v1/entidades?idClasse=-150' | jq '.items | length'  # >=1

# Tabelas (statuses V3)
curl 'http://localhost:3000/api/v1/tabelas?idClasse=-440' | jq '.items[].codigo'

# Classes árvore
curl 'http://localhost:3000/api/v1/classes?nome=Status'

# N+1 check
DATABASE_LOGGING=true npm run start:dev &
sleep 3
curl -s 'http://localhost:3000/api/v1/entidades?idClasse=-150&pageSize=20' > /dev/null
# verificar logs: <= 4 queries

# Hook anti-duplicado (esperado: BLOCKED)
mkdir -p src/users && echo "@Controller('users') export class UsersController {}" > src/users/users.controller.ts
git add src/users && git commit -m "feat(users): tenta duplicar"  # esperado: BLOCKED
rm -rf src/users
```

---

## FASE 3 — Auth + RBAC (DUserGroup + DVincula + DTabela para keys)

### Objetivo

Implementar autenticação JWT + RBAC duplo (Org + Project) usando exclusivamente as 17 tabelas canônicas: `DUserGroup` para credenciais e refresh tokens, `DVincula` para vínculos Org-User e Project-User com role via `idClasse`, `DTabela` para API Keys (`-475`) e MCP Keys (`-476`). Guards canônicos: `JwtAuthGuard`, `AuthCompositeGuard` (JWT OR API Key OR MCP Key), `OrgTenantGuard`, `ProjectScopeGuard`, `RolesGuard`, `TeamRolesGuard`. Módulo `permissoes/` com CRUD de DPermissao para permissões granulares além das 3 cargos.

Esta fase substitui completamente os enums `OrgRole` e `ProjectRole` do legado e a tabela própria `DProjectMember` — que viraram DVincula com `idClasse` apontando para `-161`/`-162`/`-163` (Org) e `-171`/`-172`/`-173` (Project).

### Pilares ativados / respeitados

- **Pilar 2 (RESPEITADO):** auth tem controller próprio (justificado por Decisão D7 — login não cabe em /entidades), mas nada de UserController; usuários continuam em /entidades?idClasse=-150.
- **Pilar 3 (RESPEITADO):** roles vêm do seed (-160..-173).
- **Decisão D4 (consolidado):** API Keys e MCP Keys padronizadas em DTabela.

Refs: `Devari-Core/.claude/rules/devari-backend-patterns.md` §10 (Guards), `Scrumbam-Backend` referência funcional dos guards (`Auth*Guard`, `OrgTenantGuard`, `ProjectScopeGuard`).

### Padrões obrigatórios aplicados

- #1 PrismaService.
- #2 BigInt.
- #3 Transactions (login emite DEvento + atualiza DUserGroup.dados).
- #5 `EntidadeService.getEntidadeIdFromUserGroup` usado em todo lugar.
- #6 N+1 ZERO em validações de role.
- #9 DTOs.
- #10 Guards (todos).
- #11 Logger (login mascara senha; PII protegido).
- #14 Eventos (`auth.login`, `auth.logout`, `auth.failed`).

### Tabelas canônicas envolvidas

| Tabela | Uso |
|--------|-----|
| **DUserGroup** | Credenciais, refresh token hash em `dados` Json, mcp key hash em `dados` Json |
| **DEntidade** (-150) | Perfil do user, `dados` Json com onboardingCompleted, telegramChatId, defaultProjectId, defaultTeamId |
| **DVincula** (-160 ORG_USER_LINK) | idLocEscritu=org, idEntidade=user, idClasse=-161/-162/-163 (role) |
| **DVincula** (-170 PROJECT_USER_LINK) | idLocEscritu=project, idEntidade=user, idClasse=-171/-172/-173 (role) |
| **DTabela** (-475 API_KEY_PROJECT) | dEntidadeId=projectId, `dados.hash` SHA-256 da plaintext key, `dados.prefix`, `dados.lastUsedAt` |
| **DTabela** (-476 MCP_KEY_USER) | dEntidadeId=userId, mesma estrutura (mas o hash também duplicado em DUserGroup.dados.mcpKeyHash para latência de auth) |
| **DPermissao** | Permissões granulares (ex.: `tasks.read`, `automation.execute`) — opcional além dos 3 roles |
| **DEvento** | Audit (`auth.login`, `auth.failed`, `apikey.created`, `apikey.revoked`, `mcpkey.*`) |

### DClasses a criar nesta fase

Nenhuma — Fase 1 já criou (-160..-173, -475, -476).

### Estrutura de arquivos esperada

```
src/auth/
├── auth.module.ts
├── auth.controller.ts                       # POST /auth/login, /register, /refresh, /logout, GET/PATCH/DELETE /me
├── auth.service.ts                          # login (bcrypt compare), register (cria DEntidade+DUserGroup+DVincula em transaction), refresh, logout
├── strategies/
│   └── jwt.strategy.ts                      # passport-jwt
├── guards/
│   ├── jwt-auth.guard.ts
│   ├── api-key.guard.ts                     # valida X-API-Key contra DTabela -475
│   ├── mcp-key.guard.ts                     # valida X-MCP-Key contra DUserGroup.dados.mcpKeyHash + DTabela -476
│   ├── auth-composite.guard.ts              # OR entre os 3 acima
│   ├── org-tenant.guard.ts                  # valida que recurso pertence à org do JWT
│   ├── project-scope.guard.ts               # valida que recurso pertence ao projeto da API Key
│   ├── roles.guard.ts                       # @Roles('ADMIN'|'MEMBER'|'VIEWER')
│   └── team-roles.guard.ts                  # @TeamRoles(...)
├── decorators/
│   ├── current-user.decorator.ts
│   ├── current-org.decorator.ts
│   ├── current-project.decorator.ts
│   ├── roles.decorator.ts
│   ├── tenant-config.decorator.ts           # estratégia: PATH_PARAM, BODY_PROPERTY, QUERY_PARAM, JWT_ONLY
│   └── public.decorator.ts                  # @Public() pula JwtAuthGuard
├── services/
│   ├── api-key.service.ts                   # gera, valida, revoga (SHA-256, crypto nativo)
│   ├── mcp-key.service.ts
│   ├── refresh-token.service.ts             # rotativo, hash em DUserGroup.dados
│   └── role-resolver.service.ts             # resolve role do user em org/project via DVincula
└── dto/
    ├── login.dto.ts
    ├── register.dto.ts
    ├── refresh.dto.ts
    ├── auth-response.dto.ts
    ├── update-me.dto.ts
    ├── api-key-response.dto.ts
    └── mcp-key-response.dto.ts

src/permissoes/
├── permissoes.module.ts
├── permissoes.controller.ts                 # GET/POST/PATCH/DELETE /permissoes (admin only)
├── permissoes.service.ts
└── dto/
    ├── create-permissao.dto.ts
    └── permissao-response.dto.ts
```

### Tarefas detalhadas (lista numerada acionável)

1. **Setup `passport-jwt` + bcrypt:** `passport.use(jwtStrategy)`, secret de env, `expiresIn: 15m` para access token e `7d` para refresh.
2. **Implementar `AuthService.register(dto)`** transação atômica:
   - Cria DUserGroup (idClasse=-46) com `password = bcrypt.hash(dto.password, 12)`.
   - Cria DEntidade (idClasse=-150 USER) com `dUserGroupId = newUserGroup.chave`, `dados.onboardingCompleted = false`.
   - Se `dto.organizationId`: cria DVincula (idClasse=-162 ORG_ROLE_MEMBER, idLocEscritu=org, idEntidade=user.chave). Se NÃO informa org: cria org nova (-152) + DVincula -161 (admin).
   - Emite DEvento `entity.created` para user e (se aplicável) org.
3. **Implementar `AuthService.login(dto)`:**
   - Busca DUserGroup por `usuario`.
   - bcrypt.compare; se falha, emite DEvento `auth.failed`, throw 401.
   - Gera JWT (`{ sub: userGroupId, entidadeId, organizationId }`) + refresh token.
   - Persiste hash do refresh token em `DUserGroup.dados.refreshTokenHash` (rotativo).
   - Emite DEvento `auth.login`.
4. **Implementar `AuthService.refresh(dto)`:**
   - Valida refresh token contra hash em DUserGroup.dados.
   - Rotaciona (gera novo, atualiza hash).
   - Throw 401 se token revogado.
5. **Implementar `AuthService.logout()`:**
   - Limpa refresh hash em DUserGroup.dados.
   - Emite DEvento `auth.logout`.
6. **Implementar `JwtAuthGuard`** padrão NestJS + `@Public()` decorator para bypass.
7. **Implementar `ApiKeyService`:**
   - `generate(projectId, createdBy)`: gera 32 bytes random, SHA-256, salva DTabela -475 com `dados.hash`, `dados.prefix` (8 chars do plaintext), `dEntidadeId = projectId`.
   - `validate(plaintext)`: hash plaintext, lookup em DTabela -475 por hash, retorna `{ projectId, createdAt }` ou null.
   - `revoke(id)`: soft-delete (excluido=true).
8. **Implementar `ApiKeyGuard`** que lê `X-API-Key`, valida via service, anexa `req.project` e `req.authMethod = 'apikey'`.
9. **Implementar `McpKeyService` + `McpKeyGuard`** análogos, em DTabela -476 + duplicado em DUserGroup.dados.mcpKeyHash para latência.
10. **Implementar `AuthCompositeGuard`** que tenta JwtAuthGuard → ApiKeyGuard → McpKeyGuard, retorna 401 só se todos falham.
11. **Implementar `RoleResolverService`:**
    - `getOrgRole(userId, orgId)`: lookup DVincula `where idLocEscritu=orgId AND idEntidade=userId AND idClasse IN (-161,-162,-163)`, retorna ADMIN/MEMBER/VIEWER ou null.
    - `getProjectRole(userId, projectId)`: análogo com -171/-172/-173.
    - Cache em memória (5 min) para evitar query a cada request.
12. **Implementar `OrgTenantGuard`:** lê `req.user.organizationId`, compara com path/body/query conforme `@TenantConfig(strategy)`. Throw 403 se mismatch.
13. **Implementar `ProjectScopeGuard`:** valida `req.project.id` (api-key) ou `RoleResolverService.getProjectRole` (jwt) batem com path param.
14. **Implementar `RolesGuard` + `@Roles(...)`:** consulta `RoleResolverService` e bloqueia conforme allowlist.
15. **Implementar `AuthController`:**
    - `POST /auth/login`, `/auth/register`, `/auth/refresh`, `/auth/logout`.
    - `GET /auth/me` retorna `{ id, entidadeId, name, email, organizationId, organizationName, defaultProjectId, defaultTeamId, onboardingCompleted, role }`.
    - `PATCH /auth/me { name?, email?, defaultProjectId?, defaultTeamId?, onboardingCompleted? }` — atualiza DEntidade.
    - `DELETE /auth/me` — soft-delete user (cascade: DVincula).
    - `POST /auth/me/api-key`, `GET /auth/me/api-key`, `DELETE /auth/me/api-key` — wrappers que chamam ApiKeyService no escopo de projeto default.
    - `POST /auth/me/mcp-key`, `GET`, `DELETE` — análogo.
16. **Implementar rotas de gerenciamento de keys por projeto:**
    - `POST /projects/:id/api-key` (ADMIN), `GET`, `DELETE` — proxy para ApiKeyService.
17. **Implementar `PermissoesService` + `PermissoesController`:**
    - CRUD em DPermissao.
    - `@UseGuards(JwtAuthGuard, RolesGuard) @Roles('ADMIN')` em todos endpoints.
18. **Atualizar `EntidadeController` da Fase 2** para usar guards reais (substituir placeholder `@SkipGuard()` por `@UseGuards(AuthCompositeGuard, OrgTenantGuard)`).
19. **Tests unit:**
    - AuthService: 10 specs (login happy/fail, register, refresh rotation, logout, transaction rollback).
    - ApiKeyService: 5 specs (generate, validate hit/miss, revoke, hash mismatch).
    - RoleResolverService: 4 specs.
    - Guards: 6 specs (composite OR logic, OrgTenant mismatch, etc.).
20. **Tests integration:** smoke E2E de fluxo register → login → /me → criar org → adicionar membro → membro listar → membro deletar (forbidden).

### Dependências

- Fase 2 (EntidadeService.getEntidadeIdFromUserGroup, /entidades operacional, TabelaService).
- Fase 1 (DClasses -160..-173, -475, -476).

### Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|---------------|-----------|
| RoleResolverService introduzir N+1 (1 query por request) | Alta | Cache em memória 5min + index `@@index([idLocEscritu, idEntidade, idClasse, excluido])` em DVincula. |
| API Key hash collision | Desprezível | SHA-256 (256 bits) — espaço suficiente. |
| Refresh token reuse attack (refresh roubado) | Média | Token hash rotativo: cada refresh gera novo hash, antigo invalidado. Detectar reuse → revogar todos os tokens do user. |
| Composite Guard ordem errada (deixar JWT vencer sobre API Key quando API Key foi enviada) | Média | Ordem fixa documentada: MCP > API Key > JWT (mais específico para menos específico). Tests cobrem. |
| Engenheiro tentar adicionar coluna `role` em DUserGroup | Alta (cultural) | ADR-202 explícito; hook bloqueia coluna nova fora de `dados` Json. |

### Definition of Done (checklist)

- [ ] Build PASS.
- [ ] Smoke E2E: register → login → /me → /auth/me/api-key → curl com `X-API-Key` → 200 → revoke → 401.
- [ ] Sem coluna `role` em DUserGroup ou DEntidade.
- [ ] Sem tabela `DProjectMember` ou `DApiKey` própria — usa DVincula e DTabela canônicas.
- [ ] Refresh token rotativo testado (token antigo vira inválido após refresh).
- [ ] N+1 ZERO em /me com DATABASE_LOGGING (≤3 queries).
- [ ] Bcrypt rounds ≥12; senha NUNCA logada.
- [ ] Tests unit ≥25 specs verdes.
- [ ] Tests integration: 1 spec full E2E auth.
- [ ] Swagger completo para todas as rotas.
- [ ] JSDoc em todos os services/guards.
- [ ] Conventional Commits.
- [ ] `enforce-canonical-tables.sh` passa.
- [ ] Hook anti-`console.log`/`prisma.dXxx.create` direto passa.

### Tempo estimado

**8-12 dias úteis.**
- AuthService + register + login + refresh + logout: 2d
- JwtAuthGuard + estratégia + Public decorator: 0,5d
- ApiKeyService + Guard: 1d
- McpKeyService + Guard: 1d
- AuthCompositeGuard: 0,5d
- RoleResolverService + cache + index: 1d
- OrgTenantGuard + ProjectScopeGuard + RolesGuard + decorators: 1,5d
- AuthController + endpoints /me + /api-key + /mcp-key: 1,5d
- PermissoesService + Controller: 1d
- Atualizar guards na Fase 2 controllers: 0,5d
- Tests unit + integration: 1,5d
- Buffer 20%: 1,5-2d

### Como validar (smoke test)

```bash
# Register
curl -X POST -H "Content-Type: application/json" \
  -d '{"name":"Roberio","email":"r@t.com","password":"Senha123!","organizationName":"Org Test"}' \
  http://localhost:3000/api/v1/auth/register | jq

# Login
TOKEN=$(curl -s -X POST -H "Content-Type: application/json" \
  -d '{"email":"r@t.com","password":"Senha123!"}' \
  http://localhost:3000/api/v1/auth/login | jq -r .accessToken)

# Me
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/v1/auth/me | jq
# esperado: { id, organizationId, role: 'ADMIN', ... }

# Cria projeto (Fase posterior — placeholder)
PROJECT_ID=...

# Gera API Key (rota especializada — chama ApiKeyService internamente, salva DTabela -475)
KEY=$(curl -s -X POST -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/projects/$PROJECT_ID/api-key | jq -r .key)

# Usa API Key
curl -H "X-API-Key: $KEY" http://localhost:3000/api/v1/entidades?idClasse=-150
# esperado: 200 (composite guard aceita)

# Revoga
curl -X DELETE -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/v1/projects/$PROJECT_ID/api-key

# Tenta de novo (esperado: 401)
curl -i -H "X-API-Key: $KEY" http://localhost:3000/api/v1/entidades?idClasse=-150 | head -1

# Cross-org (esperado: 403)
curl -H "Authorization: Bearer $TOKEN_DE_OUTRA_ORG" \
  http://localhost:3000/api/v1/entidades?idClasse=-150&idEstab=$ORG_DA_VITIMA
```

---

## FASE 4 — Module `email/` + Common Services

### Objetivo

Fechar a fundação plugando os utilitários canônicos transversais que TODA fase posterior vai consumir: módulo `email/` (provider abstration SMTP/SendGrid/Resend, template engine, queue de envio), `TimezoneService` (America/Sao_Paulo, canônico), pipes/utils de BigInt e CPF/CNPJ, Logger configurado para produção (Pino), Health check completo (DB+Redis), e estrutura mínima de `common/` que outras fases vão estender (StatusModule canônico, AuditService stub, CorrelationIdMiddleware).

Ao final da Fase 4, o repositório está pronto para o estrategista do bloco "Engine + Domínio" começar a implementar OperacaoExecucaoClaude, DProject CRUD com agentLink, DTask V3 — porque tudo o que precisa de "abaixo" (auth, DTOs base, idClasse system, common services) existe e está disciplinado.

### Pilares ativados / respeitados

- **Pilar 2 (RESPEITADO):** email tem o seu próprio módulo (não é entidade); justificado por D8 (Groq/email são integrações).
- **Pilar 3 (PARCIAL):** `TimezoneService` é canônico — usado por Fase 5+ em filtros de data.

Refs: `Devari-Core/.claude/rules/devari-backend-patterns.md` §4 (Timezone), §11 (Logger), §15 (Performance).

### Padrões obrigatórios aplicados

- #4 TimezoneService.
- #11 Logger Pino estruturado.
- #14 Eventos `email.sent`, `email.failed`.
- #18 Imports organizados.

### Tabelas canônicas envolvidas

- **DTabela** (-480 NOTIFICATION) — emails enviados podem virar notificações persistidas (opcional, decidido caso a caso).
- **DEvento** — audit `email.sent`/`email.failed`.

### DClasses a criar nesta fase

Nenhuma — todas vieram da Fase 1.

### Estrutura de arquivos esperada

```
src/email/
├── email.module.ts
├── email.service.ts                         # interface + delega ao provider configurado
├── providers/
│   ├── smtp.provider.ts                     # nodemailer
│   ├── sendgrid.provider.ts                 # @sendgrid/mail
│   ├── resend.provider.ts                   # resend SDK
│   └── email-provider.interface.ts
├── templates/
│   ├── welcome.template.ts                  # função (data) => { subject, html, text }
│   ├── password-reset.template.ts
│   ├── invite.template.ts
│   └── notification-digest.template.ts
├── dto/
│   ├── send-email.dto.ts
│   └── email-response.dto.ts
├── queue/
│   └── email.queue.ts                       # BullMQ queue 'emails' (opcional Fase 4 stub)
└── README.md

src/common/
├── services/
│   ├── timezone.service.ts                  # canônico America/Sao_Paulo
│   ├── correlation-id.service.ts            # AsyncLocalStorage para request id
│   └── audit.service.ts                     # stub: emite DEvento padrão (fim da fase)
├── pipes/
│   ├── parse-bigint.pipe.ts                 # já criado Fase 2
│   └── parse-optional-bigint.pipe.ts
├── utils/
│   ├── clean-cpf-cnpj.util.ts
│   ├── validate-cpf.util.ts
│   ├── validate-cnpj.util.ts
│   └── hash.util.ts                         # SHA-256, bcrypt wrappers
├── middlewares/
│   └── correlation-id.middleware.ts
├── filters/
│   └── http-exception.filter.ts             # padroniza response error (com correlationId)
├── interceptors/
│   └── logging.interceptor.ts               # log estruturado por request
├── health/
│   ├── health.controller.ts                 # GET /health (já existe Fase 0, expandir)
│   ├── health.service.ts                    # checa DB + Redis + email provider
│   └── README.md
└── README.md
```

### Tarefas detalhadas (lista numerada acionável)

1. **Implementar `TimezoneService`** com métodos canônicos do template:
   - `applyDateFilters(from, to)` retornando `{ gte, lte }` em America/Sao_Paulo.
   - `toStartOfDayBrazil(date)`, `toEndOfDayBrazil(date)`.
   - `getPeriodDates('today'|'week'|'month'|'lastMonth')`.
   - Usa biblioteca `date-fns-tz`.
   - JSDoc com exemplos.
2. **Implementar pipes:**
   - `ParseBigIntPipe` (já em Fase 2 — completar com `transform()` e validação regex).
   - `ParseOptionalBigIntPipe`.
3. **Implementar utils:**
   - `cleanCpfCnpj(input)` — remove pontos/traços/barras.
   - `validateCpf(cpf)` / `validateCnpj(cnpj)` — algoritmo de dígito verificador.
   - `hashSha256(input)`, `hashBcrypt(input, rounds)`, `compareBcrypt(plain, hash)`.
4. **Implementar `CorrelationIdMiddleware`:**
   - Lê `X-Correlation-Id` ou gera UUID v4.
   - Salva em AsyncLocalStorage.
   - Anexa em `req.correlationId`.
   - Logger interceptor inclui em todo log.
5. **Implementar `LoggingInterceptor`** que loga `{ method, path, statusCode, durationMs, correlationId, userId? }` em cada request.
6. **Implementar `HttpExceptionFilter`** que padroniza error response:
   ```json
   { "statusCode": 404, "message": "...", "correlationId": "...", "timestamp": "..." }
   ```
7. **Implementar `EmailProviderInterface`:**
   ```typescript
   interface EmailProvider {
     send(input: { to: string; subject: string; html: string; text?: string; from?: string }): Promise<{ id: string; provider: string }>;
   }
   ```
8. **Implementar 3 providers:**
   - `SmtpProvider` (nodemailer) — default para dev.
   - `SendgridProvider` — para prod.
   - `ResendProvider` — alternativa moderna.
9. **Implementar `EmailService`:**
   - `send(dto)`: escolhe provider via config, chama `provider.send()`, emite DEvento `email.sent`/`email.failed`, opcionalmente cria DTabela -480 (notification).
   - `sendTemplate(name, data, to)`: carrega template, renderiza, chama `send`.
10. **Implementar 4 templates** (welcome, password-reset, invite, notification-digest) como funções TypeScript puras retornando `{ subject, html, text }`. Sem motor externo (Handlebars/EJS) na Fase 4 — apenas template literals.
11. **Implementar `HealthService`:**
    - Checa DB (`SELECT 1`).
    - Checa Redis (`PING`).
    - Checa email provider (envia para `/dev/null` se SMTP local; no-op em prod).
    - Retorna `{ status: 'ok'|'degraded', checks: { db, redis, email } }`.
12. **Atualizar `HealthController` da Fase 0** com novos checks.
13. **Implementar `AuditService` (stub):**
    - `log(eventType, entityId, metadata, userId?)` que emite DEvento canônico.
    - Será substituído por `EventProducerService` em fase posterior — esta é a versão MVP em fila síncrona.
14. **Setup Pino logger:**
    - `app.useLogger(new Logger())` substituído por Pino integrado.
    - Formato JSON em prod, pretty em dev.
    - Inclui correlationId em todo log.
15. **Tests unit:**
    - TimezoneService: 6 specs (cobrir todos os métodos + edge cases DST).
    - validateCpf/validateCnpj: 8 specs (válido, inválido, formatado, vazio, etc.).
    - EmailService: 4 specs (send happy, fail provider, template rendering, audit emit).
    - HealthService: 3 specs.
    - HttpExceptionFilter: 2 specs.
16. **Smoke test:**
    ```bash
    curl http://localhost:3000/api/v1/health  # esperado: { status: 'ok', checks: { db: 'ok', redis: 'ok', email: 'ok' } }
    
    # Emite email de teste (rota dev only)
    curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" \
      -d '{"to":"r@t.com","template":"welcome","data":{"name":"Test"}}' \
      http://localhost:3000/api/v1/email/test
    # esperado: 200 { id, provider: 'smtp' }
    
    # CorrelationId
    curl -H "X-Correlation-Id: my-test-123" http://localhost:3000/api/v1/health -i | grep correlation
    # esperado: header X-Correlation-Id: my-test-123 ecoado
    ```

### Dependências

- Fase 0, 1, 2, 3.

### Riscos e mitigações

| Risco | Probabilidade | Mitigação |
|-------|---------------|-----------|
| `TimezoneService` ter bug em DST (Brasil aboliu DST mas pode voltar) | Baixa | Usar `date-fns-tz` que abstrai timezone; testes cobrem 1 caso de transição histórica. |
| Email provider em dev quebrar build em CI (sem SMTP) | Média | Provider `SmtpProvider` aceita `MOCK=true` que loga em vez de enviar. |
| Pino logger conflitar com Logger NestJS | Baixa | Adapter padrão `nestjs-pino`; testes cobrem. |
| AuditService criar N+1 ao logar (1 INSERT por evento + emit) | Média | INSERT direto no Audit; queue só na fase Eventos. |
| CorrelationIdMiddleware vazar entre requests (race) | Média | AsyncLocalStorage por request — testes cobrem 100 requests paralelos. |

### Definition of Done (checklist)

- [ ] Build PASS.
- [ ] `GET /health` retorna `checks: { db, redis, email }` com status verdadeiro.
- [ ] CorrelationId presente em todo log + ecoado no header.
- [ ] Email enviado em dev via SMTP local (MailHog ou similar) chega.
- [ ] TimezoneService usado em ≥1 lugar da Fase 2 (filtros dateFrom/dateTo) e funcionando.
- [ ] Tests unit ≥23 specs novos.
- [ ] JSDoc em todos os services/utils.
- [ ] Pino logger emitindo JSON em prod / pretty em dev.
- [ ] HttpExceptionFilter padronizando responses 4xx/5xx com correlationId.
- [ ] Sem console.log.
- [ ] Conventional Commits.
- [ ] `enforce-canonical-tables.sh` passa.
- [ ] Doc `docs/email-providers.md` explicando como configurar SMTP/SendGrid/Resend.

### Tempo estimado

**5-7 dias úteis.**
- TimezoneService + tests: 1d
- Pipes + utils CPF/CNPJ + tests: 0,5d
- CorrelationIdMiddleware + LoggingInterceptor: 0,5d
- HttpExceptionFilter: 0,5d
- EmailModule + 3 providers + 4 templates: 1,5d
- HealthService expandido: 0,5d
- AuditService stub: 0,5d
- Pino logger setup: 0,5d
- Tests + smoke: 0,5d
- Buffer 20%: 1d

### Como validar (smoke test)

```bash
# Health completo
curl http://localhost:3000/api/v1/health | jq
# { "status": "ok", "checks": { "db": { "status": "ok", "latencyMs": 2 }, "redis": ..., "email": ... } }

# Email
docker run -p 1025:1025 -p 8025:8025 mailhog/mailhog &  # SMTP de dev
sleep 2
curl -X POST -H "Authorization: Bearer $ADMIN_TOKEN" -H "Content-Type: application/json" \
  -d '{"to":"test@example.com","subject":"Hello","html":"<h1>Test</h1>"}' \
  http://localhost:3000/api/v1/email/send-raw
# esperado: 200 { id, provider: 'smtp' }
# Visitar http://localhost:8025 para ver email no MailHog

# Timezone
curl 'http://localhost:3000/api/v1/entidades?idClasse=-150&dateFrom=2026-05-01&dateTo=2026-05-08' | jq
# esperado: filtros aplicados em America/Sao_Paulo (não UTC)

# CorrelationId
RESP=$(curl -i http://localhost:3000/api/v1/health 2>&1)
echo "$RESP" | grep -i correlation
# esperado: X-Correlation-Id: <uuid v4>

# Forçar erro
curl -i http://localhost:3000/api/v1/entidades/999999999999 2>&1 | head -10
# esperado: 404 com payload { statusCode: 404, message: '...', correlationId: '...', timestamp: '...' }

# Tests
npm run test
# esperado: ≥80 specs verdes (somando das 5 fases)
```

---

## RESUMO EXECUTIVO DO BLOCO FUNDAÇÃO

| Fase | Foco | Tempo (dias) | Pilares ativos | Saída |
|------|------|--------------|----------------|-------|
| 0 | Setup + hooks | 3-5 | infra | Repositório vazio funcional, hooks fiscalizando |
| 1 | Schema + seed | 5-7 | Pilar 3 (PLENO) | 17 tabelas + 97 DClasses + ADRs 200-206 |
| 2 | Endpoints genéricos | 6-9 | Pilar 2 (PLENO) | /entidades, /tabelas, /classes operando |
| 3 | Auth + RBAC | 8-12 | Pilar 2/3 (RESPEITADOS) | JWT, API/MCP Keys, OrgTenantGuard, ProjectScopeGuard, RBAC duplo via DVincula |
| 4 | Email + Common | 5-7 | infra | TimezoneService, EmailModule, Logger Pino, Health, AuditService stub |
| **TOTAL** | **5 fases** | **27-40 dias** | **3 Pilares preparados** | **Fundação canônica + auth + transversais** |

**Tempo total:** ~5,5 a 8 semanas com 1 engenheiro full-time + Strategist disponível em retas finais. Recomendo trabalhar em paralelo com o estrategista do bloco 02 (Engine + Domínio) a partir do final da Fase 1 para reduzir risco de bloqueio.

---

## CONTRATO DE HANDOFF PARA O BLOCO 02

Quando este sub-plano fechar (FIM da Fase 4), o próximo estrategista (Engine + Domínio Scrumban) recebe:

1. Repositório com todas as 10 pastas canônicas em `src/`, hooks ativos, build PASS.
2. Schema canônico das 17 tabelas com migrations versionadas.
3. Seed de DClasses idempotente com 97 classes (57 fixas + 40 específicas Scrumban range -150..-499).
4. Endpoints genéricos `/entidades`, `/tabelas`, `/classes` operacionais com guards reais.
5. Auth completo: register/login/refresh/logout, /me, /api-key, /mcp-key, OrgTenantGuard, ProjectScopeGuard, RoleResolverService.
6. RBAC duplo via DVincula -160..-173 (sem enums OrgRole/ProjectRole, sem DProjectMember).
7. API Keys (-475) e MCP Keys (-476) em DTabela polimórfica.
8. Common: TimezoneService, EmailModule (3 providers), Pino logger, CorrelationId, HttpExceptionFilter.
9. ADRs 200-206 aprovados.
10. ~80 unit tests + 1 integration E2E de auth.

A partir daqui, o bloco 02 implementa: `OperacaoExecucaoClaude` (Engine — Pilar 1 ativado), DProject CRUD com agentLink em `dados` Json, DTask V3 (intentions INBOX→READY→...→DONE), Teams via DEntidade -180 + DVincula -181, Webhooks Outbound em DTabela -470 com HMAC, Notifications em DTabela -480, Sprints em DTabela -400, Workflow Statuses V3 em DTabela -440.

---

**Fim do sub-plano 01. Documento versionado e pronto para revisão pelo CEO + estrategistas paralelos.**

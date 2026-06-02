# HANDOFF — Correção FK DTabela.dEntidadeId↔DProject (ADR-V2-058/059)

**Data:** 2026-06-02
**Branch:** `feature/integracao-frontend-v2-hierarquia`
**Estado no remoto:** tudo commitado e enviado (HEAD = `14e9f7e`)
**Para retomar em outra máquina:** `git pull` nesta branch e ler este documento.

---

## 1. O PROBLEMA (resumo de uma linha)

Criar projeto do tipo LIST dava **erro 500** (`Foreign key constraint violated:
DTabela_dEntidadeId_fkey`). Causa-raiz: `DTabela.dEntidadeId` é FK para
`DEntidade.chave`, mas o código gravava `DProject.chave` (P) ali. É a **mesma
classe de bug do ADR-V2-058** (que já resolveu isso em DVincula), numa **FK irmã**
(DTabela) que aquele ADR não cobriu.

**Solução adotada (Abordagem A):** usar o handle canônico = DEntidade-espelho
`-158 PROJECT_REF` (E) via `ProjectRefService`, ponta a ponta (escrita grava E,
leitura resolve P→E legacy-safe, read-back expõe P externamente). ZERO tabela/
coluna/DClasse nova. Plano completo em
`workspace/plans/plan-core-dtabela-dproject-fk-fix-task1.md`.

---

## 2. O QUE JÁ FOI FEITO (commitado e no remoto)

| Passo | Escopo | Commit | Reviewer |
|-------|--------|--------|----------|
| **1-2** | statuses/sprint/priorities — escrita (`projects.service`/`seed-bootstrap`) + leitura (`tasks.service`) + endpoint genérico `/tabelas` (resolve P→E só para idClasses project-scoped) | `0c68dbb` | fast-fix |
| **3** | API Keys | — | **PULADO** (ver §4) |
| **4** | webhooks — escrita/leitura/read-back + guard de segurança + processor + redrive + specs | `5e20394` | **APPROVED 8.2/10** |
| **5** | backfill `backfill-project-ref-dtabelas.ts` + runbook (corrige DADOS legados P→E) | `6336e28` | **APPROVED 9.0/10** |
| — | memórias dos agentes | `1c51a2e`, `14e9f7e` | — |

**Validação de tudo que foi commitado:** build de produção OK, TypeScript 0 erros
em código de produção, ESLint limpo, `jest src/webhooks` 9 suites / 29 testes
verdes, `jest src/tabelas`/`src/projects` verdes (exceto 2 testes de paginação
pré-existentes do ADR-V2-058 Fase 2 — ver §5).

---

## 3. O QUE FALTA (próximos passos)

### 3a. EXECUTAR O BACKFILL em produção (passo 5b) — RESPONSABILIDADE DO CEO
O script (`prisma/scripts/backfill-project-ref-dtabelas.ts`) corrige os projetos
LEGADOS (criados antes do fix), cujos statuses/sprint/priorities/webhooks ainda
têm `dEntidadeId = P`. **Não foi executado** — o banco dev local está OFFLINE.

Seguir o runbook `docs/runbook-backfill-project-ref-dtabelas.md`:
1. **Backup** do banco (pg_dump das tabelas afetadas — ver runbook §2)
2. **Dry-run** (NÃO escreve nada):
   ```bash
   npx ts-node prisma/scripts/backfill-project-ref-dtabelas.ts
   ```
3. **Revisar** o relatório — em especial a seção de **suspeitos** (colisão
   histórica; o script NÃO repara esses, requer decisão manual)
4. (Recomendado) rodar antes o backfill de DVincula, se ainda não rodou:
   `npx ts-node prisma/scripts/backfill-project-ref-entidades.ts --apply`
5. **Aplicar** (escreve):
   ```bash
   npx ts-node prisma/scripts/backfill-project-ref-dtabelas.ts --apply
   ```
6. **Validar** com as queries do runbook §6 (confirmar que -471/-472/-475 ficaram
   intactos)
7. **Rollback** disponível via `pg_restore` (runbook §7)

> Importante: projetos legados **continuam funcionando sem o backfill** (o
> resolver é legacy-safe: enquanto não há espelho, lê/grava P). O backfill é o
> que "canoniza" tudo para E — necessário antes que E≠P possa causar divergência.

### 3b. ADR-V2-059 formal (passo 6) — PENDENTE
Documento de decisão arquitetural que ratifica formalmente a Abordagem A. O
esqueleto já está pronto na seção 9 do plano
(`workspace/plans/plan-core-dtabela-dproject-fk-fix-task1.md`). Falta criar
`docs/decisions/ADR-V2-059-*.md` a partir dele. Baixo risco (só documentação).

### 3c. Validar no banco que criar projeto/quadro funciona — RECOMENDADO
Subir o backend contra o banco e:
- Criar uma LIST → não deve dar mais 500
- Abrir o quadro → colunas (INBOX/READY/...), prioridades e Sprint 1 devem aparecer
- (Se usar) criar/listar um webhook → não deve dar 500

---

## 4. DECISÃO IMPORTANTE: por que o passo 3 (API Keys) foi PULADO

O plano do Strategist assumia que API Keys eram project-scoped (teriam o mesmo
bug). **O código real mostrou o contrário:** `auth.controller.ts` grava
`dEntidadeId = user.entidadeId` (o USUÁRIO, que É uma DEntidade real) — a FK é
satisfeita, **não há bug**. Há um comentário `placeholder até F5` indicando que
no futuro pode virar project-scoped; **se** isso acontecer, o passo 3 reaparece.
Por ora, pular foi a decisão correta (evita esforço à toa).

Lição: validar cada passo contra o código real antes de implementar — o plano no
papel nem sempre bate com a realidade.

---

## 5. DÍVIDAS CONHECIDAS (não-bloqueantes)

- **2 testes vermelhos em `projects.service.spec.ts`** (cursor/paginação em
  `findMany`): são dívida PRÉ-EXISTENTE do ADR-V2-058 Fase 2, não regressão deste
  trabalho. Consertei 46/48; os 2 restantes exigem entrar na lógica completa de
  paginação. Não bloqueiam build nem produção.
- **~20 erros tsc baseline** em `*.spec.ts` de outros módulos
  (tenant-isolation.adversarial, agents-*, execution-*, ttl-cache,
  notification.consumer, approval-flow.unit, executions.unit) — pré-existentes,
  documentados na memória do implementer.
- **Issue M1 (webhooks)** — JÁ CORRIGIDO no commit `5e20394` (`listAttempts`
  expunha E em vez de P).

---

## 6. ARQUIVOS-CHAVE (mapa rápido)

| Arquivo | Papel |
|---------|-------|
| `src/projects/project-ref.service.ts` | **Infra central** (NÃO reescrever). `ensureEntidadeRef`/`ensureEntidadeRefById` (escrita E), `resolveEntidadeRef` (leitura P→E legacy-safe), `resolveProjectId` (read-back E→P), + batch. Cache LRU dual. |
| `src/projects/projects.service.ts` | criar projeto → seed usa `refId` (E) |
| `src/projects/seed-bootstrap.service.ts` | grava statuses/sprint/priorities com handle |
| `src/tasks/tasks.service.ts` | leitura de status/priority resolve P→E |
| `src/tabelas/tabelas.service.ts` | endpoint genérico `/tabelas` resolve P→E só p/ project-scoped |
| `src/webhooks/**` | passo 4 — escrita/leitura/read-back/guard |
| `prisma/scripts/backfill-project-ref-dtabelas.ts` | passo 5 — backfill dados legados |
| `prisma/scripts/backfill-project-ref-entidades.ts` | backfill de DVincula (Fase 3, referência) |
| `docs/runbook-backfill-project-ref-dtabelas.md` | runbook de cutover do backfill |
| `workspace/plans/plan-core-dtabela-dproject-fk-fix-task1.md` | plano macro completo + esqueleto ADR-V2-059 |

---

## 7. CONCEITO-CHAVE (para retomar o raciocínio)

- **P** = `DProject.chave` (id do projeto).
- **E** = `DEntidade.chave` da espelho `-158 PROJECT_REF` (o "crachá" do projeto).
- FKs que exigem `DEntidade.chave` (DVincula, DTabela.dEntidadeId) **precisam de E**,
  nunca P. Antes do fix, gravava-se P → FK quebrava (ou colidia por acaso).
- **Regra de ouro:** escrita grava E; leitura resolve P→E (legacy-safe); o que é
  exposto ao mundo externo (frontend/MCP/webhook payload) volta a ser P via
  `resolveProjectId`. NUNCA gravar P cru num campo cuja FK é DEntidade.
- **Escopo:** SÓ classes project-scoped. `dEntidadeId` user-scoped (API/MCP keys,
  userId) e team-scoped (ISSUE_COUNTER -475, teamId) já são DEntidade real — NÃO
  tocar.

---

**Próxima sessão:** `git pull`, ler este arquivo, decidir entre (3a) rodar o
backfill, (3b) escrever o ADR-V2-059, ou (3c) validar no banco. Nenhum bloqueia
o outro.

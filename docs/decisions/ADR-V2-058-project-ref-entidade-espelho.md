# ADR-V2-058: DEntidade-espelho (-158 PROJECT_REF) como handle canônico do projeto em DVincula

**Status:** Aceito (ratificado pelo CEO Benedito em 2026-06-02)
**Data:** 2026-06-02
**Decisores:** Strategist Agent V2 (proposta) + CEO Benedito (ratificação)
**Tags:** #V2 #pós-F5 #core #estrutural #dvincula #dproject #rbac
**ADRs vinculados:** preserva ADR-V2-001 (zero tabela nova); suplanta parcialmente ADR-V2-003, ADR-V2-029 (PROJECT_TEAM_LINK) e ADR-V2-FOLDERS-001 no que tange ao **handle de projeto** em DVincula.

---

## Contexto e Problema

`POST /api/v1/projects` retornou **500 em produção** (2026-06-02, userId=2):

```
Foreign key constraint violated: `DVincula_idLocEscritu_fkey (index)`
```

Stack: `ProjectMembersService.createManagerLink` → `ProjectsService.create` (dentro de `$transaction`).

### Causa-raiz (confirmada contra `prisma/schema.prisma`)

- `DEntidade.chave` — `BigInt @id @default(autoincrement())` → **sequência própria**.
- `DProject.chave` — `BigInt @id @default(autoincrement())` → **sequência própria e separada**.
- `DVincula`:
  - `idLocEscritu` → **FK obrigatória para `DEntidade.chave`** (relation `VinculaLocEscritu`).
  - `idEntidade` → **FK opcional, também para `DEntidade.chave`** (relation `VinculaEntidade`).

No modelo canônico Devari-Core, o **dono do vínculo (`idLocEscritu`) é SEMPRE uma DEntidade** (regra universal — `devari-polymorphic-engine.md §6` "DVincula como Hub"). Todos os exemplos canônicos (Dinpayz: seller, sócio, conta) usam DEntidade nos dois lados. **O canônico nunca coloca uma tabela não-DEntidade (como DProject) dentro de DVincula.**

O V2 violou esse invariante em **quatro famílias de vínculo** — todas gravam `DProject.chave` num campo cuja FK aponta para `DEntidade.chave`:

| Vínculo | idClasse | Campo com `DProject.chave` | ADR de origem |
|---------|----------|----------------------------|---------------|
| RBAC Project MANAGER/MEMBER/VIEWER | -171 / -172 / -173 | `idLocEscritu = projectId` | ADR-V2-003 |
| PROJECT_TEAM_LINK | -182 | `idEntidade = projectId` (`idLocEscritu = teamId`, este SIM é DEntidade -180) | ADR-V2-029 |
| FOLDER_PROJECT_LINK | -183 | `idEntidade = projectId` (`idLocEscritu = folderId`, este SIM é DEntidade -155) | ADR-V2-FOLDERS-001 |
| SPACE_PRIVATE_MEMBER | -188 | `idLocEscritu = projectId` (Space é DProject) | ADR-V2-051 (§privado) |

### Por que "funcionava às vezes" — o dano silencioso

Quando as sequências de `DEntidade` e `DProject` por acaso produziam o **mesmo número**, a FK encontrava *uma* linha em `DEntidade` e passava — mas apontando para uma DEntidade **aleatória** (um usuário, uma org, um team). Isso é **pior que o 500**: o vínculo fica silenciosamente errado — bug de dados **e de segurança** (RBAC apontando para entidade errada). Em userId=2 a colisão deixou de existir, a FK quebrou, e o 500 expôs o problema honestamente.

**Diferença RBAC vs TEAM/FOLDER:** no RBAC (-171/-173) e SPACE (-188) o dono (`idLocEscritu`) é o projeto — é o lado que quebra primeiro (foi o `idLocEscritu_fkey` no stack). Em TEAM (-182) e FOLDER (-183) o dono é DEntidade real (team/folder) e o projeto está em `idEntidade` (nullable) — esse FK também aponta para DEntidade e está igualmente quebrado/colidindo, só que ainda não estourou para todos os registros.

### Restrições de governança

- **ADR-V2-001 (inviolável):** zero tabela nova fora das 17 canônicas.
- **CEO vetou afrouxar/remover a FK** — fere o Devari-Core e apenas adia o bug silencioso de colisão.

---

## Alternativas Consideradas

### Opção A — Afrouxar / remover a FK de DVincula

**Descrição:** tornar `idLocEscritu`/`idEntidade` FKs não-obrigatórias ou removê-las.

**Prós:**
- Resolve o 500 imediatamente, sem código novo.

**Contras:**
- Fere o canônico Devari-Core (a FK é estrutural no template).
- **Não resolve nada** — a colisão de IDs continua possível, virando bug silencioso de dados/segurança (vínculo apontando para DEntidade aleatória), agora sem nem o 500 para sinalizar.

**Status:** ❌ REJEITADA pelo CEO.

---

### Opção B — Vínculos de projeto apontam para a ORG (DEntidade real) + projectId em `referencia`/`metaDados`

**Descrição:** `idLocEscritu = orgId` (DEntidade -152, real) e o projeto vira um predicado em `referencia`/`metaDados`.

**Prós:**
- Zero entidade nova por projeto; nenhuma migration de criação de espelho.

**Contras:**
- Muda a **semântica de TODAS as queries** project-scoped (~30+ call sites em ~12 arquivos): `RoleResolver.getProjectRole`, `ProjectMembersService`, folders, team-link, executions, webhook-owner-guard, approval-flow deixam de filtrar por `idLocEscritu = projectId` e passam a `idLocEscritu = orgId AND referencia = projectId`.
- **Perda de unicidade/índice:** o filtro forte deixa de ser uma FK indexada e vira string em `metaDados`/`referencia` (pior performance e clareza).
- Dois projetos da mesma org compartilham `idLocEscritu` → toda query precisa do segundo predicado, fácil de esquecer e re-introduzir **vazamento entre projetos**.
- Não generaliza para -188 (Space privado é DProject sem org-scope óbvio em todos os casos).

**Status:** ❌ REJEITADA (risco de regressão de segurança alto).

---

### Opção C — DEntidade-espelho do DProject (`-158 PROJECT_REF`), 1:1, criada na mesma transação [ESCOLHIDA]

**Descrição:** cada `DProject` ganha uma **DEntidade-espelho** de `idClasse = -158 PROJECT_REF` (nova DClasse, filha de -37 ENTIDADES). Essa entidade-espelho é o **handle canônico do projeto dentro do grafo DVincula**. Todos os vínculos project-scoped passam a apontar para a chave da **entidade-espelho** (`E`), nunca para `DProject.chave` (`P`).

```
DProject (chave=P, idClasse de Space/Folder/List)
   └── dados.entidadeRefId = E          (ponteiro forward P→E)
DEntidade (chave=E, idClasse=-158 PROJECT_REF)
   ├── idEstab           = project.idEstab   (mesma org — coerência de tenant)
   ├── nome              = project.nome       (espelhado p/ debug; fonte de verdade continua DProject)
   └── dados.projectId   = P                  (ponteiro reverso E→P)
```

Mapeamento dos vínculos (todos passam a usar `E`):

| Vínculo | Antes (quebrado) | Depois (canônico) |
|---------|------------------|-------------------|
| RBAC -171/-172/-173 | `idLocEscritu = P` | `idLocEscritu = E` |
| SPACE_PRIVATE -188 | `idLocEscritu = P` | `idLocEscritu = E` |
| PROJECT_TEAM_LINK -182 | `idEntidade = P` | `idEntidade = E` |
| FOLDER_PROJECT_LINK -183 | `idEntidade = P` | `idEntidade = E` |

**Prós:**
- ✅ Alinha 100% ao canônico ("tudo em DVincula é DEntidade") — elimina a anomalia em vez de mascará-la.
- ✅ Mantém **ADR-V2-001 intacto** — DEntidade é canônica; PROJECT_REF é só uma DClasse nova (Pilar 3). Zero tabela, zero coluna nova obrigatória (usa `dados` Json existente para o ponteiro).
- ✅ **Mata a colisão na raiz** — a FK passa a ser estruturalmente verdadeira; nunca mais "passa por coincidência".
- ✅ Resolve os 4 vínculos com **uma única mudança de conceito** (vs. Opção B, que muda a semântica de cada query individualmente).
- ✅ **Queries existentes quase inalteradas** — continuam fazendo `idLocEscritu = <handle do projeto>`; só muda QUAL bigint é o handle (`E` em vez de `P`), resolvido por um helper único `resolveEntidadeRef(projectId)`.
- ✅ Extensível — o espelho vira ancoragem natural para futuras relações de projeto (project↔recurso, project↔documento) sem reabrir este problema.

**Contras:**
- Cria 1 DEntidade extra por projeto (custo de armazenamento marginal).
- Exige helper central + backfill idempotente dos vínculos já gravados "errados" em produção (Fase 4 — fora desta Fase 1).
- Resolução reversa (E→P / P→E) precisa de índice de expressão Json + cache para O(1) (Fase 4).

**Status:** ✅ ESCOLHIDA.

---

### Opção D — Reescrever DVincula com FK polimórfica / segunda FK opcional para DProject

**Descrição:** adicionar `idProjeto BigInt?` em DVincula com FK para DProject, ou tornar a FK condicional por `idClasse`.

**Prós:**
- FK declarativa para o projeto (integridade no schema).

**Contras:**
- **Coluna nova em tabela canônica** para resolver relacionamento — exatamente o que ADR-V2-029 (Alt-A) já rejeitou; precedente perigoso (`idProjeto`, depois `idTask`, `idSprint`…).
- FK condicional-por-idClasse **não existe em Postgres declarativo** (exigiria trigger — pior que afrouxar).
- Propaga ao template Devari-Core uma anomalia que o canônico nunca teve.

**Status:** ❌ REJEITADA (mais invasiva ao template que a Opção C e fere o espírito do ADR-V2-001).

---

## Decisão

**Adotar a Opção C — DEntidade-espelho `-158 PROJECT_REF` como handle canônico do projeto em DVincula.**

### Nova DClasse (Pilar 3 — esta Fase 1 entrega APENAS isto)

```
DClasse:
  -158 PROJECT_REF  (idPai = -37 ENTIDADES)
       nome   : "Referência de Projeto (espelho DVincula)"
       agrupamento=false, inativo=false, excluido=false,
       excluivel=false, editavel=false, tableFields=null, baseFields=false
```

- `chave = -158` **confirmada livre** no seed (range -150..-159 ocupava -150..-156; -157 e -158 livres). Não sequestra canônica (`-40/-45/-47/-49/-50`) nem entra no range fixo universal (-110..-1). Validado por `validateHierarchy()` em tempo de import (`npm run seed:classes:dry` → "45 fixas + 108 especificas = 153 classes — validacao passou").
- `idPai = -37` (ENTIDADES) — coerente com FOLDER (-155) e demais sub-tipos estruturais.

### Modelagem do espelho (Fase 3+ — NÃO nesta Fase 1)

- Espelho criado via **Service + Prisma direto** dentro do `$transaction` já existente em `ProjectsService.create()` (Pilar 1: cadastro **estrutural** — proibido usar OperacaoPedido/Engine aqui).
- Ponteiro forward `DProject.dados.entidadeRefId = E`; ponteiro reverso `DEntidade.dados.projectId = P` (ambos em `dados` Json — zero coluna nova).
- `idEstab` do espelho = `project.idEstab` (coerência de tenant; `null` quando o projeto não tem org — permitido).
- Helper central `resolveEntidadeRef(projectId)` / `resolveProjectId(refId)` (cache) para não duplicar a regra.
- **Detalhe interno** — o espelho NÃO é exposto via REST próprio (Pilar 2). Contrato HTTP de `/projects`, `/teams/:id/projects`, `/folders` permanece inalterado. Queries genéricas de domínio (`/entidades?classe=...`) já filtram por idClasse específico; onde houver varredura ampla, adicionar filtro defensivo `idClasse != -158`.

### Escopo desta Fase 1

Esta entrega cobre **APENAS Seed (Pilar 3) + este ADR**. Helper, troca de call sites (P→E), migration de índice, backfill idempotente e testes adversariais são **Fase 2+** e não estão liberados.

---

## Consequências

### Positivas

1. **Bug do 500 estruturalmente fechado** (após Fase 2+): a FK `DVincula_idLocEscritu_fkey` / `idEntidade` passa a ser sempre satisfeita por DEntidade real — colisão impossível.
2. **ADR-V2-001 preservado:** zero tabela nova, zero coluna nova obrigatória — apenas 1 DClasse + uso de `dados` Json existente.
3. **Reuso dos 3 Pilares:** Pilar 1 (estrutural via Service, não Engine); Pilar 2 (zero endpoint/controller novo); Pilar 3 (+1 DClasse no seed canônico).
4. **Superfície de regressão minimizada:** as queries existentes continuam `idLocEscritu = <handle>`; um helper único troca P→E.

### Negativas

1. 1 DEntidade-espelho por projeto (custo marginal de armazenamento).
2. Resolução reversa exige índice de expressão Json + cache (Fase 4) para performance.
3. **Dados corrompidos pré-existentes (colisão histórica):** vínculos que "passavam" podem apontar para DEntidade aleatória. O backfill (Fase 4) **não repara automaticamente** casos ambíguos — gera relatório de suspeitos para decisão do CEO.
4. Cardinalidade 1:1 DProject↔espelho é invariante de service, não de schema — exige guarda de idempotência (`dados.entidadeRefId` + entidade viva) e spec de invariante.

### Suplantação parcial de ADRs anteriores

Este ADR **suplanta parcialmente**, no que tange ao **handle de projeto em DVincula**:

- **ADR-V2-003** (RBAC via DVincula): `idLocEscritu` de -171/-172/-173 deixa de ser `projectId` (DProject) e passa a ser `entidadeRefId` (DEntidade -158). O restante do ADR-V2-003 (RBAC duplo, roles, hierarquia de idClasse) permanece vigente.
- **ADR-V2-029** (PROJECT_TEAM_LINK -182): `idEntidade` deixa de ser `projectId` e passa a ser `entidadeRefId`. `idLocEscritu = teamId` (DEntidade -180) permanece correto.
- **ADR-V2-FOLDERS-001** (FOLDER_PROJECT_LINK -183): `idEntidade` deixa de ser `projectId` e passa a ser `entidadeRefId`. `idLocEscritu = folderId` (DEntidade -155) permanece correto.

ADR-V2-051 (§Space privado, -188) também passa a usar `entidadeRefId` em `idLocEscritu`.

**Nenhum desses ADRs é revogado** — apenas o handle de projeto em DVincula é redefinido por este ADR. As notas de suplantação devem ser adicionadas aos ADRs citados na fase de documentação (Fase 6), após ratificação.

### Contribuição candidata ao template Devari-Core

Qualquer projeto-filho que use `DProject` + DVincula project-scoped terá este mesmo problema. O padrão **"DEntidade-espelho (ENTITY_REF) para ancorar tabelas não-DEntidade (DProject/DTask/DRecurso) no grafo DVincula"** é forte candidato a virar o jeito canônico documentado no template. Registrado aqui como feedback futuro ao Devari-Core.

---

## Implementação

**Fase V2:** pós-F5 (dívida arquitetural materializada em produção 2026-06-02).

**Esta Fase 1 (Seed + ADR):**

| Tipo | Arquivo | Detalhe |
|------|---------|---------|
| Seed | `prisma/seeds/classes.seed.ts` | +1 DClasse `-158 PROJECT_REF` (idPai=-37); contagem 152 → 153 (45 fixas + 108 específicas); DEntidade 8 → 9 |
| Documentation | `docs/decisions/ADR-V2-058-project-ref-entidade-espelho.md` (este arquivo) | Decisão formalizada (Proposto — pendente CEO) |

**Validação desta Fase 1:**

- `npm run build:seeds` (tsc -p tsconfig.seeds.json) — PASS.
- `npm run seed:classes:dry` — "45 fixas + 108 especificas = 153 classes (validacao passou em time de import)".
- `prisma/seeds/__tests__/validate-hierarchy.spec.ts` — 12/12 PASS.
- `npx tsc --noEmit` — 0 erros nos arquivos de seed (7 erros pré-existentes não-relacionados preservados; baseline intacto).

**Fases seguintes (NÃO liberadas nesta entrega):**

- Fase 2 — ratificação do CEO.
- Fase 3 — `project-ref.service.ts` (`ensureEntidadeRef`, `resolveEntidadeRef`, `resolveProjectId`) + troca de call sites P→E (começando por `ProjectsService.create`).
- Fase 4 — migration de índice de expressão Json + backfill idempotente (backup `pg_dump`, transação por projeto, relatório de suspeitos de colisão histórica; cutover executado pelo CEO em janela).
- Fase 5 — testes unit/integration/adversarial (invariante: nenhum DVincula project-scoped aponta para `DProject.chave`).
- Fase 6 — notas de suplantação em ADR-V2-003/029/FOLDERS-001; CHANGELOG; STATUS.

---

## Notas

1. **Relação com ADR-V2-001:** respeitada integralmente. PROJECT_REF cabe nas 17 tabelas canônicas via DEntidade; os ponteiros usam `dados` Json existente. Zero tabela, zero coluna nova.
2. **Por que C > B:** B é "zero migration de schema" mas espalha risco de segurança por dezenas de call sites e enfraquece índices. C concentra a complexidade num único ponto (criação do espelho + backfill) e deixa todas as queries existentes quase inalteradas.
3. **Engine NÃO se aplica:** DEntidade é estrutural → criação do espelho usa Prisma direto em `$transaction` (Pilar 1). Nenhum INSERT em DPedido/transacional envolvido.
4. **Chave escolhida:** `-158`. Confirmada livre por grep + dry-run do seed-runner. Não houve conflito. Alternativas livres eram -157 / -159 / -184..-199; -158 foi mantida por seguir o plano e ser a primeira livre adjacente ao bloco de sub-tipos de entidade.

---

**Links relacionados:**

- [ADR-V2-003](./ADR-V2-003-rbac-dvíncula.md) — RBAC via DVincula (handle de projeto suplantado parcialmente)
- [ADR-V2-029](./ADR-V2-029-project-team-link.md) — PROJECT_TEAM_LINK -182 (handle de projeto suplantado parcialmente)
- [ADR-V2-FOLDERS-001](./ADR-V2-FOLDERS-001-folder-via-dentidade-dvincula.md) — FOLDER_PROJECT_LINK -183 (handle de projeto suplantado parcialmente)
- [ADR-V2-022](./ADR-V2-022-renumeracao-corte-limpo.md) — convenção de chaves negativas e CANONICAL_RESERVED
- [ADR-V2-043](./ADR-V2-043-repo-url-coluna-dproject.md) — precedente de coluna em DProject (Opção D análoga, rejeitada aqui)
- `workspace/plans/plan-core-dvincula-dproject-fk-systemic-fix-task1.md` — plano completo (Fases 1-6)

**Mantido por:** Devari Tecnologia
**Versão:** 1.0
**Última atualização:** 2026-06-02

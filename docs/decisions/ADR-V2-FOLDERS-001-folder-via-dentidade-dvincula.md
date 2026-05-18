# ADR-V2-FOLDERS-001: Folders via DEntidade(-155) + DVincula(-183), sem tabela ou coluna nova

**Status:** Accepted
**Data:** 2026-05-18
**Decisores:** CEO + Strategist Agent V2
**Tags:** #V2 #pós-F5 #entidades #estrutural

---

## Contexto e Problema

Usuários solicitaram **Folders** — agrupamento visual de projetos dentro de uma organização. O Scrumbam-FrontEnd já possui a UI pronta com pasta "Projetos" hardcoded. O backend V2 precisa:

1. Armazenar folders (pasta, pertencem a 1 org, contêm N projects)
2. Relacionar projects a folders (cardinalidade N:1: 1 project → 0 ou 1 folder)
3. Suportar migration idempotente para orgs existentes (criar folder "Projetos" default)
4. Preservar restrição ADR-V2-001 (zero tabela nova)

Questões abertas pela CEO (todas resolvidas em 2026-05-18 — ver §Decisões do CEO):

| Q# | Pergunta | Decisão |
|----|----------|---------|
| Q1 | Aninhamento de folders? | OUT do MVP — folders flat |
| Q2 | Cor/ícone customizáveis? | OUT do MVP — cor derivada em frontend (hash) |
| Q3 | Ordenação manual (drag-drop)? | OUT do MVP — ordem alfabética |
| Q4 | Delete folder com projects? | MOVE projects para "limbo" (soft-delete de DVincula) |
| Q5 | Migration para orgs existentes? | SIM — cria folder "Projetos" e vincula projects |

---

## Alternativas Consideradas

### Opção A: DFolder + ForeignKey em DProject

**Descrição:** Criar tabela `DFolder` ou adicionar coluna `folderId` em `DProject`.

**Prós:**
- Foreign key no schema garante integridade referencial
- Query simples: `SELECT * FROM DProject WHERE folderId = :id`
- Único, rápido para leitura

**Contras:**
- **Viola ADR-V2-001** (zero tabela nova)
- Cria sequestro da cardinalidade N:1 no schema (rigidez)
- Aninhamento futuro exigiria migration (rompe portabilidade)
- Não é genérico — só funciona para Project, não para outras entidades

**Status:** ❌ REJEITADA por ADR-V2-001

---

### Opção B: DEntidade(-155) + DVincula(-183) [ESCOLHIDA]

**Descrição:** Folder = DEntidade com idClasse=-155. Vínculo Project↔Folder = DVincula com idClasse=-183. Cardinalidade N:1 validada em service (não em schema).

**Prós:**
- ✅ Respeitada ADR-V2-001 (zero tabela/coluna nova)
- ✅ Reutiliza Pilar 2 (EntidadeController genérico) — zero controller novo
- ✅ Reutiliza Pilar 3 (seed canônico) — 2 novas DClasses no range -150..-527
- ✅ Soft delete nativo via DEntidade.excluido
- ✅ Audit trail nativo via DEvento (futura implementação)
- ✅ Extensível: aninhamento, compartilhamento, membros customizados (sem migration)
- ✅ Precedente direto: ADR-V2-029 (PROJECT_TEAM_LINK -182) segue padrão idêntico
- ✅ Robustez estrutural: mesmo mecanismo usado no Dinpayz onboarding (4 níveis)

**Contras:**
- Query "projects sem folder" exige NOT EXISTS subquery (perf crítica — mitigada com index)
- Cardinalidade N:1 é regra de service, não de schema (risco: outro service cria DVincula direto)
  - Mitigação: documentar claramente em FoldersService JSDoc + testes de invariante

**Status:** ✅ ESCOLHIDA

---

### Opção C: DTabela(-155) para meta-definições de folder

**Descrição:** Folder como lookup em DTabela (cada org tem 1 linha DTabela com lista em `dados` Json).

**Prós:**
- Simples para orgs com poucos folders

**Contras:**
- Não escalável (1 folder por org em DTabela = sem suporte para N folders)
- Reusa DTabela para coisa errada (DTabela é lookup, não entidade com cardinalidade)
- Soft delete e audit trail ficariam em Json (não estruturado)
- Pior: exigiria parsing json a cada query

**Status:** ❌ REJEITADA por inadequação semântica

---

### Opção D: JSON array em DProject.dados

**Descrição:** Armazenar folder info como array em cada DProject.dados.

**Prós:**
- Zero schema changes

**Contras:**
- Desnormalizado e sem estrutura
- Query "listar projetos da folder X" seria scan completo (N+1 ou full table scan)
- Soft delete impossível (dados deletados viram null)
- Não escalável

**Status:** ❌ REJEITADA por desnormalização extrema

---

## Decisão

**Implementar Opção B: Folder = DEntidade(-155) + DVincula(-183).**

Modelagem:

```
DClasse:
  -155 FOLDER             (idPai=-37 ENTIDADES)
       - nome (obrigatório, max 100 chars)
       - dados Json (cor, ícone — reservado, não populado em MVP)

  -183 FOLDER_PROJECT_LINK (idPai=-37 ENTIDADES)
       - vínculo N:1 via DVincula.idLocEscritu=folderId, idEntidade=projectId

DEntidade (Folder):
  chave        : BigInt PK
  idClasse     : -155
  nome         : String (100)
  idEstab      : BigInt → organizationId (fk lógica — DEntidade -152 ORGANIZATION)
  dados        : Json null (para expandir depois)
  excluido     : Boolean (soft delete)
  criadoEm     : DateTime
  atualizadoEm : DateTime

DVincula (Folder↔Project):
  chave        : BigInt PK
  idClasse     : -183
  idLocEscritu : BigInt → folderId (DONO do vínculo)
  idEntidade   : BigInt → projectId (FK a DProject)
  tipo         : String null
  excluido     : Boolean (soft delete no delete folder → move projects para limbo)
```

**Cardinalidade N:1 — Regras de Negócio (validadas em service):**

1. 1 project pode estar em **0 ou 1 folder** (zero = "limbo")
2. 1 folder contém **N projects** (0 a muitos)
3. 1 folder pertence a **1 organization** (via DEntidade.idEstab)
4. **Múltiplos usuários** da mesma org veem os mesmos folders
5. **Sem aninhamento** em MVP (folders flat na org)

**Delete behavior (Q4 — CEO 2026-05-18):**

Quando um folder é deletado:
- DEntidade.excluido = true (soft delete)
- DVincula -183 com idLocEscritu=folderId: excluido = true (vínculo quebrado)
- DProject **permanece intacto** (move para "limbo" — sem folder)

**Migration (Q5 — CEO 2026-05-18):**

Para cada org com ≥1 project E zero folders:
1. Cria DEntidade(idClasse=-155, nome="Projetos", idEstab=orgId)
2. Para cada DProject na org, cria DVincula(idClasse=-183, idLocEscritu=folderChave, idEntidade=projectChave)
3. Idempotente: se folder "Projetos" já existe, não recria

---

## Consequências

### Positivas

1. **Reutilização de Pilares V2:**
   - Pilar 1: Zero Engine (cadastro estrutural correto)
   - Pilar 2: Zero controller novo (EntidadeController serve folders)
   - Pilar 3: 2 DClasses novas no seed canônico

2. **Arquitetura Limpa:**
   - Nenhuma tabela ou coluna nova (ADR-V2-001 respeitado)
   - Padrão idêntico ao precedente ADR-V2-029 (PROJECT_TEAM_LINK -182)

3. **Extensibilidade:**
   - Folders aninhados (hierarquia DClasse, idPai=-155)
   - Folders compartilhadas (DVincula N:N ao invés de N:1)
   - Membros customizados de folder (novo DVincula.idClasse)
   - **Tudo sem migration** — apenas novas DClasses e DTOs

4. **Soft Delete + Audit Trail:**
   - DEntidade.excluido e DVincula.excluido nativos
   - DEvento pode registrar "folder deletada" (futura implementação)

5. **Segurança (RBAC duplo — F3 já entregue):**
   - RoleResolverService valida role do usuário na org (ADMIN/MEMBER/VIEWER)
   - FoldersService.getOrgRole garante que usuário só vê folders da sua org

### Negativas

1. **Query "projects sem folder" é NOT EXISTS:**
   ```sql
   SELECT * FROM DProject p
   WHERE NOT EXISTS (
     SELECT 1 FROM DVincula v
     WHERE v.idClasse = -183
       AND v.idLocEscritu = :folderId
       AND v.idEntidade = p.chave
       AND v.excluido = false
   )
   ```
   - Perf: exige index em DVincula(idClasse, idLocEscritu, idEntidade, excluido)
   - Index criado em migration (bancos de dados versionados)

2. **Cardinalidade N:1 é validação de service, não de schema:**
   - Risco: outro service (futuro) cria DVincula(-183) sem passar por FoldersService
   - Mitigação: testes de invariante (`folders.service.spec.ts` inclui teste "nenhum project em 2 folders")
   - Documentação clara em FoldersService JSDoc

3. **Delete folder afeta query complicada:**
   - Usuário deleta folder → DVincula excluido=true
   - Query de listagem de folders deve filtrar `excluido=false`
   - É o padrão em todo V2 — sem surpresa, mas adiciona pequena complexidade

---

## Implementação

**Fase V2:** Pós-F5 (extensão — não faz parte do roadmap F0-F17)

**Branch:** `feat/folders-mvp`

**Artefatos entregues:**

| Tipo | Arquivo | Detalhe |
|------|---------|---------|
| Seed | `prisma/seeds/classes.seed.ts` | +2 DClasses (-155, -183) |
| Service | `src/entidades/folders.service.ts` | 9 métodos públicos + helpers |
| DTOs | `src/entidades/dto/create-folder.dto.ts`, `update-folder.dto.ts`, `folder-response.dto.ts` | Validação + swagger |
| Controller | `src/entidades/entidades.controller.ts` | +8 rotas (POST/PATCH/DELETE /folders...) |
| Tests | `src/entidades/folders.service.spec.ts`, `folders.integration.spec.ts` | 30 testes (24 unit + 6 int) |
| Migration | `prisma/scripts/backfill-default-folders.ts` | Cria "Projetos" para orgs existentes |
| Documentation | ADR-V2-FOLDERS-001 (este arquivo) | Decisão formalizada |

**Build status:** `npm run build` PASS (NestJS compilation OK)
**TypeScript:** 0 errors (`tsc --noEmit` OK)
**Tests:** 30/30 PASS (24 unit + 6 integration)

---

## Notas

1. **Relação com ADR-V2-001:** Respeitada integralmente. Não há tabela ou coluna nova. Folder encaixa nas 17 tabelas canônicas via DEntidade + DVincula.

2. **Relação com ADR-V2-029:** PROJECT_TEAM_LINK (-182) é precedente direto. Padrão identico: "N:1 via DVincula com idLocEscritu=dono, idEntidade=recurso".

3. **Relação com ADR-V2-043:** ADR-V2-043 autorizou coluna `repoUrl` em DProject por ser caso único e raro. Folders NÃO justificam coluna em DProject — dvínculo via DVincula é canônico e reutilizável.

4. **Frontend Integration:** Scrumbam-FrontEnd usa `useProjects()` que retorna `{ ...project, folderId }` (resolvido via endpoint V2 aumentado em ProjectsService.listByOrg).

5. **Débito técnico identificado (M5):** `resolveFolderIdsForProjects` duplicada em FoldersService (public) e ProjectsService (private). Extrair para `common/` quando circular dependency for resolvida (futuro).

6. **Decisões CEO confirmadas:**
   - Q1 (aninhamento): OUT MVP ✓
   - Q2 (cor/ícone): OUT MVP ✓
   - Q3 (drag-drop): OUT MVP ✓
   - Q4 (delete): MOVE projects ✓
   - Q5 (migration): SIM ✓

---

**Links relacionados:**

- [ADR-V2-001](./ADR-V2-001-17-tabelas-canonicas.md) — zero tabela nova (respeitado aqui)
- [ADR-V2-029](./ADR-V2-029-dvínculo-team-link.md) — PROJECT_TEAM_LINK (precedente direto)
- [ADR-V2-043](./ADR-V2-043-coluna-repourl-em-dproject.md) — coluna em DProject (rejeitado para Folders)
- [ROADMAP.md](../ROADMAP.md) — fase pós-F5 registrada

**Mantido por:** Devari Tecnologia
**Versão:** 1.0
**Última atualização:** 2026-05-18

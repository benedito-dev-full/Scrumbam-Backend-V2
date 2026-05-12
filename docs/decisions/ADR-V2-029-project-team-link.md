# ADR-V2-029 — Project ↔ Team via DVincula -182

**Status:** Proposto
**Data:** 2026-05-12
**Autor:** Strategist Agent V2 (com revisão CEO)
**Implementer:** Implementer Agent V2
**ADRs relacionados:** ADR-V2-001 (zero tabela nova), ADR-V2-003 (RBAC via DVincula), ADR-V2-009 (wrappers thin), ADR-V2-027 (project lifecycle audit)

---

## Contexto

As páginas `/team/[id]/projects` e `/team/[id]/issues` do frontend exibem
**todos** os projetos da workspace ao invés de filtrar pelo time selecionado.
Causa raiz dupla:

1. `projectsApi.list()` no frontend ignora o parâmetro `_teamId`.
2. O backend **não modela** vínculo Project↔Team. `DProject` (schema F5) tem
   apenas `idClasse`, `idEstab` (FK → org), `nome`, `descricao`, `dados`,
   `metaDados`. Não há campo `idTeam` nem qualquer relação canônica que
   permita filtragem por time.

F5 entregou Org/Team/Project/Sprint/Status/Task estrutural mas o link
Team↔Project ficou fora do escopo original. O frontend foi construído
assumindo `teamId` no shape de `Project` (`mapProject` já trata
`raw.teamId ?? null`), então o contrato esperado existe — falta apenas o
backend popular.

---

## Decisão

Modelar Project↔Team via **DVincula polimórfica** com nova DClasse
`-182 PROJECT_TEAM_LINK`:

- `idLocEscritu` = `teamId` (DONO do vínculo, segue padrão
  `devari-polymorphic-engine.md §6`)
- `idEntidade` = `projectId` (lado B)
- `idClasse` = `-182` (PROJECT_TEAM_LINK)
- **N:1 por contrato do service** (1 projeto pertence a no máximo 1 time)
- **Soft-delete** (`excluido=true`) ao reatribuir ou desvincular (preserva
  histórico para auditoria futura)
- **Projetos órfãos** (sem vínculo -182 ativo) são estado válido — response
  retorna `teamId: null`

### Exposição

- **Caminho primário:** `GET /projects?teamId=X` (Pilar 2 reuso)
- `POST /projects { teamId? }`: cria com vínculo (atomic na transação)
- `PATCH /projects/:id { teamId? | null }`: reatribui (soft-delete antigo +
  cria novo) ou desvincula (soft-delete só)
- `ProjectResponseDto.teamId: string | null` em todas as respostas

### Validações no service (`validateTeamForLink`)

1. Team existe (`DEntidade idClasse=-180, excluido=false`).
2. **Cross-org guard:** team pertence à mesma org do projeto
   (`team.idEstab === project.idEstab`). Bloqueia leak entre orgs.
3. Usuário é LEAD do time (`DVincula -181`, `metaDados.cargo === 'LEAD'`)
   **OU** ORG_ADMIN da org (`DVincula -161`).

### Eventos audit (DEvento idClasse=-499 PROJECT_LIFECYCLE)

Emitidos APÓS commit via `EventProducerService`:

- `project.team.linked` — vínculo criado/reatribuído (payload inclui
  `previousTeamId` em reatribuição).
- `project.team.unlinked` — vínculo desfeito (`teamId=null`).

Reusa idClasse -499 já existente (sem nova DClasse de evento).

---

## Alternativas Consideradas

### Alt-A: Coluna `idTeam` em `DProject`

- **Prós:** Query mais simples (1 join), índice direto.
- **Contras:** **Viola ADR-V2-001** (zero coluna nova de domínio em tabela
  canônica para resolver relacionamento — DVincula existe exatamente para
  isso). Cria precedente perigoso (`idAgent`, `idCustomer`, …).
- **Rejeitado.**

### Alt-B: Campo `teamId` em `DProject.dados` (Json)

- **Prós:** Sem migration, sem tabela nova.
- **Contras:** Não é indexável eficientemente; viola padrão (relações
  estruturais ficam em DVincula); rompe simetria com `-181 TEAM_MEMBERSHIP`;
  query `WHERE dados->>'teamId' = X` não escala.
- **Rejeitado.**

### Alt-C (ESCOLHIDA): DVincula -182 PROJECT_TEAM_LINK

- **Prós:**
  - Canônico (zero tabela nova, zero coluna nova).
  - Indexado por `idLocEscritu` + `idClasse` + `excluido` em DVincula.
  - N:N-ready (se um dia precisarmos de cross-team).
  - Soft-delete nativo (histórico preservado).
  - Audit via DEvento -499 já existe.
  - Simétrico com `-181 TEAM_MEMBERSHIP`.
- **Contras:**
  - Validação N:1 fica no service, não no banco (aceitável: regra de domínio
    do V2 está em services; soft-delete antes de create no `update()` mitiga
    race condition).
  - +1 join na query (~negligível com índices).
- **Aceita.**

---

## Consequências

### Positivas

- Reforça os 3 Pilares (Pilar 2 reuso de `/projects`; Pilar 3 seed Fase 1).
- Preserva ADR-V2-001 (zero tabela nova).
- Frontend já tem `teamId` no shape — retrabalho mínimo de UI.
- Pavimenta caminho para cross-team (N:N) sem mudança de modelo.

### Negativas

- Invariante N:1 não é enforçada no banco. Mitigação: (i) soft-delete antes
  de create no `update()`; (ii) teste unit de concorrência básico; (iii)
  follow-up opcional: índice parcial único
  `WHERE idClasse=-182 AND excluido=false` se a invariante for violada em prod.
- `GET /projects?teamId=X` adiciona 1 query para resolver `projectIds`
  do time (mitigado: query é simples, indexada, e retorna lista vazia
  imediatamente se time não tem projetos).

### Neutras

- Endpoint dedicado `GET /teams/:id/projects` **NÃO** é criado agora
  (ADR-V2-009 — wrapper thin opcional). Fica como follow-up se a UI exigir
  rota team-cêntrica explícita.
- Endpoints `POST /projects/:id/team` / `DELETE /projects/:id/team` **NÃO**
  são criados. Reatribuição/desvinculação fica em `PATCH /projects/:id`.

---

## Implementação

- **Fase 1:** Seed (Pilar 3) — `prisma/seeds/classes.seed.ts` adiciona
  `esp(-182, 'PROJECT_TEAM_LINK', ...)` (138 DClasses total).
- **Fase 2:** Este ADR.
- **Fase 3–5:** DTOs + Service + Controller (`ListProjectsQueryDto`,
  `CreateProjectDto.teamId`, `UpdateProjectDto.teamId`,
  `ProjectResponseDto.teamId`, `validateTeamForLink` helper).
- **Fase 6:** Testes (unit + e2e).
- **Fase 7:** Frontend (`projectsApi.list/create/update` honram `teamId`).
- **Fase 8:** Auditoria de dados em prod (decisão: projetos órfãos ficam
  como estão).
- **Fase 9:** Commit + docs.

Hook `enforce-canonical-tables.sh` cobre (zero tabela nova).

---

## Projetos órfãos em produção

Projetos pré-existentes não terão vínculo -182 e responderão com
`teamId: null`. Comportamento documentado:

- `GET /projects` (sem `teamId`) lista todos os do usuário (inclui órfãos).
- `GET /projects?teamId=X` lista apenas vinculados ao time X (exclui órfãos).
- UI `/team/[id]/projects` mostra apenas projetos do time.
- UI `/projects` (rota org-scoped, se existir) mostra todos.

Não há migration de dados em massa: usuários atribuem time via UI conforme
necessário.

---

## Status final

- [ ] Seed publicado (Fase 1)
- [x] Este ADR publicado (Fase 2)
- [ ] Service + Controller + DTOs implementados (Fase 3–5)
- [ ] Testes verde (Fase 6)
- [ ] Frontend integrado (Fase 7)
- [ ] Auditoria documentada (Fase 8)
- [ ] Commit feito (Fase 9)

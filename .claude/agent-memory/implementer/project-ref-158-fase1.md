---
name: project-ref-158-fase1
description: ADR-V2-058 Fase 1 — DClasse -158 PROJECT_REF (DEntidade-espelho de DProject em DVincula) no seed + ADR; chave confirmada livre
metadata:
  type: project
---

# ADR-V2-058 Fase 1 — PROJECT_REF (-158) DEntidade-espelho (2026-06-02)

**Fato:** Adicionada DClasse `-158 PROJECT_REF` (idPai=-37 ENTIDADES) ao seed + redigido ADR-V2-058 (status "Proposto — pendente ratificação do CEO").

**Why:** `POST /projects` deu 500 em prod (FK `DVincula_idLocEscritu_fkey`): DVincula exige `DEntidade.chave` mas o V2 gravava `DProject.chave` em -171/-172/-173, -182, -183, -188. Sequências DEntidade/DProject separadas → colisão silenciosa (vínculo apontando p/ DEntidade aleatória = bug de RBAC) ou 500. Opção C (espelho 1:1) escolhida sobre A (afrouxar FK — vetada CEO), B (apontar p/ org — espalha risco em ~30 call sites) e D (coluna nova — fere ADR-V2-001).

**How to apply (para Fases 2+, NÃO liberadas nesta entrega):**
- Espelho: 1 DEntidade -158 por DProject, criada via Prisma direto no `$transaction` de `ProjectsService.create()` (estrutural — NÃO Engine). `DProject.dados.entidadeRefId=E` (forward), `DEntidade.dados.projectId=P` (reverso), `idEstab=project.idEstab`.
- Todos os vínculos project-scoped trocam P→E via helper central `resolveEntidadeRef(projectId)`/`resolveProjectId(refId)` (`src/projects/project-ref.service.ts`, ainda não criado).
- Read sites: role-resolver.getProjectRole, executions, approval-flow, webhook-owner.guard, teams cascade.
- Fase 4 = migration índice expressão Json + backfill idempotente (relatório de suspeitos de colisão; cutover pelo CEO).

**Gotchas desta Fase 1:**
- `-158` CONFIRMADO livre: range -150..-156 ocupado, -157 e -158 livres. Não em CANONICAL_RESERVED (-40/-45/-47/-49/-50) nem no range fixo -110..-1. Validação por `validateHierarchy()` em tempo de import.
- Seed usa helper `esp(-158, 'PROJECT_REF', '...', -37)` — NÃO o literal `{ chave: -158, ... }`. Por isso o /seed-validate skill (grep `chave:`) não pega; validar via `npm run seed:classes:dry` (importa o array real e roda validateHierarchy → imprime "45 fixas + 108 especificas = 153 classes").
- Contagens atualizadas no header e no JSDoc do array: total 152→153, especificas 107→108, DEntidade 8→9, soma "9+15+1+3+4+36+16+21=105" (+GAP-COMMENT=106, +Nexus IA=108). Nenhum spec asserta count hard (grep confirmou).
- Build relevante = `npm run build:seeds` (tsc -p tsconfig.seeds.json) — PASS. `nest build` falha no dev por @google/generative-ai ausente (gemini.provider) — irrelevante p/ mudança de seed. `npx tsc --noEmit` = 7 erros PRÉ-EXISTENTES (baseline), 0 em arquivos de seed.
- NÃO existe arquivo ADR-V2-001 nem ADR-V2-051 em docs/decisions/ — referenciar conceitualmente, linkar só os que existem. ADR-V2-029 tem DOIS arquivos; o de PROJECT_TEAM_LINK é `ADR-V2-029-project-team-link.md`.

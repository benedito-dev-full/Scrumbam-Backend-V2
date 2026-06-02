---
name: dvincula-fk-exige-dentidade
description: DVincula.idLocEscritu/idEntidade E DTabela.dEntidadeId têm FK para DEntidade.chave — NUNCA gravar DProject.chave nesses campos; usar DEntidade-espelho (-158)
metadata:
  type: project
---

**FK irmã — DTabela.dEntidadeId (mesmo bug, descoberto 2026-06-02 no dev do CEO):** `DTabela.dEntidadeId` também é FK para DEntidade.chave (migration `initial_canonical:544`). O V2 grava `DProject.chave` (P) ali como "escopo do projeto" em statuses -441..-449, sprint -400, priorities -421..-424 (`seed-bootstrap.service.ts`, `workflow-statuses.service.ts`), API keys -471 (`api-key.service.ts`), webhooks -470 (`webhooks/*`). Sintoma: `POST /projects` (LIST) 500 `DTabela_dEntidadeId_fkey` em `SeedBootstrapService.seedProject`. ADR-V2-058 corrigiu SÓ DVincula — esta FK ficou de fora. Fix = mesma solução (handle E via `ProjectRefService`), escrita+leitura no mesmo espaço, backfill espelhando o da Fase 3. **Cuidado de contrato:** endpoint genérico `/tabelas?dEntidadeId=P` (frontend/MCP passam P) deve resolver P→E internamente. NÃO tocar DTabela user-scoped (MCP_KEY) nem team-scoped (ISSUE_COUNTER -475) — já são DEntidade real. Plano: `workspace/plans/plan-core-dtabela-dproject-fk-fix-task1.md`. ADR a ratificar: ADR-V2-059 (estende -058).

---

DVincula tem FK física para DEntidade nos DOIS lados de relação: `idLocEscritu` (FK obrigatória `VinculaLocEscritu → DEntidade.chave`) e `idEntidade` (FK opcional `VinculaEntidade → DEntidade.chave`). Schema `prisma/schema.prisma` linhas 221-223.

**Regra:** todo registro em DVincula referencia DEntidade nos dois lados — NUNCA DProject, DTask, DPedido. O canônico Devari (Dinpayz prod) sempre usa DEntidade no grafo DVincula.

**Anomalia que causou bug em produção (2026-06-02):** o V2 gravou `DProject.chave` em campos de DVincula em 4 famílias de vínculo:
- RBAC -171/-172/-173 (`idLocEscritu = projectId`) — ADR-V2-003
- SPACE_PRIVATE -188 (`idLocEscritu = projectId`) — ADR-V2-051
- PROJECT_TEAM_LINK -182 (`idEntidade = projectId`) — ADR-V2-029
- FOLDER_PROJECT_LINK -183 (`idEntidade = projectId`) — ADR-V2-FOLDERS-001

`DProject` e `DEntidade` têm `@default(autoincrement())` SEPARADOS → FK quebra quando os IDs divergem, e "passa por coincidência" quando colidem (pior: aponta para DEntidade aleatória — bug silencioso de dados/segurança). Sintoma: `POST /projects` 500 `DVincula_idLocEscritu_fkey`.

**Why:** ADR-V2-003 §62 assumiu "idLocEscritu = FK DEntidade (org OU project)". Funciona p/ org (org É DEntidade -152); quebra p/ project (project virou DProject tabela própria em F5). ADR-029/FOLDERS-001 repetiram o erro.

**How to apply:**
- Ao planejar QUALQUER vínculo project-scoped (ou task/pedido-scoped) em DVincula, NUNCA usar a chave da tabela não-DEntidade direto. Usar uma **DEntidade-espelho** (idClasse PROJECT_REF -158, idPai -37) como handle canônico. Ponteiro forward em `DProject.dados.entidadeRefId`, reverso em `DEntidade.dados.projectId`.
- CEO REJEITOU afrouxar/remover a FK (fere Devari-Core + só adia colisão silenciosa).
- Plano completo: `workspace/plans/plan-core-dvincula-dproject-fk-systemic-fix-task1.md`. Decisão a ratificar: ADR-V2-058. Forte candidato a feedback ao template (padrão ENTITY_REF).
- Verificar antes de recomendar: confirmar que ADR-V2-058 foi de fato implementado e que -158 é a chave final (rodar `/seed-validate` + grep). Este memory descreve o plano, não necessariamente o estado já mergeado.

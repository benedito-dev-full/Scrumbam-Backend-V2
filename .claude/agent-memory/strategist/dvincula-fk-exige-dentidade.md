---
name: dvincula-fk-exige-dentidade
description: DVincula.idLocEscritu e idEntidade têm FK obrigatória para DEntidade.chave — NUNCA gravar DProject.chave (ou DTask/DPedido) nesses campos; usar DEntidade-espelho
metadata:
  type: project
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

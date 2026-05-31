---
name: dados-json-merge-conventions
description: Como DProject.dados e DTask.dados sao mesclados nos updates (merge seletivo vs raso) e onde os responses expoem dados — base para qualquer feature que grave campos polimorficos em JSON
metadata:
  type: project
---

Convencao de merge dos campos `dados Json?` nos updates estruturais V2 (DProject/DTask) — verificado no codigo, nao presumido.

**Fato:**
- `projects.service.ts` `update()` faz **merge SELETIVO** em `dados`: spread `...dadosAtuais` + apenas chaves conhecidas (prefix, automationEnabled, description, color, icon). Slug e demais chaves preservadas automaticamente. NUNCA grava `dto.dados` cru.
- `tasks.service.ts` `update()` faz **merge RASO** de `dto.dados` inteiro sobre `...dadosAtuais` — sub-objetos (ex: `dados.fields`) sao SUBSTITUIDOS por inteiro, nao mesclados por chave. Cuidado: features que gravam sub-objetos precisam de merge profundo manual antes desse spread.
- Leitura: `TaskResponseDto.dados` devolve `dados` cru (sub-chaves trafegam livres). `ProjectResponseDto` (via `buildResponse`) **cherry-picka** `dados` — NAO devolve `dados` cru; expor nova sub-chave exige editar buildResponse + DTO.
- Filtro por campo JSON ja e padrao: `where.dados = { path: ['<key>'], equals }` (idBloco, assigneeTeamId) e indice `dados->>'slug'`.
- Hierarquia DProject confirmada: idClasse -350 SPACE / -351 FOLDER / -352 LIST / -353 DOC (projects.service.ts).
- **Coluna dedicada vs `dados` Json (precedente canônico):** para campo ESTRUTURAL de primeira-classe, o V2 prefere COLUNA própria nullable a aninhar em `dados`. Precedentes: `DClasse.tableFields Json?` (schema l.167, escopo de classe), `repoUrl String?` (ADR-V2-043). CEO decidiu (2026-05-30) que colunas customizaveis por lista vão em `DProject.tableFields Json?` (coluna própria, NÃO `dados.tableFields`). Regra de ouro ADR-V2-001 é "zero TABELA nova ≠ zero coluna" — coluna aditiva nullable é permitida via migration aditiva. Schema.prisma já tinha um placeholder `tableFieldsXXX Json?` (l.200) a corrigir.
- **Write direto na coluna** (set/replace + version otimista) é mais simples e isolado que merge profundo em `dados`; elimina risco de lost-update cruzado com slug/prefix/deploy-keys.

**Why:** evita re-investigar a cada feature que persiste dados polimorficos em JSON (colunas custom, blocos, telemetria), e evita o bug de gravar `dados` cru destruindo slug/v3/idBloco.

**How to apply:** ao planejar feature que grava sub-objeto em `dados`, sempre especificar merge por chave manual no service de tasks; no de projetos, basta adicionar 1 spread condicional no merge seletivo + expor no buildResponse. Relacionado a [[phase-hierarchy-pattern]].

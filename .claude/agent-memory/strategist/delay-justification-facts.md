---
name: delay-justification-facts
description: Feature Justificativa de Atraso — motivos via DClasse -530..-537, justificativa via DEvento -503, painel admin via $queryRaw jsonb. idClasse concretos + trap de FK.
metadata:
  type: project
---

# Justificativa de Atraso de Tarefas + Painel de Motivos

Plano: `workspace/plans/plan-eventos-justificativa-atraso-task1.md`. ADR proposto: **ADR-V2-070**.

**Caminho canônico (ZERO tabela nova):**
- Motivos de atraso → **DClasse** (radio populado por `GET /classes?idPai=-530`, Pilar 2). Agrupador `-530 DELAY_REASON` (idPai -51) + 7 folhas `-531..-537` (DEPENDENCY, EXTERNAL_BLOCK, UNDERESTIMATED, PRIORITY_SHIFT, TECHNICAL, OVERLOAD, OTHER).
- Justificativa → **DEvento idClasse `-503` DELAY_JUSTIFICATION** (idPai -3). ADR-V2-008.

**Trap de FK confirmado no schema:** `DEvento.idEntidade` é FK → **DEntidade SOMENTE**. taskId (DTask) NÃO cabe lá (bug ADR-V2-058). Logo: `idEntidade`=autorId (DEntidade do responsável), `identificadorExterno`=taskId (string, índice `(idClasse,identificadorExterno)`), `metaDados`={taskId,motivoClasse,texto,projetoId,autorId,delayDays,delayKind,version,supersededBy}. Mesmo padrão de **TASK_COMMENT -507** (ler `src/comments/`).

**Vigente + histórico:** editar = `updateMany excluido=true` na anterior + `create` nova, em `$transaction`. Vigente = única linha `excluido=false`; histórico = todas. Agregação do painel conta só `excluido=false` (sem double-count).

**Painel admin (módulo reports):** `$queryRaw` group by idEntidade(usuário), `metaDados->>'projetoId'`, `metaDados->>'motivoClasse'`, bucket criadoEm. Prisma `groupBy` NÃO cobre Json path → raw com bind params. Fase 2 adiciona índice parcial jsonb (migration, sem tabela nova).

**Colisão de IDs (checada em classes.seed.ts, jul/2026):** zona DEvento(-3) usa -489..-502,-505..-508 → -503/-504 livres. Lookups até -527 → -528..-537 livres. Nenhuma colisão.

**Overdue:** por DIA de calendário TZ America/Sao_Paulo (espelha frontend) via TimezoneService. `DTask.dueDate` existe no schema. Aplica a atraso aberto E concluída-com-atraso.

**Dia de conclusão de task (verificado em `TasksService.updateStatus` + `task-dados.schema.ts`) — cascata robusta:** (1) `dados.telemetry.doneAt` — gravado server-side (`new Date()`) na transição p/ DONE (linha ~1302), persiste até VALIDATED; (2) fallback `dados.v3.movedAt` se `dados.v3.state ∈ {DONE,VALIDATED}` (sempre populado em toda transição); (3) último recurso `atualizadoEm` (Prisma @updatedAt — RUIDOSO, bumpado por timer/edições, NÃO usar como primário). Útil p/ qualquer feature que precise do "quando concluiu".

**RBAC final (CEO 2026-07-09):** membro (assignee) SÓ justifica/lê a própria; painel+edição de terceiros = **org ADMIN DVincula -161 SOMENTE** (project MANAGER -171 NÃO). Badge global(/me)+por projeto. Prazo estendido → justificativa vira histórico (não arquiva).

**Faseamento:** F1 Captura (seed+persistência+endpoints escrita/leitura+badge+modal). F2 Painel admin (agregação+tela). Alt B (DTask.dados) rejeitada: sem histórico + scan no painel.

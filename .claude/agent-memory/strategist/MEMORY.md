# Strategist Agent Memory — Scrumban-Backend-V2

**Versão:** 1.6
**Última atualização:** 2026-07-09 (Plan Pontualidade/Margem de Atraso — decisão híbrida client-side + endpoint agregado; compactação de memória)

**Indice de topicos:**
- [referencia-v2-nucleo.md](referencia-v2-nucleo.md) — Núcleo estável: 3 Pilares, 17 tabelas, mapa das 17 fases, 14+ ADRs, conflitos do seed, faixas do seed, stack técnico, docs-chave, top 5 riscos, notas gerais. Consultar sempre que faltar contexto estrutural.
- [historico-plans-f2-f6-bookmarks.md](historico-plans-f2-f6-bookmarks.md) — Histórico de plans F2/F3/F6/Bookmarks/Remoção Sprint + padrões estabelecidos em F2.
- [client-side-vs-endpoint-agregacao.md](client-side-vs-endpoint-agregacao.md) — Critério: dado já no array carregado → client-side; recorte multi-usuário/multi-projeto sem teto de volume → endpoint agregado (Prisma direto, sub-rota do controller de domínio). `@Max(100)` é hard cap real; subir `limit` já quebrou produção 1x.
- [mcp-scope-catalog.md](mcp-scope-catalog.md) — ADR-V2-068: catálogo 6 scopes (tasks:read/write, notifications:read/write, projects:write, executions:create), privilege escalation via role, grandfathering one-shot.
- [phase-hierarchy-pattern.md](phase-hierarchy-pattern.md) — Padrao de hierarquia auto-referencial via idPai em DTask para Fases/Blocos (ADR-V2-047).
- [dados-json-merge-conventions.md](dados-json-merge-conventions.md) — Merge seletivo (DProject) vs raso (DTask) em `dados Json`; onde responses expoem; idClasses -350..-353.
- [dvincula-fk-exige-dentidade.md](dvincula-fk-exige-dentidade.md) — DVincula FK exige DEntidade nos 2 lados; NUNCA gravar DProject.chave; usar DEntidade-espelho PROJECT_REF (ADR-V2-058, plan fk-systemic-fix).

**Atualizar:** ao concluir cada task. Limite ~140 linhas neste índice; detalhe sempre em `agent-memory/strategist/<topic>.md`.

---

## INSTRUÇÕES DE USO

- Consultar **ANTES** de criar qualquer plan — abrir `referencia-v2-nucleo.md` para contexto estrutural (3 Pilares, 17 tabelas, fases, ADRs, seed).
- Registrar decisões novas ao concluir cada task (novo arquivo de tópico + linha no índice).
- Manter atualizado (remover obsoleto).
- Memory é **injetada automaticamente** no system prompt via `memory: project` no frontmatter.

---

## ESTADO ATUAL

**Scrumban-Backend-V2** é a refundação canônica do Scrumban legado, sob o template Devari-Core.
**Repositório:** `/Users/devaritecnologia/Documents/Benedito/Scrumban-Backend-V2/`
**Estado:** F8 Task#2 (Search — Bloco U) — plan entregue. Aguardando Implementer. Após APPROVED, Documenter fecha F8 completa (S+T+U) num único ciclo.
**Task cross-repo em paralelo:** Plan Pontualidade/Margem de Atraso entregue em `Scrumbam-Frontend-V2/workspace/plans/plan-pontualidade-margem-atraso-task8.md` — decisão híbrida (client-side p/ "por usuário logado"; endpoint novo `GET /tasks/projects/:projectId/punctuality` no Backend-V2 p/ "por projeto", sub-rota do `TasksController`, seguindo precedente de `PhaseMetricsService`).
**Cronograma:** 24 semanas (otimista 20, pessimista 29). **Família depende. Corda justa. Sem afrouxar.**

Regras críticas não-negociáveis (ZERO tabela nova, Engine só em DPedido -300,
Seed primeiro, endpoints genéricos reusados, score gate ≥7.0, escopo =
Scrumban-hoje) — ver `referencia-v2-nucleo.md` para o detalhe completo.

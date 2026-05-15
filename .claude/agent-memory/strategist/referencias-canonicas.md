# Strategist — Referências Canônicas

Conteúdo migrado de `MEMORY.md` em 2026-05-15 para manter o índice ≤ 200 linhas. Estes blocos são reference-style (apontam para verdade canônica em outros docs) e podem ser carregados sob demanda.

---

## Conflitos Resolvidos no §3.3 do Plano-Mestre

| Conflito original | Resolução |
|-------------------|-----------|
| -152 AGENT vs ORGANIZATION | AGENT virou -156; ORGANIZATION fica -152 |
| -491 EXECUCAO_CLAUDE vs WEBHOOK_ATTEMPT vs AGENT_STATUS_OFFLINE | Execution sai p/ -300..-303; -491 = WEBHOOK_ATTEMPT; AGENT_STATUS p/ -510..-513 |
| -493 TELEGRAM_MSG_IN vs AGENT_STATUS_NEVER_CONNECTED | TELEGRAM_MSG_IN fica -493; AGENT_STATUS deslocado p/ -510..-513 |
| -497 PROJECT_DELETED vs EXEC_STATUS_APPROVED vs MCP_CALL | TASK_CREATED = -497; PROJECT_LIFECYCLE = -499 (renomeado por ADR-V2-027); MCP_CALL = -495; EXEC_STATUS p/ -514..-522. F7 Task#1 adiciona AUDIT_GENERIC = -489 (ADR-V2-026). Total seed: 131 DClasses. |
| -301..-303 EXEC_LOW/MED/HIGH vs EXECUTION_REFACTOR/FIX/FEATURE | Risk via idClasse prevalece (DVFS diferentes); categoria operacional vai em `dados.category` |
| -460 WEBHOOK_CONFIG vs -470 WEBHOOK | -470..-479 reservada para configs/tokens consolidada |

---

## Documentação-Chave V2

| Necessita | Abrir |
|-----------|-------|
| Visão geral, decisões, gates | `docs/plano/00-PLANO-MESTRE.md` |
| Detalhe schema, seed, endpoints, auth | `docs/plano/01-FUNDACAO.md` |
| Detalhe Engine, OperacaoExecucaoClaude, eventos, flow metrics | `docs/plano/02-DOMINIO-ENGINE.md` |
| Detalhe Telegram, MCP, Webhooks, Automation | `docs/plano/03-INTEGRACOES.md` |
| Detalhe testes, security, migration, runbook, launch | `docs/plano/04-HARDENING-HANDOFF.md` |
| Diagnóstico do que foi corrigido | `docs/auditoria/00-AUDITORIA-CONSOLIDADA.md` |
| Regras canônicas (auto-injetadas) | `.claude/rules/devari-*.md` |
| Schema das 17 tabelas | `Devari-Core/RELATORIO-DEVARI-PARTE-1-BACKEND-CORE.md` |
| Capacidades a replicar | `Scrumbam-Backend/docs/SYSTEM-OVERVIEW.md` |
| Contrato HTTP a manter (128 endpoints) | `Scrumbam-Backend/docs/API-CONTRACT.md` |

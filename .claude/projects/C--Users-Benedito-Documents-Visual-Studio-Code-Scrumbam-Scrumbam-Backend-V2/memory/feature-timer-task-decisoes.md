---
name: feature-timer-task-decisoes
description: "Feature timer de tempo por tarefa (gestor ve quanto tempo levou): decisoes de produto do CEO + estado atual da fundacao (workSessions ja existe)"
metadata:
  node_type: memory
  type: project
  originSessionId: 7518dae0-2c40-47b7-b88a-b5fb3e903512
---

Feature pedida pelo CEO (2026-06-01): usuario clica numa task, abre o sidebar (drawer ja existe), e tem um timer com botoes play/pause/resume/stop do tempo trabalhando na task. Tempo salvo no banco no STOP **e tambem no PAUSE** (anti-fraude: nao confiar so no relogio do navegador, total = soma server-side de endedAt-startedAt). Dado-alvo do gestor: quanto tempo alguem levou desenvolvendo a task.

**Fundacao que JA existe (nao reconstruir):**
- Backend: tipo canonico `WorkSession { startedAt, endedAt?, agentId? }` em `src/tasks/schemas/task-dados.schema.ts`; persistido em `DTask.dados.telemetry.workSessions[]` (ZERO tabela nova, ADR-V2-001). `tasks.service.ts:1106-1130` JA abre workSession ao mover p/ EXECUTING e fecha ao mover p/ DONE (calcula cycleTime/leadTime).
- Frontend: `src/components/tasks/task-detail-drawer.tsx` (sidebar ao clicar na task) JA existe, com padrao visual de painel+botao Play (`AiExecutionPanel`).

**Decisoes do CEO (produto):**
1. **Escopo do tempo: POR USUARIO** (cada um seu acumulado; gestor ve "Fulano 2h, Beltrano 45min"). Aproveita o campo `agentId`/userId na WorkSession.
2. **Gatilho: botao no SIDEBAR** (drawer existente), reaproveitando design — NAO na grade por enquanto.
3. **Automatico vs manual:** automatico (workSession atrelado a status EXECUTING/DONE) fica RESTRITO a execucao de IA; manual (play/pause/resume/stop) e para HUMANO. Os dois NAO podem baguncar as metricas de cycle-time existentes — separar as fontes.
4. **Concorrencia: 1 timer por task rodando POR ENQUANTO** (nao simultaneo). Reavaliar 2 timers simultaneos so se mostrar necessario.
5. **Coluna na grade (2026-06-01):** CEO quer o tempo tambem como COLUNA na grade Blocos ("onde status/nome/prioridade ficam"). Esclarecido que "coluna" = 2 camadas: VISUAL (tableFields builtin) + DADO (dados.telemetry). Decidido: dado fica em `dados.telemetry.manualTimers[]` (igual status ja usa `dados.v3` — JSON em JSON e o padrao do sistema, NAO coluna fisica, ADR-V2-001) + coluna builtin READ-ONLY "Tempo gasto" em tableFields mostrando o total. CEO REJEITOU coluna fisica no banco (perderia por-usuario/por-sessao + violaria ADR-V2-001). Controle play/pause/stop fica no sidebar; coluna so exibe total. Coluna entra como fase adicional do plano.

**How to apply:** mexe no contrato canonico de telemetria (dados.telemetry) -> exige ADR-V2-XXX + plano FASEADO (Strategist propoe). Padrao: Implementer -> Reviewer >=8 por fase, aval visual do CEO entre fases ([[feedback-frontend-design-intocavel]]). Aritmetica de tempo SEMPRE server-side (anti-fraude). Cuidado para nao conflitar com o open/close automatico de workSession ja existente no tasks.service. Relacionado: [[feedback-frontend-design-intocavel]].

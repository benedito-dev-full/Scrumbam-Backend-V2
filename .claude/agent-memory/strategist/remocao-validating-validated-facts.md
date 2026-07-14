---
name: remocao-validating-validated-facts
description: Fatos levantados para o plano de remoção de VALIDATING/VALIDADO do enum V3 Intentions — onde os 9 status vivem hoje, por que não há ADR próprio, e o mapeamento de CANCELLED/DISCARDED como decisão separada.
metadata:
  type: project
---

## Contexto

CEO decidiu (2026-07-14) remover `VALIDATING`/`VALIDATED` do fluxo V3 Intentions (fica
INBOX/READY/EXECUTING/DONE/FAILED/CANCELLED/DISCARDED = 7 estados). Motivo original (Claude
Code confirmar antes de aceitar como concluído) foi ouvido e rejeitado: "se precisar a gente
volta com essa depois". `CANCELLED`/`DISCARDED` estão na mira (virar hard-delete de task) mas
essa segunda parte NÃO tem aval — só mapeamento preliminar, decisão separada.

Plano completo: `workspace/plans/plan-core-remocao-validating-validated-task1.md`.

## Achados-chave

- **Não existe ADR-V2 próprio para os "9 estados V3"** — foram definidos direto no
  plano-mestre/01-FUNDACAO/02-DOMINIO-ENGINE (seed F1, DTabela idClasse -441..-449, pai -440
  STATUS_INTENTION_V3). A remoção agora vira ADR-V2-080 (próximo nº livre em 2026-07-14).
- **Não há coluna/enum de banco** — `DTask.idStatus` é `BigInt?` FK solta para `DTabela`.
  Remoção é só: linhas de seed (`classes.seed.ts` + `seed-bootstrap.service.ts` per-projeto) +
  strings hardcoded no código. ZERO migration destrutiva de schema.
- **Enum `TaskStatus` duplicado em ~9 arquivos de código** (fora docs/testes): DTOs,
  `tasks-state-machine.ts`, `tasks.service.ts` (`STATUS_TO_TABELA_CLASSE`), 4 arquivos MCP
  tools + 5 arquivos `tool-capabilities` (unificação Nexus⇄MCP do ADR-V2-079) — nenhuma fonte
  única compartilhada. Débito técnico anotado (não corrigido nesta task): centralizar
  `V3_STATUS_CODES`.
- **`overdue.util.ts`** hoje trata `VALIDATING`/`VALIDATED` como "concluído" (não "aberto") —
  `COMPLETED_STATES` inclui os 3. Pós-remoção vira só `DONE`. `doneAt` já persiste
  corretamente, então mover órfãos para `DONE` (se existirem) não distorce métricas.
- **Precedente estrutural a seguir:** ADR-V2-060 (hard-delete Sprint) — remoção em fases
  pequenas, 1 commit por fase, script de saneamento de dados órfãos (`cleanup-*-orphans.ts`,
  dry-run default) rodado pelo CEO no deploy, ADR formaliza ao final referenciando os ADRs
  correlatos, range de chave liberado documentado (-448/-449 aqui, análogo ao -400..-419 lá).
- **Atualização 2026-07-14 (mesmo dia, pós-publicação do plano):** CONFIRMADO qualitativamente
  pelo CEO — existem tasks reais hoje em VALIDATING (visto na tela, aba "Atribuídas a mim",
  filtro "Validando", ≥2 tasks visíveis, "15 abertas" no contexto do filtro). Fase 0 deixou de
  ser "verificação pendente" e virou "preparar script de saneamento obrigatório" (o script não
  depende do count exato para existir). Comando confirmado para obter o count exato via Prisma
  direto (NÃO via JOIN em DTabela por nome — essa foi a causa dos erros anteriores do
  coordenador): `dTask.findMany({ where: { idStatus: { in: [-448,-449] }, excluido: false } })`.
  **Regra de saneamento fixada pelo CEO, sem exceção:** `idStatus IN (-448,-449) → UPDATE
  idStatus = -444` (direto para DONE, sem estado intermediário, sem revisão caso a caso).
  **Ordem de deploy crítica:** script `--apply` roda ANTES do seed novo (que remove -448/-449)
  ir para produção — nunca na ordem inversa, senão as tasks confirmadas ficam órfãs/invisíveis.

## CANCELLED/DISCARDED (mapeamento preliminar, NÃO implementar)

Natureza diferente: task já tem soft-delete (`excluido`, Task #1 cascade delete). Migrar para
"delete" ao invés de status muda semântica de flow-metrics/CFD (task desaparece do gráfico, não
vira barra), overdue.util (terminalStates), list-block-tasks (DONE_STATUS/FAILED_STATUS). Maior
em escopo que VALIDATING/VALIDATED. Pergunta em aberto pro CEO: hard delete (irreversível, como
Sprint) ou soft delete (`excluido=true`, reversível)? Precisa de ADR-V2-08X próprio, separado.

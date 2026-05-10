# ADR-V2-026 — Adicao da DClasse `-489 AUDIT_GENERIC` para audit trail sem categoria semantica especifica

**Status:** Aceito
**Data:** 2026-05-09
**Decisores:** Strategist (Plano F7 Task#1 — proposta) — ratificada formalmente pelo CEO em 2026-05-09
**Tags:** `#dominio-engine` `#pilar-3` `#eventos` `#fase-F7` `#fase-F1-update`

---

## Contexto e Problema

A F4 entregou `src/common/services/audit.service.ts` como **stub MVP** que escrevia em `DEvento` com `idClasse=-501` (USER_LOGIN) qualquer evento sem categoria semantica especifica — incluindo `email.sent`, `email.failed`, `system.health.check`, `system.audit.log`. Esse uso e **semanticamente errado**: -501 USER_LOGIN existe para auditar logins, nao para servir de fallback genérico.

A F7 Task#1 vai eliminar esse stub e instalar o `EventProducerService` real com `AuditLogConsumer` que mapeia cada `event.type` para a `idClasse` correta da DEvento. Surge entao a questao:

**Onde gravar eventos que nao tem `idClasse` semantica especifica no seed F1 (faixa `-490..-501`)?**

Tipos afetados:
- `email.sent`, `email.failed` (modulo email — F4)
- `system.health.check`, `system.audit.log` (F8/F14 futuros)
- Eventos de fallback que possam surgir em F8+ sem categoria propria

O seed F1 atual cobre as categorias **semanticas conhecidas** (`-490 NOTIFICATION`, `-491 WEBHOOK_ATTEMPT`, `-492 AGENT_HEARTBEAT`, `-493 TELEGRAM_MSG_IN`, `-494 TELEGRAM_MSG_OUT`, `-495 MCP_CALL`, `-496 EXECUTION_LOG`, `-497 TASK_CREATED`, `-498 TASK_STATUS_CHANGED`, `-499 PROJECT_DELETED`, `-500 ORG_DELETED`, `-501 USER_LOGIN`), mas nao tem **fallback canonico**.

O **Plano Mestre `docs/plano/00-PLANO-MESTRE.md` §3.3 (Resolucao de Conflitos)** EXIGE que adicoes/renomeacoes de DClasses na faixa de eventos sejam acompanhadas por ADR formal antes de alterar o seed F1. Esta ADR cumpre esse requisito.

---

## Alternativas Consideradas

### Alternativa A — Adicionar `-489 AUDIT_GENERIC` (filho de -3 EVENTOS) — **escolhida**

Adicionar uma DClasse generica de fallback no seed F1, na posicao `-489` (logo antes da faixa de auditoria semantica `-490..-501`), filha de `-3 EVENTOS` (mantem coerencia hierarquica).

**Pros:**
- **Semantica clara:** eventos sem categoria conhecida vao para `AUDIT_GENERIC` em vez de poluir DClasses especificas (USER_LOGIN). Reviewer e analytics conseguem distinguir audit semantico de fallback.
- **Custo trivial:** 1 linha adicional no `prisma/seeds/classes.seed.ts` + reseed idempotente (ADR-V2-020). +1 entry na tabela do Mestre §3.2.
- **Discoverabilidade:** quando alguem fizer `SELECT DISTINCT idClasse FROM DEvento`, vera explicitamente `-489 AUDIT_GENERIC` e entendera que sao eventos sem categoria. Se -501 USER_LOGIN aparecer com `descricao='email.sent'`, e um sintoma de bug.
- **Migracao futura:** quando F14 quiser dar categoria semantica para `email.sent` (ex: `-486 EMAIL_LOG`), basta criar a DClasse e migrar — registros antigos em `-489` ficam como audit historico.
- **Alinhada com Mestre §3.3:** "C prevalece. Faixa -470..-479 reservada para configs/tokens consolidada" — mesma logica de consolidacao por categoria. AUDIT_GENERIC consolida o "outros".

**Contras:**
- Seed cresce de 130 para 131 DClasses. Custo desprezivel.
- DClasse generica pode ser usada como muleta — equipe pode parar de criar DClasses semanticas. **Mitigacao:** Reviewer rejeita PRs que usem `-489` para tipos com categoria semantica obvia (ex: `task.created` deve ir para `-497`, nao `-489`). Documentar essa regra no `AuditLogConsumer`.

### Alternativa B — Manter `-501 USER_LOGIN` como fallback genérico (status quo do stub F4)

**Pros:**
- Zero alteracao no seed.

**Contras:**
- **Semanticamente errado:** -501 USER_LOGIN nao serve para `email.sent`. Polui audit trail de logins com lixo.
- **Quebra discoverabilidade:** SELECTs em -501 retornam mistura de logins e eventos genericos.
- Perpetua o débito tecnico do stub que justamente F7 Task#1 vem corrigir.
- Reviewer da F7 Task#1 NAO pode aceitar mapeamento `email.sent → -501` no `AuditLogConsumer` — viola devari-event-naming.md e a propria razao da Task existir.

**Rejeitada.**

### Alternativa C — Granularidade alta: criar DClasses especificas (-486 EMAIL_LOG, -487 SYSTEM_LOG, etc.)

Criar 3-4 DClasses dedicadas: `-486 EMAIL_SENT`, `-487 EMAIL_FAILED`, `-488 SYSTEM_LOG`, etc.

**Pros:**
- Maxima granularidade semantica.
- Analytics e queries diretas por DClasse.

**Contras:**
- **Crescimento descontrolado do seed:** cada novo modulo (F8 reports, F14 hardening) acrescentaria ~3-5 DClasses para audits secundarios. Em 6 meses, faixa `-480..-489` estaria saturada com DClasses de baixo valor.
- **Decisao prematura:** ainda nao se sabe se `email.sent` justifica DClasse propria. Se justificar no futuro, e trivial criar (com ADR proprio) e migrar registros de `-489 AUDIT_GENERIC`.
- **Viola Mestre §3.3 (consolidacao):** "C prevalece. Faixa -X..-Y reservada para Z **consolidada**" — Mestre prefere consolidar. Granularidade alta vai contra esse principio.
- Cada DClasse adicional precisa de ADR proprio (Mestre §3.3) — overhead alto.

**Rejeitada para esta task.** Pode ser revisada em F14 hardening se houver necessidade clara (ex: SLA por tipo de email, dashboard dedicado).

### Alternativa D — Emitir apenas eventos cobertos pelo seed (proibir fallback)

Forcar que toda emissao de evento mapeie 1:1 para uma DClasse semantica. Eventos sem categoria sao **proibidos** (Producer lanca `UnknownEventType`).

**Pros:**
- Zero "lixo" no audit trail.

**Contras:**
- Quebra emissao em runtime para `email.sent`, `system.health.check` (todos atualmente em uso pelo stub F4).
- Forca decisao prematura de granularidade (alternativa C) — apenas joga o problema para outro lugar.
- Producer ficaria com lista hardcoded mais restritiva que `EVENT_TYPES`, gerando atrito de desenvolvimento.

**Rejeitada.**

---

## Decisao

**Adotada Alternativa A.** Adicionar `-489 AUDIT_GENERIC` no seed F1 e atualizar o Plano Mestre §3.2.

**Mudancas necessarias:**

1. **`prisma/seeds/classes.seed.ts`** — adicionar uma linha na secao "Eventos de auditoria" (entre as linhas que atualmente declaram `-488` (se houver) e `-490 NOTIFICATION`):

```ts
esp(-489, 'AUDIT_GENERIC', 'Audit generico (fallback sem categoria semantica)', -3),
```

2. **`docs/plano/00-PLANO-MESTRE.md` §3.2** — adicionar linha na tabela "DEvento — auditoria + eventos":

```
| -489 | AUDIT_GENERIC | Audit generico (fallback) | -3 |
```

3. **`workspace/plans/plan-eventos-canonicos-f7-task1.md` §4.4** — atualizar mapa `TYPE_TO_CLASSE` no `AuditLogConsumer`:

```ts
// Fallbacks → -489 AUDIT_GENERIC
'email.sent':                 BigInt(-489),
'email.failed':                BigInt(-489),
'system.health.check':         BigInt(-489),
'system.audit.log':            BigInt(-489),
// FALLBACK_CLASSE quando type nao mapeado:
private readonly FALLBACK_CLASSE = BigInt(-489); // AUDIT_GENERIC
```

4. **Reseed** — executar `npm run seed:classes` (idempotente via UPSERT, ADR-V2-020). Total esperado: **131 DClasses** apos reseed (era 130).

5. **Hook de validacao** (a verificar — se existir hook que conta DClasses esperadas, atualizar threshold).

---

## Consequencias

### Positivas

- **Audit trail consistente:** eventos genericos tem casa propria. Queries `SELECT * FROM DEvento WHERE idClasse=-501` retornam SO logins (limpo).
- **Forward-compat:** se F14 decidir criar `-486 EMAIL_LOG`, basta criar e migrar registros antigos de -489. Nao quebra historico.
- **Zero impacto em codigo de runtime existente:** o stub F4 sera substituido por `EventProducerService` na propria Task#1 — qualquer `auditService.log` migrado vai naturalmente para o mapeamento canonico do `AuditLogConsumer`.
- **Custo trivial:** +1 DClasse, +1 linha no Mestre, +4 linhas no `TYPE_TO_CLASSE`.

### Negativas (mitigadas)

- **Risco de muleta:** equipe pode usar `-489` quando devesse criar DClasse semantica. **Mitigacao:** Reviewer rejeita PRs que usem `-489` para tipos cobertos pelo seed (ex: `task.created` deve ir para -497). Documentar regra clara no `audit-log.consumer.ts` (JSDoc).

### Neutras

- Numero total de DClasses do V2 sobe de 130 para 131. Plano Mestre §3.2 ja esperava expansao incremental (faixa de eventos é planejada para crescer com novas categorias semanticas).

---

## Implementacao

**Quem implementa:** Implementer da F7 Task#1 (depois de aprovacao formal desta ADR pelo CEO).

**Sequencia (Fase 2 do plano da Task#1):**

1. Editar `prisma/seeds/classes.seed.ts` (adicionar linha `-489`).
2. Atualizar `docs/plano/00-PLANO-MESTRE.md` §3.2 (linha na tabela de eventos).
3. Atualizar `agent-memory/strategist/MEMORY.md` (total de DClasses 130 → 131).
4. Rodar `npm run seed:classes` (UPSERT idempotente, ADR-V2-020).
5. Validar no banco: `psql -c "SELECT chave, codigo, nome FROM \"DClasse\" WHERE chave = -489;"` retorna 1 linha.
6. Atualizar `agent-memory/strategist/MEMORY.md` na seção "DEvento — auditoria + eventos" (faixa -490..-509 vira -489..-509).
7. Em sequencia, implementar `AuditLogConsumer` com mapeamento canonico (Fase 5 do plano).

**Hook que valida:** `validate-canonical-tables.sh` (nenhuma tabela nova — conforme; apenas DClasse adicional). Se houver hook contando DClasses (130 esperadas), atualizar threshold.

---

## Referencias

- `docs/plano/00-PLANO-MESTRE.md` §3.2 (tabela DEvento) e §3.3 (regra de adicao de DClasses requer ADR).
- `docs/plano/02-DOMINIO-ENGINE.md` §7.5 (sub-plano F7 — não previa AUDIT_GENERIC, esta ADR supre a lacuna).
- `workspace/plans/plan-eventos-canonicos-f7-task1.md` §3.3 (Pilar 3 — propostas de adicoes), §4.4 (audit-log.consumer.ts), §9 Decisao #2.
- `src/common/services/audit.service.ts` (stub F4 que sera removido pela Task#1).
- ADR-V2-008 (DEvento substitui DNotification/DWebhook) — esta ADR complementa o mapeamento canonico.
- ADR-V2-020 (UPSERT idempotente do seed) — viabiliza a alteracao sem perda de dados.
- `prisma/seeds/classes.seed.ts:172-177` (linhas onde sera inserida a nova entrada).

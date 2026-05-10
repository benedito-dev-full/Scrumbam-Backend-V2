# ADR-V2-031 - Webhooks scoped por org

**Status:** Aceito
**Data:** 2026-05-10
**Decisores:** Strategist Agent V2; implementacao aprovada pelo Reviewer Agent V2
**Tags:** `#V2` `#fase-F7` `#eventos` `#webhooks` `#multi-tenant`

---

## Contexto e Problema

Webhooks outbound precisam respeitar isolamento multi-tenant. Um evento de task ou project nao pode acionar configuracoes de outra organizacao.

Como `WebhookConsumer` e disparado por eventos internos, ele precisa descobrir o `orgId` a partir do payload sem endpoint/controller novo.

## Alternativas Consideradas

### Opcao A - Configs por organizacao em `DTabela.idLocEscrituracao` (escolhida)

**Pros:** isolamento tenant explicito, consulta simples, alinhado ao uso canonico de `idLocEscrituracao`.

**Contras:** eventos sem org descobrivel sao ignorados para webhook.

### Opcao B - Webhooks globais

**Pros:** simples para administracao.

**Contras:** risco de vazamento entre orgs e contrato incompativel com Scrumban multi-tenant.

### Opcao C - Configs por project

**Pros:** granularidade maior.

**Contras:** duplica configuracoes entre projetos e dificulta administracao por org.

## Decisao

`WebhookConsumer` resolve organizacao nesta ordem:

1. `payload.orgId`, `payload.organizationId` ou `payload.idOrg`;
2. `payload.projectId`/`idProject` via `DProject.idEstab`;
3. `payload.taskId`/`idTask` via `DTask.project.idEstab`.

Sem org descobrivel, o consumer faz skip com `logger.debug` e nao falha o pipeline.

## Consequencias

**Positivas:** webhooks ficam isolados por organizacao e eventos incompletos nao quebram audit/notification.

**Negativas:** emissores futuros devem incluir `orgId`, `projectId` ou `taskId` para permitir dispatch outbound.

## Implementacao

- Fase V2: F7 Task #2
- Codigo: `src/eventos/consumers/webhook.consumer.ts`
- Plan vinculado: `workspace/plans/plan-eventos-consumers-f7-task2.md`
- Impl notes: `workspace/implementations/impl-eventos-consumers-f7-task2.md`
- Review: `workspace/reviews/review-eventos-consumers-f7-task2.md`
- Resultado: APPROVED 8.4/10

## Referencias

- ADR-V2-003 - RBAC via DVincula
- ADR-V2-028 - Webhook config em DTabela -470

# ADR-V2-028 - Webhook config em DTabela -470

**Status:** Aceito
**Data:** 2026-05-10
**Decisores:** Strategist Agent V2; implementacao aprovada pelo Reviewer Agent V2
**Tags:** `#V2` `#fase-F7` `#eventos` `#webhooks` `#pilar-3`

---

## Contexto e Problema

F7 Task #2 precisava ativar `WebhookConsumer` sem criar tabelas, migrations, endpoints ou seeds. O legado possui comportamento de webhook, mas o V2 segue ADR-V2-001: somente as 17 tabelas canonicas podem existir.

A configuracao de webhooks precisava de uma casa canonica para armazenar URL futura, lista de eventos e flags de ativacao sem antecipar a implementacao HTTP real de F12.

## Alternativas Consideradas

### Opcao A - `DTabela.idClasse=-470` (escolhida)

**Pros:** usa tabela canonica, respeita seed existente, permite `metaDados.events`, escopo por `idLocEscrituracao` e CRUD futuro via modulo proprio ou endpoint generico.

**Contras:** exige convencao documental forte para formato do JSON.

### Opcao B - Criar tabela `DWebhookConfig`

**Pros:** schema dedicado e constraints explicitas.

**Contras:** viola ADR-V2-001 e o plano mestre; exigiria migration fora do escopo.

### Opcao C - Guardar config em variaveis de ambiente

**Pros:** simples para MVP.

**Contras:** nao suporta multi-org, CRUD futuro, auditoria ou isolamento tenant.

## Decisao

Escolhemos `DTabela.idClasse=-470` como configuracao canonica de webhook outbound. `WebhookConsumer` busca configs ativas por `idLocEscrituracao=<orgId>`, le `metaDados.events` e delega para dispatcher injetado.

## Consequencias

**Positivas:** zero tabela nova, multi-org natural, compativel com endpoint generico e com dispatcher real futuro.

**Negativas:** o shape de `metaDados` precisa continuar documentado e testado ate F12 formalizar HMAC/retry/auto-disable.

## Implementacao

- Fase V2: F7 Task #2
- Codigo: `src/eventos/consumers/webhook.consumer.ts`
- Plan vinculado: `workspace/plans/plan-eventos-consumers-f7-task2.md`
- Impl notes: `workspace/implementations/impl-eventos-consumers-f7-task2.md`
- Review: `workspace/reviews/review-eventos-consumers-f7-task2.md`
- Resultado: APPROVED 8.4/10

## Referencias

- ADR-V2-001 - 17 tabelas canonicas
- ADR-V2-008 - DEvento substitui DNotification/DWebhook
- ADR-V2-031 - Webhooks scoped por org

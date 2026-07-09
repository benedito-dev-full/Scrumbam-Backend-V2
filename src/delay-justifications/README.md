# Delay Justifications — Justificativa de Atraso de Tarefas (Fase 1: Captura)

**ADR:** ADR-V2-070 (proposto) · **Storage:** `DEvento` idClasse=`-503` ·
**Vocabulário:** `DClasse` `-530..-537` · **Zero tabela nova** (ADR-V2-001).

Fecha o ciclo da aba "Em atraso": além de MOSTRAR que uma tarefa atrasou,
CAPTURA o **porquê** (radio de categoria obrigatório + texto opcional).

---

## Modelo canônico (Pilares)

| Pilar | Aplicação aqui |
|-------|----------------|
| **1 — Engine** | **NÃO se aplica.** Não é transação financeira (DPedido/DTitulo/DMov*). Justificativa é fato de auditoria → `DEvento` via Service + Prisma direto (padrão idêntico ao TASK_COMMENT `-507`). |
| **2 — Endpoints genéricos** | O **radio de motivos reusa `GET /classes?idPai=-530`** (zero controller novo). A escrita/leitura têm lógica (RBAC, supersede) → controller próprio justificado. |
| **3 — Seed** | 9 DClasses novas (abaixo). Bloqueante — seed primeiro. |

### DClasses semeadas (`prisma/seeds/classes.seed.ts`)

| chave | codigo | nome | idPai | agrup. |
|-------|--------|------|-------|--------|
| `-503` | `DELAY_JUSTIFICATION` | Justificativa de atraso de tarefa | `-3` (Eventos) | false |
| `-530` | `DELAY_REASON` | Motivo de atraso (agrupador) | `-51` (Tabelas) | **true** |
| `-531` | `DELAY_DEPENDENCY` | Dependência não entregue | `-530` | false |
| `-532` | `DELAY_EXTERNAL_BLOCK` | Bloqueio externo / aguardando cliente | `-530` | false |
| `-533` | `DELAY_UNDERESTIMATED` | Subestimei o esforço | `-530` | false |
| `-534` | `DELAY_PRIORITY_SHIFT` | Prioridade mudou no meio | `-530` | false |
| `-535` | `DELAY_TECHNICAL` | Problema técnico / bug | `-530` | false |
| `-536` | `DELAY_OVERLOAD` | Sobrecarga (tarefas demais) | `-530` | false |
| `-537` | `DELAY_OTHER` | Outro | `-530` | false |

Total do seed passou de 157 → **166** DClasses.

---

## Payload em DEvento (-503)

Uma linha por **versão** da justificativa:

| Campo DEvento | Conteúdo |
|---------------|----------|
| `idClasse` | `-503` |
| `idEntidade` | **autorId** (`DEntidade` do responsável/admin) → FK válida (ADR-V2-058) + índice p/ "group by usuário" |
| `identificadorExterno` | **taskId** (string, SEM FK — taskId NÃO cabe na FK `idEntidade→DEntidade`) |
| `descricao` | texto livre (opcional) |
| `metaDados` | `{ taskId, motivoClasse, texto, projetoId, autorId, delayDays, delayKind, version, supersededBy }` |

**"1 vigente + histórico" via supersede:** editar marca a linha anterior
`excluido=true` (+ `supersededBy = novaChave`) e **insere** a nova — tudo em
`$transaction`. A **vigente é a única `excluido=false`** da task (índice
`(idClasse, identificadorExterno)` resolve a leitura). O histórico é o
conjunto de todas as linhas (Fase 2).

> **REGRA (ADR-V2-058):** taskId vai em `identificadorExterno`, NUNCA em
> `idEntidade`. Colocar taskId em `idEntidade` = 500 por violação de FK.

---

## Endpoints (Fase 1)

| Método | Rota | Autorização |
|--------|------|-------------|
| `GET` | `/classes?idPai=-530` | JWT — radio de motivos (**reuso**, Pilar 2) |
| `POST` | `/tasks/:taskId/delay-justification` | assignee **OU** org ADMIN (-161) |
| `GET` | `/tasks/:taskId/delay-justification` | assignee **OU** org ADMIN (-161) |
| `GET` | `/me/delay-justifications/pending-count?projectId=` | JWT (sempre `/me`) |

`POST` body: `{ "motivoClasse": "-535", "texto": "opcional" }`
(`motivoClasse` ∈ `-531..-537`).

### RBAC (CEO decisões 1 e 3 — TRAVADAS)

- **Responsável (assignee)** justifica/edita a PRÓPRIA tarefa e lê a própria vigente.
- **Org ADMIN (`DVincula -161`)** — e SOMENTE ele — lê/edita de terceiros.
- **Project MANAGER (`-171`) NÃO autoriza nada aqui.** Membro comum NÃO vê
  justificativa de terceiros. Não-assignee/não-admin → **403**.
- A org-alvo do ADMIN é a **org dona do projeto** (`DProject.idEstab`), não a
  "org ativa" do JWT — garante isolamento de tenant (admin da org A nunca
  acessa tarefa da org B). Consulta a org só quando o requester NÃO é o
  assignee (curto-circuito → custo zero no caminho comum).

---

## Critério "atrasada" (`overdue.util.ts`)

Por **DIA DE CALENDÁRIO** em `America/Sao_Paulo` (via `TimezoneService`),
espelhando o frontend. Aplica a atraso em aberto E a concluída-com-atraso:

- **`OPEN`** — estado não-terminal com `dueDate` no passado (`hoje > prazo`).
- **`COMPLETED_LATE`** — estado concluído (`DONE`/`VALIDATING`/`VALIDATED`) e
  **dia de conclusão > dia do prazo**.

**Dia de conclusão** (cascata CEO decisão 2, da fonte mais confiável à de
último recurso): `dados.telemetry.doneAt` → `dados.v3.movedAt` (se estado
terminal) → `atualizadoEm`.

`pending-count` = tarefas do usuário (assignee) atrasadas (qualquer kind) sem
DEvento -503 vigente. **2 queries, ZERO N+1.**

---

## Evento emitido

Após persistir, emite `delay.justified` (`EventProducerService`, APÓS commit —
sem evento órfão). Reusa `-489 AUDIT_GENERIC` no `TYPE_TO_CLASSE` do audit
consumer (cópia de auditoria — o painel conta só `-503`, sem double-count).

---

## Fase 2 — Painel admin + histórico

### Endpoints

| Método | Rota | Autorização |
|--------|------|-------------|
| `GET` | `/tasks/:taskId/delay-justification/history` | assignee **OU** org ADMIN (-161) |
| `GET` | `/reports/delay-reasons?groupBy=&userId=&projectId=&motivoClasse=&from=&to=` | **org ADMIN (-161) SOMENTE** |

#### `GET /tasks/:taskId/delay-justification/history`

Lista TODAS as versões da justificativa daquela task (vigente + superseded),
ordenadas por `version` desc. Mesma autorização da leitura da vigente (Fase 1):
assignee OU org ADMIN. Resposta:

```json
{
  "taskId": "777",
  "total": 2,
  "items": [
    { "id": "9002", "version": 2, "isVigente": true,  "supersededBy": null,   "motivoClasse": "-535", "texto": "...", "autorId": "42", "autorNome": "Maria", "delayDays": 3, "delayKind": "OPEN", "createdAt": "..." },
    { "id": "9001", "version": 1, "isVigente": false, "supersededBy": "9002", "motivoClasse": "-531", "...": "..." }
  ]
}
```

#### `GET /reports/delay-reasons` (painel admin — org ADMIN SOMENTE)

Agrega justificativas **vigentes** (`DEvento` -503, `excluido=false`) da
organização, por **motivo / usuário / projeto**, com filtros. **1 query de
agregação (`$queryRaw`) + 1 query batch de rótulos — ZERO N+1.**

**Query params** (todos opcionais exceto `groupBy`):

| Param | Tipo | Descrição |
|-------|------|-----------|
| `groupBy` | `motivo \| usuario \| projeto` | **obrigatório** — dimensão do ranking |
| `userId` | string numérica | filtro por autor (DEntidade.chave) |
| `projectId` | string numérica | filtro por projeto; **também** define a org-alvo (`DProject.idEstab`) |
| `motivoClasse` | `-531..-537` | filtro por motivo |
| `from` / `to` | ISO 8601 | período (`criadoEm`, TZ Brasil — start/end of day) |

**Escopo de org (tenant):** a org-alvo é a org DONA do `projectId` (quando
filtrado) ou a org ativa do JWT. O SQL faz `INNER JOIN DProject` por
`(metaDados->>'projetoId')::bigint` e filtra `DProject.idEstab = orgId` →
admin da org A nunca vê a org B. **Justificativas de tasks sem projeto não
entram** (não há org a que atribuí-las).

**RBAC:** apenas `getOrgRole(...) === 'ADMIN'` (-161) da org-alvo. Membro/VIEWER
→ **403**. **NUNCA** `getProjectRole`/MANAGER (CEO decisão 3).

Resposta (shape estável para os 3 cortes da gaveta):

```json
{
  "groupBy": "motivo",
  "orgId": "10",
  "total": 42,
  "groups": [
    { "key": "-535", "label": "Problema técnico / bug",   "count": 18, "avgDelayDays": 3.4 },
    { "key": "-531", "label": "Dependência não entregue",  "count": 12, "avgDelayDays": 5.1 }
  ],
  "filters": { "userId": null, "projectId": null, "motivoClasse": null, "from": null, "to": null }
}
```

`key`/`label` variam por `groupBy`: motivo → DClasse.nome; usuario →
DEntidade.nome; projeto → DProject.nome. `label` é `null` se a entidade não
pôde ser resolvida.

### Migration (índice — ZERO tabela nova)

`prisma/migrations/20260709000000_add_devento_delay_reason_agg_idx` cria o
índice **parcial de expressão** `DEvento_delay_reason_agg_idx` sobre o working
set `WHERE idClasse=-503 AND excluido=false`, cobrindo a chave de JOIN
(`metaDados->>'projetoId'`), o group-by por usuário (`idEntidade`), por motivo
(`metaDados->>'motivoClasse'`) e a poda de período (`criadoEm`). Idempotente
(`IF NOT EXISTS`); rollback manual documentado no `.sql` (`DROP INDEX IF EXISTS`).

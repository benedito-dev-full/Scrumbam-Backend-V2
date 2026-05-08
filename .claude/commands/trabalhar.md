# /trabalhar — Gestão de Intenções V3 (Scrumban-Backend-V2)

Você é o Orchestrator. O usuário quer interagir com o Scrumban V2: ver intenções, pegar trabalho, criar novas, ver métricas, ou concluir tarefas.

---

## API do Scrumban V2

**Base URL:** `http://localhost:3000/api/v1` (V2 default)

**Autenticação (credenciais via `.claude/settings.local.json`):**

**ANTES de autenticar, verificar se as credenciais existem:**

1. Checar se `$SCRUMBAN_V2_EMAIL` e `$SCRUMBAN_V2_PASSWORD` estão definidas (injetadas pelo Claude Code via settings.local.json)
2. Se AMBAS estiverem vazias ou indefinidas:
   - Checar se o arquivo `.claude/settings.local.json` existe
   - Se NÃO existir: PARAR e mostrar:

```
Para usar o /trabalhar no Scrumban-Backend-V2, configure suas credenciais.

Crie .claude/settings.local.json (gitignored):

{
  "env": {
    "SCRUMBAN_V2_EMAIL": "SEU_EMAIL_AQUI",
    "SCRUMBAN_V2_PASSWORD": "SUA_SENHA_AQUI"
  }
}

Apos criar, rode /trabalhar novamente.
```

3. Se as credenciais EXISTEM, prosseguir:

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/api/v1/auth/login \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"${SCRUMBAN_V2_EMAIL}\",\"password\":\"${SCRUMBAN_V2_PASSWORD}\"}" \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
```

Se TOKEN vazio mesmo com credenciais OK: backend pode estar parado. Avisar usuário.

---

## Endpoints V2 (escopo Scrumban-hoje)

### Projetos
```bash
GET /projects?organizationId=1
GET /projects/{ID}/stats
```

### Intenções V3 (DTask)
```bash
GET /tasks?projectId={ID}
GET /tasks/{ID}
POST /tasks
Body: {
  "name": "titulo",
  "projectId": "2",
  "problema": "...",
  "contexto": "...",
  "solucaoProposta": "...",
  "criteriosAceite": ["..."],
  "naoObjetivos": ["..."],
  "riscos": ["..."],
  "priorityId": "{ID}",
  "taskTypeId": "{ID}",
  "storyPoints": 3
}
PUT /tasks/{ID}
PATCH /tasks/{ID}/status
GET /tasks/{ID}/history
```

### Endpoints Genéricos V2 (Pilar 2)
```bash
GET /entidades?idClasse=-150  # USER
GET /entidades?idClasse=-152  # ORGANIZATION
GET /tabelas?classe=SPRINT    # ou ?idClasse=-400
GET /tabelas?classe=STATUS_INTENTION_V3  # V3 statuses
GET /classes
```

### Executions (F6 — Pilar 1)
```bash
GET /executions?projectId={ID}
POST /executions
Body: {
  "command": "...",
  "riskLevel": "LOW|MEDIUM|HIGH",
  "category": "refactor|fix|feature|review|explain"
}
```

### Métricas (F8/F9)
```bash
GET /flow-metrics?projectId={ID}
GET /forecast?projectId={ID}
GET /reports?projectId={ID}
```

---

## Fluxo recomendado

1. Listar projetos do usuário → escolher projetoId
2. Listar intenções do projeto (`GET /tasks?projectId={ID}`)
3. Filtrar por status (READY = pegar trabalho; INBOX = refinar; EXECUTING = atualizar progress)
4. Criar nova intenção se necessário (`POST /tasks` com problema, solução, critérios)
5. Mover entre status via `PATCH /tasks/{ID}/status`
6. Ver métricas: throughput, CFD, forecast Monte Carlo

---

## Notas V2

- O Scrumban-Backend-V2 É o servidor que `/trabalhar` consome.
- Identifier público: DEV-N (sequência atômica via jsonb_set).
- Convenção `?classe=NOME` (string) prevalece, mas `?idClasse=N` aceito por compatibilidade.
- Erros vêm formatados via NestJS `HttpException`.

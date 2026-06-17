# Scrumban MCP Setup

O MCP Server do Scrumban usa um unico endpoint JSON-RPC 2.0:

```text
POST https://api.scrumban.app/mcp
Header: X-MCP-Key: scrumban_mcp_xxx
```

Nao use JWT nesse endpoint. A key MCP e uma credencial dedicada para clientes como Claude Desktop, Cursor e Claude Code CLI.

## Catálogo de Scopes MCP (ADR-V2-068)

O V2 usa um **catálogo canônico de 6 scopes** para granularidade fina de privilégios:

| Scope | Tools cobertas | Descrição |
|-------|---|---|
| **`tasks:read`** | list_tasks, get_task, search_tasks, list_projects, get_project, list_blocks, list_block_tasks | Leitura de tasks e projetos |
| **`tasks:write`** | create_task, update_task, update_status, update_timer, delete_task | Mutação de tasks |
| **`notifications:read`** | list_notifications, get_unread_count | Leitura de notificações |
| **`notifications:write`** | update_notification | Mutação de notificações |
| **`projects:write`** | update_project | Mutação de projetos |
| **`executions:create`** | execute_task | **Disparo de IA (queima tokens — custo financeiro)** |

### Presets de scopes (para UI)

```json
{
  "READ_ONLY": ["tasks:read", "notifications:read"],
  "READ_WRITE": ["tasks:read", "tasks:write", "notifications:read", "notifications:write"],
  "FULL_ACCESS": ["tasks:read", "tasks:write", "notifications:read", "notifications:write", "projects:write", "executions:create"]
}
```

### Regra de privilege escalation

Cada usuário consegue **solicitar APENAS os scopes permitidos pelo seu role**:

| Role | Scopes permitidos |
|---|---|
| Qualquer usuário autenticado | `tasks:read`, `notifications:read`, `notifications:write` |
| MEMBER de org (-162) ou projeto (-172) | ↑ + `tasks:write` |
| MANAGER de projeto (-171) ou ORG_ADMIN (-161) | ↑ + `projects:write`, `executions:create` |

**Tentativa de solicitar scope acima do role** → `ForbiddenException` com lista de scopes negados e permitidos.

## Gerar uma MCP Key

Gere a key com um usuario autenticado por JWT:

```bash
curl -X POST https://api.scrumban.app/mcp/keys \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"scopes":["tasks:read","tasks:write","notifications:read"]}'
```

Exemplo de resposta:

```json
{
  "id": "123",
  "prefix": "scrumban_mcp",
  "plaintext": "scrumban_mcp_xxx",
  "scopes": ["tasks:read", "tasks:write", "notifications:read"],
  "createdAt": "2026-06-17T12:00:00.000Z"
}
```

O campo `plaintext` aparece somente na criacao. Guarde a key em um gerenciador de segredos e nunca registre em logs, issues ou documentacao.

### Endpoints relacionados

**Listar scopes permitidos para o usuário autenticado:**

```bash
curl -X GET https://api.scrumban.app/mcp/keys/allowed-scopes \
  -H "Authorization: Bearer <jwt>"

Response:
{
  "allowedScopes": ["tasks:read", "tasks:write", "notifications:read", "notifications:write"]
}
```

Use este endpoint no frontend para habilitar/desabilitar presets e checkboxes no modal de criação de key.

## Claude Desktop

Adicione o servidor ao arquivo `~/.config/Claude/claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "scrumban": {
      "url": "https://api.scrumban.app/mcp",
      "headers": {
        "X-MCP-Key": "scrumban_mcp_xxx"
      }
    }
  }
}
```

Reinicie o Claude Desktop apos salvar a configuracao.

## Cursor

No Cursor, abra Settings, MCP, Add Server. Configure:

```text
Name: scrumban
URL: https://api.scrumban.app/mcp
Header: X-MCP-Key: scrumban_mcp_xxx
```

Salve e verifique se as tools aparecem na lista do servidor.

## Claude Code CLI

Registre o servidor:

```bash
claude mcp add scrumban https://api.scrumban.app/mcp -H "X-MCP-Key: scrumban_mcp_xxx"
```

Depois confirme:

```bash
claude mcp list
```

## Tools Disponiveis

`list_tasks`: liste minhas tasks em execucao no projeto 123.

`create_task`: crie uma task no projeto 123 chamada "Revisar contrato MCP".

`update_status`: mova a task 456 para DONE.

`delete_task`: delete a task 456 (soft-delete; cascateia para subtarefas por padrao, use cascade=false para desvincular). Requer scope `tasks:write`.

`list_projects`: liste meus projetos ativos.

`list_sprints`: liste as sprints do projeto 123.

## Teste Manual JSON-RPC

Initialize:

```bash
curl -X POST https://api.scrumban.app/mcp \
  -H "X-MCP-Key: scrumban_mcp_xxx" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":"init-1"}'
```

Listar tools:

```bash
curl -X POST https://api.scrumban.app/mcp \
  -H "X-MCP-Key: scrumban_mcp_xxx" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":"tools-1"}'
```

Chamar tool:

```bash
curl -X POST https://api.scrumban.app/mcp \
  -H "X-MCP-Key: scrumban_mcp_xxx" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"tools/call","params":{"name":"list_tasks","arguments":{"limit":10}},"id":"tasks-1"}'
```

## Revogar uma Key

Revogue uma key pelo id:

```bash
curl -X DELETE https://api.scrumban.app/mcp/keys/:id \
  -H "Authorization: Bearer <jwt>"
```

A rota `DELETE /mcp/keys/:id` faz soft-delete da key e impede novas chamadas MCP com essa credencial.

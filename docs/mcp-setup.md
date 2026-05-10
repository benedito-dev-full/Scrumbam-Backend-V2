# Scrumban MCP Setup

O MCP Server do Scrumban usa um unico endpoint JSON-RPC 2.0:

```text
POST https://api.scrumban.app/mcp
Header: X-MCP-Key: scrumban_mcp_xxx
```

Nao use JWT nesse endpoint. A key MCP e uma credencial dedicada para clientes como Claude Desktop, Cursor e Claude Code CLI.

## Gerar uma MCP Key

Gere a key com um usuario autenticado por JWT:

```bash
curl -X POST https://api.scrumban.app/mcp/keys \
  -H "Authorization: Bearer <jwt>" \
  -H "Content-Type: application/json" \
  -d '{"scopes":["tools:read","tools:write"]}'
```

Exemplo de resposta:

```json
{
  "id": "123",
  "prefix": "scrumban_mcp",
  "plaintext": "scrumban_mcp_xxx",
  "scopes": ["tools:read", "tools:write"],
  "createdAt": "2026-05-10T12:00:00.000Z"
}
```

O campo `plaintext` aparece somente na criacao. Guarde a key em um gerenciador de segredos e nunca registre em logs, issues ou documentacao.

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

#!/bin/bash
# enforce-canonical-tables.sh (V2 — NEW)
# PreToolUse hook — bloqueia introdução de tabela nova fora das 17 canônicas
# Bloqueia também ALTER TABLE de tabelas canônicas sem ADR
#
# ADR-V2-001: 17 tabelas canônicas — zero tabela nova é regra inviolável

set -euo pipefail

INPUT=$(cat)

TOOL_NAME=$(echo "$INPUT" | jq -r '.tool_name // empty')
COMMAND=$(echo "$INPUT" | jq -r '.tool_input.command // empty')
FILE_PATH=$(echo "$INPUT" | jq -r '.tool_input.file_path // empty')
CONTENT=$(echo "$INPUT" | jq -r '.tool_input.content // empty')

# 17 tabelas canônicas
CANONICAL_TABLES="DClasse|DEntidade|DTabela|DVincula|DEvento|DRecurso|DUserGroup|DPermissao|DTask|DProject|DPedido|DTitulo|DMovDispo|DMovDepos|DSolicita|DRequisic|DVFS"

# Caso 1: Bash com ALTER TABLE / CREATE TABLE em SQL direto
if [ "$TOOL_NAME" = "Bash" ] && [ -n "$COMMAND" ]; then
  # CREATE TABLE de tabela própria (fora das 17)
  if echo "$COMMAND" | grep -iE 'CREATE\s+TABLE\s+"?(D[A-Za-z]+)"?' > /dev/null; then
    NEW_TABLE=$(echo "$COMMAND" | grep -oiE 'CREATE\s+TABLE\s+"?(D[A-Za-z]+)"?' | sed -E 's/.*CREATE\s+TABLE\s+"?(D[A-Za-z]+)"?.*/\1/i' | head -1)
    if ! echo "$NEW_TABLE" | grep -qE "^($CANONICAL_TABLES)$"; then
      echo "BLOCKED (V2 ADR-V2-001): CREATE TABLE de tabela NÃO canônica detectado: $NEW_TABLE" >&2
      echo "Apenas as 17 tabelas canônicas Devari-Core são permitidas." >&2
      echo "Tabelas válidas: $CANONICAL_TABLES" >&2
      echo "Para adicionar dado novo, use idClasse + Json (dados/metaDados) ou redija ADR-V2-XXX justificando." >&2
      exit 2
    fi
  fi

  # ALTER TABLE em canônica adicionando coluna
  if echo "$COMMAND" | grep -iE 'ALTER\s+TABLE\s+"?(D[A-Za-z]+)"?\s+ADD\s+(COLUMN|CONSTRAINT)' > /dev/null; then
    echo "WARNING (V2): ALTER TABLE em tabela canônica detectado." >&2
    echo "Verificar se tem ADR-V2-XXX justificando coluna nova." >&2
    # Não bloqueia (pode ser legítimo com ADR), apenas alerta
  fi
fi

# Caso 2: Edit/Write em prisma/schema.prisma
if [ "$TOOL_NAME" = "Write" ] || [ "$TOOL_NAME" = "Edit" ] || [ "$TOOL_NAME" = "MultiEdit" ]; then
  if echo "$FILE_PATH" | grep -q 'prisma/schema\.prisma'; then
    # Para Write: o conteúdo todo está em $CONTENT
    # Para Edit: precisamos verificar new_string (na real, mais simples: ler arquivo após escrita)
    SCHEMA_CONTENT=""
    if [ "$TOOL_NAME" = "Write" ]; then
      SCHEMA_CONTENT="$CONTENT"
    else
      NEW_STRING=$(echo "$INPUT" | jq -r '.tool_input.new_string // empty')
      SCHEMA_CONTENT="$NEW_STRING"
    fi

    # Extrair modelos declarados
    MODELS_DECLARED=$(echo "$SCHEMA_CONTENT" | grep -oE '^model\s+[A-Za-z]+' | awk '{print $2}' | sort -u || true)

    # Cada modelo declarado tem que estar nas 17
    INVALID_MODELS=""
    for model in $MODELS_DECLARED; do
      if ! echo "$model" | grep -qE "^($CANONICAL_TABLES)$"; then
        INVALID_MODELS+="$model "
      fi
    done

    if [ -n "$INVALID_MODELS" ]; then
      echo "BLOCKED (V2 ADR-V2-001): Modelo(s) NÃO canônico(s) em prisma/schema.prisma: $INVALID_MODELS" >&2
      echo "Apenas as 17 tabelas canônicas Devari-Core são permitidas." >&2
      echo "Tabelas válidas: $CANONICAL_TABLES" >&2
      echo "" >&2
      echo "Modelos do legado a ELIMINAR (se você os adicionou):" >&2
      echo "  DProjectMember, DNotification, DWebhook, DAgent, DExecution" >&2
      echo "  → Usar canônicas: DVincula (RBAC), DEvento (notification), DTabela (webhook config), DEntidade (agent), DPedido (execution)" >&2
      exit 2
    fi
  fi
fi

# Caso 3: prisma migration files com CREATE TABLE
if [ "$TOOL_NAME" = "Write" ] || [ "$TOOL_NAME" = "Edit" ] || [ "$TOOL_NAME" = "MultiEdit" ]; then
  if echo "$FILE_PATH" | grep -q 'prisma/migrations/.*\.sql$'; then
    SQL_CONTENT=""
    if [ "$TOOL_NAME" = "Write" ]; then
      SQL_CONTENT="$CONTENT"
    else
      SQL_CONTENT=$(echo "$INPUT" | jq -r '.tool_input.new_string // empty')
    fi

    # CREATE TABLE com nome de tabela
    NEW_TABLES=$(echo "$SQL_CONTENT" | grep -oiE 'CREATE\s+TABLE\s+"?[A-Za-z_]+"?' | sed -E 's/.*CREATE\s+TABLE\s+"?([A-Za-z_]+)"?.*/\1/i' | sort -u || true)

    INVALID_TABLES=""
    for tbl in $NEW_TABLES; do
      # Aceita DClasse, DEntidade, etc. e tabelas internas Prisma (_prisma_migrations)
      if ! echo "$tbl" | grep -qE "^($CANONICAL_TABLES|_prisma_.*)$"; then
        INVALID_TABLES+="$tbl "
      fi
    done

    if [ -n "$INVALID_TABLES" ]; then
      echo "BLOCKED (V2 ADR-V2-001): Migration cria tabela NÃO canônica: $INVALID_TABLES" >&2
      echo "Apenas as 17 tabelas canônicas Devari-Core são permitidas." >&2
      exit 2
    fi
  fi
fi

exit 0

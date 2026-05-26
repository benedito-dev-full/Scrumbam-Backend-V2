#!/usr/bin/env bash
# E2E smoke test do Prompt Builder (ADR-V2-049).
#
# Pré-requisitos:
#   - Backend rodando (default: http://localhost:3000 ou export API_URL)
#   - Credenciais válidas (export E2E_EMAIL e E2E_PASSWORD ou usar .env)
#   - Projeto existente com agent primary online (export E2E_PROJECT_ID)
#   - VPS acessível via ssh (export E2E_VPS_USER e E2E_VPS_HOST para validações extras)
#
# Uso:
#   E2E_EMAIL=... E2E_PASSWORD=... E2E_PROJECT_ID=... ./scripts/e2e/e2e-prompt-builder.sh
#
# Saída:
#   PASS / FAIL por etapa. Exit 0 se tudo OK; exit 1 se qualquer etapa falhar.
#
# NÃO automatize em CI sem revisão — script faz POST real e exige VPS online.

set -euo pipefail

API="${API_URL:-http://localhost:3000}"
EMAIL="${E2E_EMAIL:-}"
PASSWORD="${E2E_PASSWORD:-}"
PROJECT_ID="${E2E_PROJECT_ID:-}"
VPS_USER="${E2E_VPS_USER:-dev-benedito}"
VPS_HOST="${E2E_VPS_HOST:-}"

if [[ -z "$EMAIL" || -z "$PASSWORD" || -z "$PROJECT_ID" ]]; then
  echo "[FAIL] Variáveis obrigatórias ausentes: E2E_EMAIL, E2E_PASSWORD, E2E_PROJECT_ID"
  exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
  echo "[FAIL] 'jq' não instalado. brew install jq"
  exit 1
fi

echo "==================================================================="
echo "E2E Prompt Builder Smoke (ADR-V2-049)"
echo "API:        $API"
echo "Project ID: $PROJECT_ID"
echo "==================================================================="

# 1. Login
echo
echo "[1/6] Login..."
LOGIN_RESP=$(curl -s -X POST "$API/auth/login" \
  -H "Content-Type: application/json" \
  -d "{\"email\":\"$EMAIL\",\"password\":\"$PASSWORD\"}")
JWT=$(echo "$LOGIN_RESP" | jq -r '.accessToken // empty')
if [[ -z "$JWT" ]]; then
  echo "[FAIL] login não retornou accessToken. Resposta: $LOGIN_RESP"
  exit 1
fi
echo "[PASS] JWT obtido (${#JWT} chars)."

# 2. Criar task de teste
echo
echo "[2/6] Criando task de teste no projeto $PROJECT_ID..."
TASK_NAME="E2E PromptBuilder $(date +%s): criar arquivo AGENT_TEST.md com a palavra ping"
TASK_RESP=$(curl -s -X POST "$API/tasks" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{
    \"projectId\":\"$PROJECT_ID\",
    \"nome\":\"$TASK_NAME\",
    \"taskType\":\"code\"
  }")
TASK_ID=$(echo "$TASK_RESP" | jq -r '.id // empty')
if [[ -z "$TASK_ID" ]]; then
  echo "[FAIL] task create não retornou id. Resposta: $TASK_RESP"
  exit 1
fi
echo "[PASS] Task criada: id=$TASK_ID"

# 3. Disparar execução (modo PROMPT — payload mínimo)
echo
echo "[3/6] POST /projects/$PROJECT_ID/execute { taskId: $TASK_ID }..."
EXEC_RESP=$(curl -s -X POST "$API/projects/$PROJECT_ID/execute" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -d "{\"taskId\":\"$TASK_ID\"}")
EXEC_ID=$(echo "$EXEC_RESP" | jq -r '.id // empty')
RISK=$(echo "$EXEC_RESP" | jq -r '.riskLevel // empty')
if [[ -z "$EXEC_ID" ]]; then
  echo "[FAIL] execute não retornou id. Resposta: $EXEC_RESP"
  exit 1
fi
echo "[PASS] Execution criada: id=$EXEC_ID risk=$RISK"

# 4. Polling até finishedAt
echo
echo "[4/6] Polling até execution concluir (max 5min)..."
DEADLINE=$(( $(date +%s) + 300 ))
EXEC_STATE=""
while (( $(date +%s) < DEADLINE )); do
  STATE=$(curl -s "$API/executions/$EXEC_ID" -H "Authorization: Bearer $JWT")
  EXIT_CODE=$(echo "$STATE" | jq -r '.claude.exitCode // empty')
  FINISHED=$(echo "$STATE" | jq -r '.claude.finishedAt // empty')
  if [[ -n "$FINISHED" ]]; then
    echo "[PASS] Concluída em $FINISHED (exitCode=$EXIT_CODE)"
    EXEC_STATE="$STATE"
    break
  fi
  echo "  ...waiting (state still running)"
  sleep 5
done

if [[ -z "$EXEC_STATE" ]]; then
  echo "[FAIL] Timeout aguardando execution concluir."
  exit 1
fi

if [[ "$EXIT_CODE" != "0" ]]; then
  echo "[FAIL] exitCode != 0 (got $EXIT_CODE). Stderr:"
  echo "$EXEC_STATE" | jq -r '.claude.stderr // "(empty)"'
  exit 1
fi

# 5. Validar payload — dados.prompt deve conter texto natural (NÃO só taskId)
echo
echo "[5/6] Validando DPedido.dados.prompt e dados.taskType..."
DADOS=$(echo "$EXEC_STATE" | jq '.dados // empty')
PROMPT=$(echo "$DADOS" | jq -r '.prompt // empty' 2>/dev/null || true)
TASK_TYPE=$(echo "$DADOS" | jq -r '.taskType // empty' 2>/dev/null || true)

# Alguns serializadores escondem dados — tente buscar via endpoint admin/debug
if [[ -z "$PROMPT" ]]; then
  echo "[WARN] dados.prompt não veio no GET /executions/:id (campos escondidos)."
  echo "       Validação manual recomendada via psql:"
  echo "       SELECT dados->>'prompt' FROM \"DPedido\" WHERE chave = $EXEC_ID;"
else
  if echo "$PROMPT" | grep -q "agente de"; then
    echo "[PASS] dados.prompt contém texto natural (não é literal $TASK_ID)."
  else
    echo "[FAIL] dados.prompt parece estranho:"
    echo "$PROMPT" | head -5
    exit 1
  fi
fi

if [[ -n "$TASK_TYPE" ]]; then
  if [[ "$TASK_TYPE" == "code" ]]; then
    echo "[PASS] dados.taskType=code (esperado)."
  else
    echo "[WARN] dados.taskType=$TASK_TYPE (esperado 'code', mas aceitável se cascata mudou)."
  fi
fi

# 6. Validar branch no VPS (opcional)
echo
echo "[6/6] Validação VPS (opcional)..."
if [[ -n "$VPS_HOST" ]]; then
  echo "Procurando branch scrumban/auto-$EXEC_ID no VPS..."
  PROJECT_SLUG=$(echo "$EXEC_STATE" | jq -r '.project.slug // empty' 2>/dev/null || true)
  if [[ -n "$PROJECT_SLUG" ]]; then
    ssh "$VPS_USER@$VPS_HOST" \
      "git -C ~/scrumban-projects/$PROJECT_SLUG branch -a | grep scrumban/auto-$EXEC_ID" \
      && echo "[PASS] branch criada" \
      || echo "[WARN] branch não encontrada (pode ser branch policy)"
  else
    echo "[SKIP] project.slug não disponível no response."
  fi
else
  echo "[SKIP] E2E_VPS_HOST não setado."
fi

echo
echo "==================================================================="
echo "SMOKE E2E PASSED — Prompt Builder funcionando."
echo "==================================================================="

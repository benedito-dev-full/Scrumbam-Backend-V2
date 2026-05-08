#!/bin/bash
# update-status-after-agent.sh (V2)
# SubagentStop hook — atualiza workspace/STATUS.md quando agent finaliza

set -euo pipefail

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# Param 1: agent_name (configurado em settings.json)
AGENT_NAME="${1:-}"

# Fallback: stdin JSON
if [ -z "$AGENT_NAME" ] && [ ! -t 0 ]; then
  STDIN=$(cat)
  if [ -n "$STDIN" ] && command -v jq &>/dev/null; then
    AGENT_NAME=$(echo "$STDIN" | jq -r '.agent_type // .subagent_type // empty' 2>/dev/null || true)
  fi
fi

if [ -z "$AGENT_NAME" ]; then
  echo -e "${YELLOW}WARNING: agent name ausente — pulando STATUS.md${NC}"
  exit 0
fi

case "$AGENT_NAME" in
  strategist|implementer|reviewer|documenter) ;;
  *)
    echo -e "${YELLOW}WARNING: agent '$AGENT_NAME' não pertence ao workflow V2${NC}"
    exit 0
    ;;
esac

# TASK_NUM dos artefatos workspace
TASK_NUM=""
for dir in workspace/implementations workspace/reviews workspace/plans; do
  if [ -d "$dir" ]; then
    LATEST=$(find "$dir" -name "*-task*.md" -type f -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -1)
    if [ -n "${LATEST:-}" ]; then
      TASK_NUM=$(basename "$LATEST" | grep -oE 'task[0-9]+' | sed 's/task//' || echo "")
      if [ -n "$TASK_NUM" ]; then break; fi
    fi
  fi
done

[ -z "$TASK_NUM" ] && TASK_NUM="unknown"

STATUS_FILE="workspace/STATUS.md"
if [ ! -f "$STATUS_FILE" ]; then
  echo -e "${YELLOW}WARNING: STATUS.md ausente — criando${NC}"
  mkdir -p workspace
  cat > "$STATUS_FILE" << 'EOF'
# Workflow Status — Scrumban-Backend-V2 Orchestrator

**Última atualização:** Auto-gerado por hooks

---

## Tasks Completadas

(Conclusões dos agents serão registradas abaixo automaticamente)

EOF
fi

TIMESTAMP=$(date +"%d/%m/%Y %H:%M:%S")
FINGERPRINT="<!-- dedup:${AGENT_NAME}:${TASK_NUM} -->"

if grep -qF "$FINGERPRINT" "$STATUS_FILE" 2>/dev/null; then
  echo -e "${YELLOW}WARNING: Entry duplicada (${AGENT_NAME}, Task #${TASK_NUM}) — pulando${NC}"
  exit 0
fi

echo "Registrando conclusão do agent V2..."
echo "   Agent: $AGENT_NAME"
echo "   Task: $TASK_NUM"

cat >> "$STATUS_FILE" << EOF

---

${FINGERPRINT}
### Agent Concluído: $AGENT_NAME

**Task:** #$TASK_NUM
**Timestamp:** $TIMESTAMP
**Agent:** $AGENT_NAME
**Status:** Completo

EOF

echo -e "${GREEN}OK${NC} STATUS.md atualizado (V2)"
exit 0

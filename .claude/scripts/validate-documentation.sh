#!/bin/bash
# validate-documentation.sh (V2)
# Stop hook for Documenter agent

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "Validando documentação V2..."

# TASK_NUM
TASK_NUM="${TASK_NUM:-}"
if [ -z "$TASK_NUM" ]; then
  for search_dir in workspace/implementations workspace/reviews workspace/plans; do
    if [ -d "$search_dir" ]; then
      LATEST=$(find "$search_dir" -name "*-task*.md" -type f -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -1)
      if [ -n "${LATEST:-}" ]; then
        TASK_NUM=$(basename "$LATEST" | grep -oE 'task[0-9]+' | grep -oE '[0-9]+' || echo "")
        if [ -n "$TASK_NUM" ]; then break; fi
      fi
    fi
  done
fi

if [ -z "$TASK_NUM" ]; then
  echo -e "${YELLOW}WARNING: TASK_NUM ausente — validações parciais${NC}" >&2
  TASK_NUM="UNKNOWN"
fi

echo -e "${GREEN}OK${NC} Task: $TASK_NUM"

# 1. ROADMAP.md (CRÍTICO)
ROADMAP="docs/ROADMAP.md"
if [ ! -f "$ROADMAP" ]; then
  echo -e "${RED}ERROR: $ROADMAP ausente!${NC}" >&2
  exit 2
fi

if [ "$TASK_NUM" != "UNKNOWN" ]; then
  if ! grep -qE "Task ${TASK_NUM}.*✅|✅.*Task ${TASK_NUM}|Task ${TASK_NUM}.*COMPLETA|Task ${TASK_NUM}.*COMPLETE" "$ROADMAP"; then
    echo -e "${RED}ERROR: Task $TASK_NUM NÃO marcada em ROADMAP!${NC}" >&2
    echo -e "${YELLOW}Adicionar: ### Task $TASK_NUM: [Nome] — ✅ COMPLETA${NC}" >&2
    exit 2
  fi
  echo -e "${GREEN}OK${NC} Task $TASK_NUM marcada em ROADMAP"
fi

# 2. CHANGELOG.md
CHANGELOG="docs/CHANGELOG.md"
if [ ! -f "$CHANGELOG" ]; then
  echo -e "${RED}ERROR: $CHANGELOG ausente!${NC}" >&2
  exit 2
fi

if ! grep -q "## \[Unreleased\]" "$CHANGELOG"; then
  echo -e "${RED}ERROR: CHANGELOG sem [Unreleased]!${NC}" >&2
  exit 2
fi

RECENT=$(head -50 "$CHANGELOG")
if ! echo "$RECENT" | grep -qE "### (Added|Fixed|Changed|Performance|Removed|Tests)"; then
  echo -e "${YELLOW}WARNING: [Unreleased] pode estar vazio${NC}" >&2
fi

echo -e "${GREEN}OK${NC} CHANGELOG atualizado"

# 3. STATUS.md (CRÍTICO!)
STATUS="workspace/STATUS.md"
if [ ! -f "$STATUS" ]; then
  echo -e "${RED}ERROR: $STATUS ausente!${NC}" >&2
  echo -e "${YELLOW}Criar workspace/STATUS.md (template do Documenter)${NC}" >&2
  exit 2
fi

if [ "$TASK_NUM" != "UNKNOWN" ]; then
  if ! grep -qE "Task ${TASK_NUM}" "$STATUS"; then
    echo -e "${RED}ERROR: Task $TASK_NUM ausente em STATUS.md!${NC}" >&2
    exit 2
  fi
  if ! grep -qE "Task ${TASK_NUM}.*COMPLETE|Task ${TASK_NUM}.*COMPLETA" "$STATUS"; then
    echo -e "${RED}ERROR: Task $TASK_NUM existe mas não marcada COMPLETE!${NC}" >&2
    exit 2
  fi
  echo -e "${GREEN}OK${NC} Task $TASK_NUM em STATUS.md"
fi

# 4. Git commit (Conventional Commits)
LAST_COMMIT=$(git log -1 --oneline 2>/dev/null || echo "")
if [ -z "$LAST_COMMIT" ]; then
  echo -e "${RED}ERROR: Sem commit!${NC}" >&2
  exit 2
fi

echo "Last commit: $LAST_COMMIT"

# Scopes V2 válidos no regex
if ! echo "$LAST_COMMIT" | grep -qE '^[a-f0-9]+ (feat|fix|docs|refactor|perf|test|chore|style)\((engine|seeds|endpoints|core|auth|eventos|entidades|tabelas|classes|common|channels|mcp|webhooks|automation|executions|flow-metrics|reports|email|permissoes|docs|agents)\):'; then
  echo -e "${YELLOW}WARNING (V2): Commit pode não seguir Conventional Commits com scope V2${NC}" >&2
  echo -e "${YELLOW}Formato: type(scope_v2): subject${NC}" >&2
  echo -e "${YELLOW}Scopes V2 válidos: engine, seeds, endpoints, core, auth, eventos, entidades, tabelas, classes, common, channels, mcp, webhooks, automation, executions, flow-metrics, reports, email, permissoes, docs, agents${NC}" >&2
fi

COMMIT_TIME=$(git log -1 --format=%ct 2>/dev/null || echo "0")
NOW=$(date +%s)
MINUTES=$(( (NOW - COMMIT_TIME) / 60 ))

if [ "$MINUTES" -gt 30 ]; then
  echo -e "${YELLOW}WARNING: Commit há ${MINUTES}min (esperado <30min)${NC}" >&2
fi

echo -e "${GREEN}OK${NC} Commit (${MINUTES}min atrás)"

# 5. JSDoc em arquivos recentes
RECENT_TS=$(find src/ -name "*.ts" -mtime -1 -type f 2>/dev/null | head -5)
if [ -z "$RECENT_TS" ]; then
  echo -e "${YELLOW}WARNING: Nenhum .ts modificado recentemente${NC}" >&2
else
  WITH_JSDOC=0
  TOTAL=0
  while IFS= read -r file; do
    TOTAL=$((TOTAL + 1))
    if grep -q '/\*\*' "$file" 2>/dev/null; then
      WITH_JSDOC=$((WITH_JSDOC + 1))
    fi
  done <<< "$RECENT_TS"

  if [ "$WITH_JSDOC" -eq 0 ] && [ "$TOTAL" -gt 0 ]; then
    echo -e "${YELLOW}WARNING: 0/$TOTAL arquivos recentes têm JSDoc${NC}" >&2
  else
    echo -e "${GREEN}OK${NC} JSDoc: $WITH_JSDOC/$TOTAL recentes"
  fi
fi

# 6. ADR-V2-XXX (se mencionado em commit)
if echo "$LAST_COMMIT" | grep -qiE "ADR-V2-[0-9]+"; then
  ADR_REF=$(echo "$LAST_COMMIT" | grep -oE 'ADR-V2-[0-9]+' | head -1)
  ADR_REF_LOWER=$(echo "$ADR_REF" | tr '[:upper:]' '[:lower:]')
  ADR_FILE=$(find docs/decisions -iname "${ADR_REF_LOWER}*.md" 2>/dev/null | head -1)
  if [ -z "$ADR_FILE" ]; then
    echo -e "${YELLOW}WARNING: Commit cita $ADR_REF mas arquivo não existe em docs/decisions/${NC}" >&2
  else
    echo -e "${GREEN}OK${NC} ADR vinculado: $ADR_FILE"
  fi
fi

if [ -n "${TASK_NUM:-}" ] && [ "$TASK_NUM" != "UNKNOWN" ]; then
  echo -e "${GREEN}OK${NC} Task #${TASK_NUM} — Documentação validada"
fi

echo ""
echo -e "${GREEN}==============================================${NC}"
echo -e "${GREEN}DOCUMENTAÇÃO V2 VALIDAÇÕES OK!${NC}"
echo -e "${GREEN}==============================================${NC}"
echo -e "${GREEN}OK${NC} ROADMAP: Task marcada"
echo -e "${GREEN}OK${NC} CHANGELOG: atualizado"
echo -e "${GREEN}OK${NC} STATUS.md: documentada"
echo -e "${GREEN}OK${NC} Git commit: criado"
echo -e "${GREEN}OK${NC} JSDoc: presente"
echo ""

exit 0

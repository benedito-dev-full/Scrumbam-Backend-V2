#!/bin/bash
# validate-review.sh (V2)
# Stop hook for Reviewer agent — checks structural correctness
# Score gate (APPROVED ≥ 7.0) is delegated to validate-review-score.sh

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "Validando review do Reviewer V2..."

REVIEW_DIR="workspace/reviews"

if [ ! -d "$REVIEW_DIR" ]; then
  echo -e "${RED}ERROR: workspace/reviews/ ausente${NC}" >&2
  exit 2
fi

LATEST_REVIEW=$(find "$REVIEW_DIR" -name "review-*.md" -type f -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -1)

if [ -z "$LATEST_REVIEW" ]; then
  echo -e "${RED}ERROR: Review não encontrado${NC}" >&2
  echo -e "${YELLOW}Criar: workspace/reviews/review-[modulo]-[desc]-taskN.md${NC}" >&2
  exit 2
fi

REVIEW_FILENAME=$(basename "$LATEST_REVIEW")
echo -e "${GREEN}OK${NC} Review: $REVIEW_FILENAME"

# Naming
if ! echo "$REVIEW_FILENAME" | grep -qE '^review-[a-z0-9-]+-task[0-9]+\.md$'; then
  echo -e "${RED}ERROR: Naming incorreto: $REVIEW_FILENAME${NC}" >&2
  exit 2
fi

if echo "$REVIEW_FILENAME" | grep -q '[A-Z]'; then
  echo -e "${RED}ERROR: UPPERCASE no naming${NC}" >&2
  exit 2
fi

# Módulo V2
MODULO=$(echo "$REVIEW_FILENAME" | sed -E 's/^review-([a-z]+)-.*/\1/')
VALID_MODULES_V2="engine|seeds|endpoints|core|auth|eventos|entidades|tabelas|classes|common|channels|mcp|webhooks|automation|executions|flow-metrics|reports|email|permissoes|docs|agents"
if ! echo "$MODULO" | grep -qE "^($VALID_MODULES_V2)$"; then
  echo -e "${YELLOW}WARNING (V2): Módulo '$MODULO' fora da lista padrão${NC}" >&2
fi

echo -e "${GREEN}OK${NC} Naming OK"

TASK_NUM=$(echo "$REVIEW_FILENAME" | grep -oE 'task[0-9]+' | grep -oE '[0-9]+' || echo "")

REVIEW_CONTENT=$(cat "$LATEST_REVIEW")

# Score numérico obrigatório
SCORE=$(echo "$REVIEW_CONTENT" | grep -oE '[0-9]+\.?[0-9]*/10' | head -1 || echo "")

if [ -z "$SCORE" ]; then
  echo -e "${RED}ERROR (V2): Score numérico ausente!${NC}" >&2
  echo -e "${YELLOW}Review deve ter: X/10 ou X.X/10${NC}" >&2
  exit 2
fi

SCORE_VALUE=$(echo "$SCORE" | grep -oE '^[0-9]+\.?[0-9]*' || echo "0")

if (( $(echo "$SCORE_VALUE < 0" | bc -l) )) || (( $(echo "$SCORE_VALUE > 10" | bc -l) )); then
  echo -e "${RED}ERROR: Score fora do range 0-10: $SCORE_VALUE${NC}" >&2
  exit 2
fi

echo -e "${GREEN}OK${NC} Score: $SCORE"

# Decisão obrigatória
DECISION=""
if echo "$REVIEW_CONTENT" | grep -qE "(^|[^A-Za-z])APPROVED([^A-Za-z]|$)"; then
  DECISION="APPROVED"
elif echo "$REVIEW_CONTENT" | grep -qE "(^|[^A-Za-z])REJECTED([^A-Za-z]|$)"; then
  DECISION="REJECTED"
elif echo "$REVIEW_CONTENT" | grep -qiE "NEEDS.CHANGE|NEEDS_CHANGE"; then
  DECISION="NEEDS_CHANGES"
fi

if [ -z "$DECISION" ]; then
  echo -e "${RED}ERROR: Decisão ausente!${NC}" >&2
  echo -e "${YELLOW}Review precisa de: APPROVED | REJECTED | NEEDS_CHANGES${NC}" >&2
  exit 2
fi

echo -e "${GREEN}OK${NC} Decisão: $DECISION"

# Coerência score x decisão
if [ "$DECISION" = "REJECTED" ] && (( $(echo "$SCORE_VALUE >= 7.0" | bc -l) )); then
  echo -e "${YELLOW}WARNING: Inconsistência — REJECTED mas score $SCORE_VALUE >= 7.0${NC}" >&2
fi

# Score gate é validado por validate-review-score.sh (separado, mais explícito)

# Tamanho mínimo
REVIEW_LINES=$(wc -l < "$LATEST_REVIEW")
if [ "$REVIEW_LINES" -lt 30 ]; then
  echo -e "${YELLOW}WARNING: Review curto ($REVIEW_LINES linhas)${NC}" >&2
fi

# V2-específico: validação 3 Pilares mencionada?
if ! echo "$REVIEW_CONTENT" | grep -qiE "pilar 1|pilar 2|pilar 3"; then
  echo -e "${YELLOW}WARNING (V2): Review não menciona 3 Pilares${NC}" >&2
fi

if [ -n "${TASK_NUM:-}" ]; then
  echo -e "${GREEN}OK${NC} Task #${TASK_NUM} — Review validado"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}REVIEW V2 VALIDAÇÕES OK!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}OK${NC} File: $REVIEW_FILENAME"
echo -e "${GREEN}OK${NC} Score: $SCORE"
echo -e "${GREEN}OK${NC} Decisão: $DECISION"
echo ""

# Score gate é o próximo hook (validate-review-score.sh)

if [ "$DECISION" = "APPROVED" ]; then
  echo -e "${GREEN}Approved! Score gate ≥7.0 será validado.${NC}"
elif [ "$DECISION" = "REJECTED" ]; then
  echo -e "${YELLOW}Rejected. Implementer corrige (resume agentId).${NC}"
else
  echo -e "${YELLOW}Needs changes. Implementer corrige.${NC}"
fi

exit 0

#!/bin/bash
# validate-review-score.sh (V2 — NEW)
# Score gate enforcement: APPROVED requires score ≥ 7.0 (regra mecânica)
# Runs as second Stop hook for Reviewer (after validate-review.sh)
# Or as PreCommit / additional Stop hook
#
# ADR-V2-015 (a ratificar): Score gate APPROVED ≥ 7.0

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "Validando score gate V2 (APPROVED ≥ 7.0)..."

REVIEW_DIR="workspace/reviews"

if [ ! -d "$REVIEW_DIR" ]; then
  echo -e "${YELLOW}WARNING: workspace/reviews/ ausente — pulando score gate${NC}" >&2
  exit 0
fi

LATEST_REVIEW=$(find "$REVIEW_DIR" -name "review-*.md" -type f -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -1)

if [ -z "$LATEST_REVIEW" ]; then
  echo -e "${YELLOW}WARNING: Review ausente — pulando score gate${NC}" >&2
  exit 0
fi

REVIEW_CONTENT=$(cat "$LATEST_REVIEW")

# Extrair score
SCORE=$(echo "$REVIEW_CONTENT" | grep -oE '[0-9]+\.?[0-9]*/10' | head -1 || echo "")

if [ -z "$SCORE" ]; then
  echo -e "${RED}ERROR (V2 score gate): Score numérico ausente no review!${NC}" >&2
  echo -e "${YELLOW}Review deve ter score em formato X/10 ou X.X/10${NC}" >&2
  exit 2
fi

SCORE_VALUE=$(echo "$SCORE" | grep -oE '^[0-9]+\.?[0-9]*' || echo "0")

# Validar range
if ! [[ "$SCORE_VALUE" =~ ^[0-9]+\.?[0-9]*$ ]]; then
  echo -e "${RED}ERROR (V2 score gate): Score inválido: '$SCORE_VALUE'${NC}" >&2
  exit 2
fi

if (( $(echo "$SCORE_VALUE < 0" | bc -l) )) || (( $(echo "$SCORE_VALUE > 10" | bc -l) )); then
  echo -e "${RED}ERROR (V2 score gate): Score fora do range 0-10: $SCORE_VALUE${NC}" >&2
  exit 2
fi

# Extrair decisão
DECISION=""
if echo "$REVIEW_CONTENT" | grep -qE "(^|[^A-Za-z])APPROVED([^A-Za-z]|$)"; then
  DECISION="APPROVED"
elif echo "$REVIEW_CONTENT" | grep -qE "(^|[^A-Za-z])REJECTED([^A-Za-z]|$)"; then
  DECISION="REJECTED"
elif echo "$REVIEW_CONTENT" | grep -qiE "NEEDS.CHANGE|NEEDS_CHANGE"; then
  DECISION="NEEDS_CHANGES"
fi

if [ -z "$DECISION" ]; then
  echo -e "${RED}ERROR (V2 score gate): Decisão ausente — APPROVED/REJECTED/NEEDS_CHANGES obrigatório${NC}" >&2
  exit 2
fi

# Decisão fora do conjunto válido
case "$DECISION" in
  APPROVED|REJECTED|NEEDS_CHANGES) ;;
  *)
    echo -e "${RED}ERROR (V2 score gate): Decisão fora de {APPROVED, REJECTED, NEEDS_CHANGES}: '$DECISION'${NC}" >&2
    exit 2
    ;;
esac

# REGRA MECÂNICA V2: APPROVED requer score >= 7.0
if [ "$DECISION" = "APPROVED" ]; then
  if (( $(echo "$SCORE_VALUE < 7.0" | bc -l) )); then
    echo -e "${RED}========================================${NC}" >&2
    echo -e "${RED}ERROR (V2 SCORE GATE): APPROVED com score $SCORE_VALUE < 7.0!${NC}" >&2
    echo -e "${RED}========================================${NC}" >&2
    echo -e "${YELLOW}Regra mecânica V2: APPROVED requer score numérico >= 7.0${NC}" >&2
    echo -e "${YELLOW}(ADR-V2-015 — Score gate)${NC}" >&2
    echo "" >&2
    echo -e "${YELLOW}Opções para o Reviewer:${NC}" >&2
    echo "  (a) Mudar decisão para NEEDS_CHANGES (5.0-6.9) ou REJECTED (<5.0)" >&2
    echo "  (b) Aumentar score se justificado (revisar issues, recalcular)" >&2
    echo "" >&2
    echo -e "${YELLOW}Em F13 (Risk Gate / RCE), aprovar com score 6 = liberar comando potencialmente RCE.${NC}" >&2
    echo -e "${YELLOW}Família depende. Corda justa.${NC}" >&2
    exit 2
  fi
  echo -e "${GREEN}OK${NC} APPROVED com score $SCORE_VALUE >= 7.0"
fi

# REGRA: REJECTED com score >= 7.0 = inconsistência (warning, não bloqueia)
if [ "$DECISION" = "REJECTED" ] && (( $(echo "$SCORE_VALUE >= 7.0" | bc -l) )); then
  echo -e "${YELLOW}WARNING (V2): REJECTED com score $SCORE_VALUE >= 7.0 — inconsistência${NC}" >&2
  echo -e "${YELLOW}Considere mudar para NEEDS_CHANGES (warning não bloqueia).${NC}" >&2
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}V2 SCORE GATE: APROVADO${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Score: $SCORE_VALUE/10${NC}"
echo -e "${GREEN}Decisão: $DECISION${NC}"
echo ""

exit 0

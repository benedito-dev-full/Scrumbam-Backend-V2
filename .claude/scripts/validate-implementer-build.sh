#!/bin/bash
# validate-implementer-build.sh (V2)
# SubagentStop hook for Implementer — double-check build before return
#
# JSON decision:"block" prevents return; exit 0 without JSON allows return

set -euo pipefail

cat > /dev/null 2>&1 || true

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "Double-check V2: Validando build do Implementer..." >&2

detect_build_command() {
  if [ -f "Makefile" ] && grep -q '^build:' Makefile && command -v make > /dev/null 2>&1; then
    echo "make build"
  else
    echo "npm run build"
  fi
}

BUILD_CMD=$(detect_build_command)

# Build
if ! $BUILD_CMD > /tmp/subagent-build-v2.log 2>&1; then
  echo -e "${RED}V2 BUILD FAILED no SubagentStop!${NC}" >&2
  echo "Implementer NÃO pode retornar com build quebrado." >&2
  echo "Build command: $BUILD_CMD" >&2
  echo "Últimas 10 linhas:" >&2
  tail -10 /tmp/subagent-build-v2.log >&2

  ERRMSG=$(tail -5 /tmp/subagent-build-v2.log | tr '\n' ' ' | sed 's/"/\\"/g')
  cat <<EOF
{
  "decision": "block",
  "reason": "V2 BUILD FAILED no SubagentStop double-check ($BUILD_CMD). Implementer deve corrigir antes de retornar. Erro: ${ERRMSG}"
}
EOF
  exit 0
fi

echo -e "${GREEN}V2 Build OK ($BUILD_CMD)${NC}" >&2

# Implementation notes
IMPL_DIR="workspace/implementations"
LATEST_IMPL=""
if [ -d "$IMPL_DIR" ]; then
  LATEST_IMPL=$(find "$IMPL_DIR" -name "impl-*.md" -type f -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -1 || true)
fi

if [ -z "${LATEST_IMPL:-}" ]; then
  cat <<EOF
{
  "decision": "block",
  "reason": "V2: Implementation notes ausente em workspace/implementations/. Implementer deve criar impl-[modulo]-[desc]-taskN.md antes de retornar."
}
EOF
  exit 0
fi

echo -e "${GREEN}V2 Implementation notes OK${NC}" >&2

# Pilar 1 violation check (extra defesa)
PILAR1_VIOLATION=$(grep -rn "prisma\\.dPedido\\.create\\|prisma\\.dTitulo\\.create\\|prisma\\.dMovDispo\\.create" src/ --include="*.ts" 2>/dev/null | head -1 || true)
if [ -n "$PILAR1_VIOLATION" ]; then
  ERR=$(echo "$PILAR1_VIOLATION" | sed 's/"/\\"/g')
  cat <<EOF
{
  "decision": "block",
  "reason": "V2 Pilar 1 VIOLADO: prisma.dPedido.create() direto detectado. Use OperacaoExecucaoClaude (ADR-V2-005). Linha: ${ERR}"
}
EOF
  exit 0
fi

echo -e "${GREEN}V2 Double-check COMPLETO${NC}" >&2
exit 0

#!/bin/bash
# validate-implementation.sh (V2)
# Stop hook for Implementer agent

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "Validando implementação V2..."

# Detectar build command
detect_build_command() {
  if [ -f "Makefile" ] && grep -q '^build:' Makefile && command -v make > /dev/null 2>&1; then
    echo "make build"
  else
    echo "npm run build"
  fi
}

BUILD_CMD=$(detect_build_command)

# 1. BUILD MUST PASS (CRITICAL)
echo ""
echo "Executando build (CRITICAL — pode levar 15-30s)..."
echo "Build command: $BUILD_CMD"

if ! $BUILD_CMD > /tmp/build-output-v2.log 2>&1; then
  echo -e "${RED}ERROR (V2): BUILD FALHOU!${NC}" >&2
  echo -e "${RED}Código que não compila não é aceito.${NC}" >&2
  echo -e "${YELLOW}Últimas 20 linhas:${NC}" >&2
  tail -20 /tmp/build-output-v2.log >&2
  exit 2
fi

echo -e "${GREEN}BUILD PASS!${NC}"

# 2. TypeScript ZERO errors (strict)
echo ""
echo "Verificando TypeScript (strict)..."
if ! npx tsc --noEmit > /tmp/tsc-output-v2.log 2>&1; then
  echo -e "${RED}ERROR (V2): TypeScript com erros!${NC}" >&2
  cat /tmp/tsc-output-v2.log >&2
  exit 2
fi
echo -e "${GREEN}TypeScript: 0 errors${NC}"

# 3. Implementation notes existem
IMPL_DIR="workspace/implementations"
if [ ! -d "$IMPL_DIR" ]; then
  echo -e "${RED}ERROR: workspace/implementations/ ausente${NC}" >&2
  exit 2
fi

LATEST_IMPL=$(find "$IMPL_DIR" -name "impl-*.md" -type f -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -1)
if [ -z "$LATEST_IMPL" ]; then
  echo -e "${RED}ERROR: Implementation notes ausente!${NC}" >&2
  echo -e "${YELLOW}Criar: workspace/implementations/impl-[modulo]-[desc]-taskN.md${NC}" >&2
  exit 2
fi

IMPL_FILENAME=$(basename "$LATEST_IMPL")

# Naming V2
if ! echo "$IMPL_FILENAME" | grep -qE '^impl-[a-z0-9-]+-task[0-9]+\.md$'; then
  echo -e "${RED}ERROR: Naming incorreto: $IMPL_FILENAME${NC}" >&2
  exit 2
fi

if echo "$IMPL_FILENAME" | grep -q '[A-Z]'; then
  echo -e "${RED}ERROR: Naming contém UPPERCASE${NC}" >&2
  exit 2
fi

# Módulo V2 válido
MODULO=$(echo "$IMPL_FILENAME" | sed -E 's/^impl-([a-z]+)-.*/\1/')
VALID_MODULES_V2="engine|seeds|endpoints|core|auth|eventos|entidades|tabelas|classes|common|channels|mcp|webhooks|automation|executions|flow-metrics|reports|email|permissoes|docs|agents"

if ! echo "$MODULO" | grep -qE "^($VALID_MODULES_V2)$"; then
  echo -e "${YELLOW}WARNING (V2): Módulo '$MODULO' fora da lista padrão${NC}" >&2
fi

IMPL_LINES=$(wc -l < "$LATEST_IMPL")
echo -e "${GREEN}OK${NC} Implementation notes: $IMPL_FILENAME ($IMPL_LINES linhas)"

TASK_NUM=$(echo "$IMPL_FILENAME" | grep -oE 'task[0-9]+' | grep -oE '[0-9]+' || echo "")

# 4. ESLint (errors fatal, warnings tolerados)
echo ""
echo "Executando ESLint..."
ESLINT_OUTPUT=$(npx eslint src/ --ext .ts --format json 2>/dev/null || true)
ERROR_COUNT=$(echo "$ESLINT_OUTPUT" | jq '[.[] | .errorCount] | add // 0' 2>/dev/null || echo 0)
WARNING_COUNT=$(echo "$ESLINT_OUTPUT" | jq '[.[] | .warningCount] | add // 0' 2>/dev/null || echo 0)

if [ "$ERROR_COUNT" -gt 0 ]; then
  echo -e "${RED}ERROR: ESLint $ERROR_COUNT errors${NC}" >&2
  npx eslint src/ --ext .ts >&2
  exit 2
fi

if [ "$WARNING_COUNT" -gt 5 ]; then
  echo -e "${YELLOW}WARNING: $WARNING_COUNT warnings (max sugerido: 5)${NC}"
else
  echo -e "${GREEN}OK${NC} ESLint: $ERROR_COUNT errors, $WARNING_COUNT warnings"
fi

# 5. console.log proibido (V2 — eslint deveria pegar, mas reforço)
if grep -rn "console\.log\|console\.debug" src/ --include="*.ts" 2>/dev/null | grep -v "// console.log" | grep -v "test\|spec" | head -1 >/dev/null; then
  echo -e "${RED}ERROR (V2): console.log detectado em src/!${NC}" >&2
  echo -e "${YELLOW}Use Logger do NestJS.${NC}" >&2
  grep -rn "console\.log\|console\.debug" src/ --include="*.ts" | grep -v "test\|spec" | head -5 >&2
  exit 2
fi

# 6. Pilar 1 violado: prisma.dPedido.create direto
PRISMA_PEDIDO_DIRECT=$(grep -rn "prisma\\.dPedido\\.create\\|prisma\\.dTitulo\\.create\\|prisma\\.dMovDispo\\.create" src/ --include="*.ts" 2>/dev/null | head -3 || true)
if [ -n "$PRISMA_PEDIDO_DIRECT" ]; then
  echo -e "${RED}ERROR (V2): Pilar 1 VIOLADO — Prisma direto em tabela transacional!${NC}" >&2
  echo "$PRISMA_PEDIDO_DIRECT" >&2
  echo -e "${YELLOW}Use OperacaoExecucaoClaude (ADR-V2-005).${NC}" >&2
  exit 2
fi

# 7. Git status
MODIFIED_COUNT=$(git status --porcelain | grep -c '^ M' || true)
CREATED_COUNT=$(git status --porcelain | grep -c '^??' || true)
echo -e "${GREEN}OK${NC} Mudanças: $MODIFIED_COUNT modificados, $CREATED_COUNT criados"

if [ -n "${TASK_NUM:-}" ]; then
  echo -e "${GREEN}OK${NC} Task #${TASK_NUM} — Implementation validada"
fi

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}IMPLEMENTAÇÃO V2 VALIDADA!${NC}"
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}OK${NC} Build: PASS ($BUILD_CMD)"
echo -e "${GREEN}OK${NC} TypeScript: 0 errors"
echo -e "${GREEN}OK${NC} ESLint: $ERROR_COUNT errors, $WARNING_COUNT warnings"
echo -e "${GREEN}OK${NC} Pilar 1: respeitado (sem prisma.dPedido.create direto)"
echo -e "${GREEN}OK${NC} console.log: ZERO em src/"
echo ""
echo -e "${GREEN}Pronto para Reviewer!${NC}"

exit 0

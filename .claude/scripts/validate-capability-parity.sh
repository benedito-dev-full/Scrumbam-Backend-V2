#!/bin/bash
# validate-capability-parity.sh (V2 — ADR-V2-079)
#
# Guard-rail de paridade Nexus <-> MCP + nao-regressao do wire MCP.
#
# Roda:
#   1. O GOLDEN TEST do MCP (baseline intocavel — ADR-V2-071/072/073).
#      Falha se QUALQUER resposta do MCP (initialize / tools/list / tools/call)
#      mudar sem re-baseline explicito.
#   2. O TESTE DE PARIDADE das Capabilities. Falha se uma capability existir num
#      adapter (MCP ou Nexus) e nao no outro SEM isencao declarada no manifesto
#      `src/common/tool-capabilities/capability-parity.manifest.ts`.
#
# Uso:
#   bash .claude/scripts/validate-capability-parity.sh
#
# Exit 0 = paridade + golden verdes. Exit != 0 = bloqueia (PR/CI).
#
# @see docs/plano — Onda 0 da unificacao Nexus<->MCP
# @see ADR-V2-079

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
NC='\033[0m'

echo "V2 (ADR-V2-079): golden MCP + paridade de Capabilities..." >&2

SPECS=(
  "src/mcp/__tests__/golden/mcp-wire.golden.spec.ts"
  "src/common/tool-capabilities/__tests__/capability-parity.spec.ts"
)

if ! npx jest "${SPECS[@]}" --silent > /tmp/capability-parity-v2.log 2>&1; then
  echo -e "${RED}V2 FALHOU: golden MCP e/ou paridade de Capabilities quebrou.${NC}" >&2
  echo "Se o wire do MCP mudou de PROPOSITO, re-baseline e um ato explicito e revisado no PR." >&2
  echo "Se a paridade quebrou, declare a isencao no manifesto OU migre a capability nos dois lados." >&2
  echo "Ultimas 30 linhas:" >&2
  tail -30 /tmp/capability-parity-v2.log >&2
  exit 1
fi

echo -e "${GREEN}V2 OK: golden MCP verde + paridade de Capabilities verde.${NC}" >&2
exit 0

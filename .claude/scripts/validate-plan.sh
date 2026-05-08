#!/bin/bash
# validate-plan.sh (V2)
# Stop hook for Strategist agent — V2 module list

set -euo pipefail

RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

echo "Validando plan do Strategist V2..."

PLAN_DIR="workspace/plans"

if [ ! -d "$PLAN_DIR" ]; then
  echo -e "${RED}ERROR: workspace/plans/ ausente!${NC}" >&2
  echo -e "${YELLOW}Criar: mkdir -p workspace/plans/${NC}" >&2
  exit 2
fi

LATEST_PLAN=$(find "$PLAN_DIR" -name "plan-*.md" -type f -print0 2>/dev/null | xargs -0 ls -t 2>/dev/null | head -1)

if [ -z "$LATEST_PLAN" ]; then
  echo -e "${RED}ERROR: Nenhum plan-*.md em workspace/plans/${NC}" >&2
  echo -e "${YELLOW}Strategist deve criar: plan-[modulo]-[descricao]-taskN.md${NC}" >&2
  exit 2
fi

echo -e "${GREEN}OK${NC} Plan encontrado: $(basename "$LATEST_PLAN")"

TASK_NUM=$(basename "$LATEST_PLAN" | grep -oE 'task[0-9]+' | grep -oE '[0-9]+' || echo "")
FILENAME=$(basename "$LATEST_PLAN")

# Naming
if ! echo "$FILENAME" | grep -qE '^plan-[a-z0-9-]+-task[0-9]+\.md$'; then
  echo -e "${RED}ERROR: Naming incorreto: $FILENAME${NC}" >&2
  echo -e "${YELLOW}Formato: plan-[modulo]-[descricao]-taskN.md${NC}" >&2
  exit 2
fi

if echo "$FILENAME" | grep -q '[A-Z]'; then
  echo -e "${RED}ERROR: Naming contém UPPERCASE: $FILENAME${NC}" >&2
  exit 2
fi

if echo "$FILENAME" | grep -q ' '; then
  echo -e "${RED}ERROR: Naming contém ESPAÇOS: $FILENAME${NC}" >&2
  exit 2
fi

# Módulos válidos V2 (lista oficial)
MODULO=$(echo "$FILENAME" | sed -E 's/^plan-([a-z]+)-.*/\1/')
VALID_MODULES_V2="engine|seeds|endpoints|core|auth|eventos|entidades|tabelas|classes|common|channels|mcp|webhooks|automation|executions|flow-metrics|reports|email|permissoes|docs|agents"

if ! echo "$MODULO" | grep -qE "^($VALID_MODULES_V2)$"; then
  echo -e "${YELLOW}WARNING (V2): Módulo '$MODULO' fora da lista padrão${NC}" >&2
  echo -e "${YELLOW}Módulos V2 válidos: engine, seeds, endpoints, core, auth, eventos, entidades, tabelas, classes, common, channels, mcp, webhooks, automation, executions, flow-metrics, reports, email, permissoes, docs, agents${NC}" >&2
fi

echo -e "${GREEN}OK${NC} Naming correto: $FILENAME"

# Tamanho mínimo
MIN_LINES=50
LINE_COUNT=$(wc -l < "$LATEST_PLAN")

if [ "$LINE_COUNT" -lt "$MIN_LINES" ]; then
  echo -e "${RED}ERROR: Plan muito curto: $LINE_COUNT linhas (mínimo: $MIN_LINES)${NC}" >&2
  echo -e "${YELLOW}Plan V2 deve incluir:${NC}" >&2
  echo "  - Análise (contexto, estado atual, ADRs V2 vinculados)" >&2
  echo "  - 2+ alternativas (prós/contras)" >&2
  echo "  - Avaliação dos 3 Pilares (OBRIGATÓRIA V2)" >&2
  echo "  - Estrutura técnica (arquivos, endpoints, queries)" >&2
  echo "  - Plano de implementação (fases)" >&2
  echo "  - Riscos + mitigações" >&2
  echo "  - Estimativa com buffer 20%" >&2
  echo "  - Critérios MUST/SHOULD/COULD/WILL NOT" >&2
  exit 2
fi

if [ "$LINE_COUNT" -lt 100 ]; then
  echo -e "${YELLOW}WARNING: Plan curto: $LINE_COUNT linhas (recomenda-se ≥100)${NC}" >&2
fi

echo -e "${GREEN}OK${NC} Tamanho adequado: $LINE_COUNT linhas"

# Conteúdo obrigatório V2
CONTENT=$(cat "$LATEST_PLAN")

if ! echo "$CONTENT" | grep -qiE "alternativa|opção|approach|opcao"; then
  echo -e "${YELLOW}WARNING: Plan pode não ter alternativas${NC}" >&2
fi

if ! echo "$CONTENT" | grep -qiE "risco|risk"; then
  echo -e "${YELLOW}WARNING: Plan pode não ter análise de riscos${NC}" >&2
fi

if ! echo "$CONTENT" | grep -qiE "fase|phase|step|etapa"; then
  echo -e "${YELLOW}WARNING: Plan pode não ter fases de implementação${NC}" >&2
fi

if ! echo "$CONTENT" | grep -qiE "estimativa|estimate|tempo"; then
  echo -e "${YELLOW}WARNING: Plan pode não ter estimativa de tempo${NC}" >&2
fi

# V2-específico: Avaliação 3 Pilares OBRIGATÓRIA
if ! echo "$CONTENT" | grep -qiE "pilar 1|pilar 2|pilar 3|3 pilares"; then
  echo -e "${RED}ERROR (V2): Plan não menciona os 3 Pilares!${NC}" >&2
  echo -e "${YELLOW}Avaliação dos 3 Pilares é OBRIGATÓRIA em todo plan V2.${NC}" >&2
  echo -e "${YELLOW}Adicionar seção '## 3. Avaliação dos 3 Pilares'${NC}" >&2
  exit 2
fi

# V2-específico: ADR vinculado se decisão arquitetural
if echo "$CONTENT" | grep -qiE "decisão arquitetural|arquitetura nova|nova convenção"; then
  if ! echo "$CONTENT" | grep -qiE "ADR-V2-[0-9]+"; then
    echo -e "${YELLOW}WARNING (V2): Plan menciona decisão arquitetural mas sem ADR-V2-XXX vinculado${NC}" >&2
  fi
fi

if [ -n "${TASK_NUM:-}" ]; then
  echo -e "${GREEN}OK${NC} Task #${TASK_NUM} — Plan validado"
fi

echo ""
echo -e "${GREEN}Plan V2 validações OK!${NC}"
echo -e "${GREEN}OK${NC} File: $FILENAME"
echo -e "${GREEN}OK${NC} Linhas: $LINE_COUNT"
echo ""

exit 0

#!/usr/bin/env bash
# validate-evolution-impact.sh
# Hook PreCommit: valida presença de "Generator-impact:" no body do commit
# quando o PR tem label "evolution-candidate".
#
# Implementação do ADR-V2-017 (V2↔Generator Feedback Loop) e §8 do plano-mestre.
#
# Comportamento:
# - Se não há label "evolution-candidate" no PR atual (ou commit não associado a PR): exit 0
# - Se há label E body do commit não tem "Generator-impact:" + "Evolution-issue:": exit 2 (BLOQUEIA)
# - Caso contrário: exit 0
#
# Variáveis esperadas:
#   GIT_COMMIT_MSG_FILE — arquivo da mensagem (PreCommit) ou
#   1º arg — mensagem inline para teste

set -euo pipefail

MSG_FILE="${GIT_COMMIT_MSG_FILE:-${1:-}}"

if [ -z "$MSG_FILE" ]; then
    echo "[validate-evolution-impact] Sem mensagem para validar — skip."
    exit 0
fi

# Lê a mensagem
if [ -f "$MSG_FILE" ]; then
    MSG=$(cat "$MSG_FILE")
else
    MSG="$MSG_FILE"
fi

# Tenta detectar PR atual (gh pr view current branch)
PR_LABELS=""
if command -v gh >/dev/null 2>&1; then
    PR_LABELS=$(gh pr view --json labels --jq '.labels[].name' 2>/dev/null | tr '\n' ' ' || true)
fi

# Se não há label evolution-candidate, hook é no-op
if ! echo "$PR_LABELS" | grep -q "evolution-candidate"; then
    echo "[validate-evolution-impact] PR sem label 'evolution-candidate' — skip."
    exit 0
fi

# PR tem label — body do commit DEVE ter Generator-impact e Evolution-issue
HAS_IMPACT=0
HAS_ISSUE=0

if echo "$MSG" | grep -qE "^- *Generator-impact:"; then
    HAS_IMPACT=1
fi

if echo "$MSG" | grep -qE "^- *Evolution-issue:"; then
    HAS_ISSUE=1
fi

if [ $HAS_IMPACT -eq 1 ] && [ $HAS_ISSUE -eq 1 ]; then
    echo "[validate-evolution-impact] OK — Generator-impact e Evolution-issue presentes."
    exit 0
fi

# Falha — bloqueia commit
echo ""
echo "❌ BLOQUEADO: PR tem label 'evolution-candidate' mas o commit não documenta o impacto."
echo ""
echo "Adicione ao body do commit (Conventional Commits):"
echo ""
echo "    - Generator-impact: <resumo 1 linha do que está fora do escopo do template>"
echo "    - Evolution-issue: <link da issue 'evolution-from-v2' aberta no Devari-Core>"
echo ""
echo "Referência: ADR-V2-017 + §8 do 00-PLANO-MESTRE.md"
echo "Índice mestre: docs/lessons/issues-evolution-from-v2.md"
echo ""
exit 2

#!/bin/bash
# session-setup.sh (V2)
# SessionStart hook — checks V2 environment prerequisites

set -euo pipefail

ERRORS=0
WARNINGS=0
CONTEXT=""

# Check 1: Node.js
if ! command -v node &>/dev/null; then
  CONTEXT+="ERROR: Node.js não encontrado.\n"
  ERRORS=$((ERRORS + 1))
else
  CONTEXT+="Node.js: $(node --version)\n"
fi

# Check 2: node_modules
if [ ! -d "node_modules" ]; then
  CONTEXT+="WARNING: node_modules ausente. Rode 'npm install'.\n"
  WARNINGS=$((WARNINGS + 1))
else
  CONTEXT+="node_modules: OK\n"
fi

# Check 3: Prisma client
if [ ! -d "node_modules/.prisma/client" ]; then
  CONTEXT+="WARNING: Prisma client não gerado. Rode 'npx prisma generate'.\n"
  WARNINGS=$((WARNINGS + 1))
else
  CONTEXT+="Prisma client: OK\n"
fi

# Check 4: .env
if [ ! -f ".env" ] && [ ! -f ".env.local" ]; then
  CONTEXT+="WARNING: .env / .env.local ausente.\n"
  WARNINGS=$((WARNINGS + 1))
else
  CONTEXT+=".env: OK\n"
fi

# Check 5: docker-compose status (V2-específico — Postgres+Redis)
if command -v docker &>/dev/null; then
  POSTGRES_UP=$(docker ps --filter "name=postgres" --filter "status=running" -q 2>/dev/null | wc -l | tr -d ' ')
  REDIS_UP=$(docker ps --filter "name=redis" --filter "status=running" -q 2>/dev/null | wc -l | tr -d ' ')
  if [ "$POSTGRES_UP" -eq 0 ] || [ "$REDIS_UP" -eq 0 ]; then
    CONTEXT+="WARNING: docker-compose Postgres/Redis não rodando. Rode 'docker compose up -d'.\n"
    WARNINGS=$((WARNINGS + 1))
  else
    CONTEXT+="docker (postgres+redis): OK\n"
  fi
fi

# Check 6: Branch
BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")
CONTEXT+="Git branch: $BRANCH\n"

# Check 7: Modified files
MODIFIED=$(git status --porcelain 2>/dev/null | wc -l | tr -d ' ')
CONTEXT+="Arquivos modificados: $MODIFIED\n"

# Check 8: workspace/
if [ ! -d "workspace" ]; then
  CONTEXT+="WARNING: workspace/ ausente. Multi-agent precisa.\n"
  WARNINGS=$((WARNINGS + 1))
else
  CONTEXT+="workspace/: OK\n"
fi

# Check 9: CLAUDE.md raiz V2
if [ ! -f "CLAUDE.md" ]; then
  CONTEXT+="WARNING: CLAUDE.md raiz V2 ausente (declaração de submissão ao template).\n"
  WARNINGS=$((WARNINGS + 1))
else
  CONTEXT+="CLAUDE.md raiz V2: OK\n"
fi

# Check 10: seed canônico V2 (≥90 DClasses)
if [ -f "prisma/seeds/classes.seed.ts" ]; then
  CLASSES=$(grep -c "chave:" prisma/seeds/classes.seed.ts 2>/dev/null || echo "0")
  CONTEXT+="DClasses no seed: $CLASSES (esperado: ≥90 quando F1 fechar)\n"
  if [ "$CLASSES" -lt 90 ] && [ "$CLASSES" -gt 0 ]; then
    WARNINGS=$((WARNINGS + 1))
  fi
else
  CONTEXT+="prisma/seeds/classes.seed.ts: ainda não criado (Fase 1 cria)\n"
fi

# Check 11: schema.prisma com 17 tabelas
if [ -f "prisma/schema.prisma" ]; then
  MODELS=$(grep -cE '^model ' prisma/schema.prisma 2>/dev/null || echo "0")
  CONTEXT+="Modelos no schema.prisma: $MODELS (esperado: 17 quando F1 fechar)\n"
  if [ "$MODELS" -gt 17 ]; then
    CONTEXT+="ALERTA: schema com >17 modelos — possível tabela nova introduzida.\n"
    WARNINGS=$((WARNINGS + 1))
  fi
fi

# Persistir env
if [ -n "${CLAUDE_ENV_FILE:-}" ]; then
  echo "export SCRUMBAN_V2_SESSION=true" >> "$CLAUDE_ENV_FILE"
  echo "export SCRUMBAN_V2_BRANCH=$BRANCH" >> "$CLAUDE_ENV_FILE"
fi

# Output
echo "=== Scrumban-Backend-V2 Session Setup ==="
echo -e "$CONTEXT"

if [ "$ERRORS" -gt 0 ]; then
  echo "RESULT: $ERRORS erros, $WARNINGS warnings"
  echo "Corrigir erros antes de iniciar trabalho."
else
  echo "RESULT: Ambiente OK ($WARNINGS warnings)"
fi

exit 0

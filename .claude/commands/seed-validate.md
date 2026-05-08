# /seed-validate — Validação do seed canônico V2 (Pilar 3)

Você valida que o seed `prisma/seeds/classes.seed.ts` está correto contra o §3 do plano-mestre V2.

## Checagens

```bash
SEED="prisma/seeds/classes.seed.ts"

if [ ! -f "$SEED" ]; then
  echo "❌ FATAL: $SEED ausente. Sistema NÃO INICIA sem seed (Pilar 3)."
  exit 1
fi

echo "=== Validação Seed V2 ==="

# 1. Total
TOTAL=$(grep -c "chave:" "$SEED")
echo "Total DClasses: $TOTAL (esperado: ~120 — 50 fixas + ~70 V2)"

# 2. Spread classesFixas
if grep -q "...classesFixas" "$SEED"; then
  echo "✅ classesFixas spread presente"
else
  echo "❌ ERROR: classesFixas spread ausente!"
fi

# 3. Chaves NEGATIVAS apenas
POSITIVE=$(grep -E "chave: [^-]" "$SEED" | wc -l | tr -d ' ')
if [ "$POSITIVE" -eq 0 ]; then
  echo "✅ Todas chaves NEGATIVAS"
else
  echo "❌ ERROR: $POSITIVE chaves POSITIVAS detectadas (seed deve ter chaves negativas):"
  grep -E "chave: [^-]" "$SEED" | head -5
fi

# 4. NÃO sequestrar canônicas
HIJACKED=""
for chave in -40 -45 -47 -49 -50; do
  if grep -E "chave: ${chave}\\b" "$SEED" | grep -v "classesFixas" > /dev/null; then
    HIJACKED+="$chave "
  fi
done

if [ -z "$HIJACKED" ]; then
  echo "✅ Sem sequestro canônico (-40, -45, -47, -49, -50)"
else
  echo "❌ ERROR: Sequestro canônico detectado: $HIJACKED"
fi

# 5. Range V2-específicas: -150..-529
OUT_OF_RANGE=$(grep -oE "chave: -[0-9]+" "$SEED" | grep -oE "[0-9]+" | awk '$1 > 110 && ($1 < 150 || $1 > 529) {count++} END {print count+0}')
if [ "$OUT_OF_RANGE" -eq 0 ] || [ -z "$OUT_OF_RANGE" ]; then
  echo "✅ Chaves V2 dentro do range -150..-529"
else
  echo "🟡 WARNING: $OUT_OF_RANGE chaves fora do range V2-específico"
fi

# 6. DClasses V2 obrigatórias (do §3.2 plano-mestre)
echo ""
echo "Checando DClasses V2 obrigatórias do §3.2 plano-mestre..."
REQUIRED_KEYS=(
  -150 # USER
  -151 # PLATFORM_SCRUMBAN
  -152 # ORGANIZATION
  -156 # AGENT
  -180 # TEAM
  -160 # ORG_USER_LINK
  -170 # PROJECT_USER_LINK
  -300 # EXECUTION
  -301 -302 -303 # EXEC_LOW/MED/HIGH
  -400 # SPRINT
  -420 # PRIORITY
  -430 # TASK_TYPE
  -440 # STATUS_INTENTION_V3
  -441 -442 -443 -444 # INBOX, READY, EXECUTING, DONE
  -450 # CHANNEL
  -470 # WEBHOOK
  -490 # NOTIFICATION
)

MISSING=0
for k in "${REQUIRED_KEYS[@]}"; do
  if ! grep -q "chave: ${k}\\b" "$SEED"; then
    echo "  ❌ Faltando: $k"
    MISSING=$((MISSING + 1))
  fi
done

if [ "$MISSING" -eq 0 ]; then
  echo "✅ Todas DClasses obrigatórias V2 presentes"
else
  echo "❌ ERROR: $MISSING DClasses obrigatórias ausentes"
fi

# 7. Validação de hierarquia (todos idPai existem)
echo ""
echo "Validando hierarquia idPai..."
# Esta requer node + tsx para realmente parsear — simplificação shell:
echo "(Validação completa via prisma db seed — Implementer)"

echo ""
echo "=== Fim Validação ==="
```

Se algum check falhar 🔴, BLOQUEAR avanço de fase.

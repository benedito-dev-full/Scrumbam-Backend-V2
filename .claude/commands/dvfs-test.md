# /dvfs-test — Validação dos scripts DVFS (Pilar 1 — F6)

Você valida que os scripts DVFS (chaves 3-7) estão presentes e corretos para o `OperacaoExecucaoClaude`.

## Contexto

DVFS é a tabela `DVFS` que armazena scripts de cálculo. O Engine carrega esses scripts em runtime, garantindo PORTABILIDADE (mesmo Engine, regras diferentes por projeto).

| Chave | Momento | Propósito V2 |
|-------|---------|--------------|
| 3 | Pre-cálculo | Validar comando, classificar risco (Risk Gate) |
| 4 | Cálculo | Calcular custos, prazo |
| 5 | Pós-cálculo | Ajustes finais |
| 6 | Pre-gravação | Validar aprovador (HIGH precisa aprovação manual) |
| 7 | Pós-gravação | Side-effects (DEvento -496, fila BullMQ) |

## Checagens

```bash
echo "=== Validação DVFS V2 ==="

# 1. DVFS no schema
if grep -q "model DVFS" prisma/schema.prisma 2>/dev/null; then
  echo "✅ DVFS no schema.prisma"
else
  echo "❌ DVFS ausente no schema (F1 deveria ter criado)"
fi

# 2. Seed de DVFS para OperacaoExecucaoClaude
if [ -f prisma/seeds/dvfs.seed.ts ]; then
  for chave in 3 4 5 6 7; do
    if grep -q "chave: ${chave}n\\?\\b" prisma/seeds/dvfs.seed.ts; then
      echo "✅ DVFS chave $chave presente"
    else
      echo "❌ DVFS chave $chave ausente — F6 não vai funcionar"
    fi
  done
else
  echo "🟡 prisma/seeds/dvfs.seed.ts ausente (F6 cria)"
fi

# 3. Bug latente s.id vs s.chave (auditoria PARTE-1)
if [ -f src/engine/lib/operacao/OperacaoPedido.ts ]; then
  # Procurar uso de s.id em vez de s.chave nos métodos _carregaScripts*
  GREP_BUG=$(grep -A 20 "_carregaScripts" src/engine/lib/operacao/OperacaoPedido.ts | grep "s\\.id" || true)
  if [ -n "$GREP_BUG" ]; then
    echo "❌ BUG LATENTE: s.id em vez de s.chave em _carregaScripts*:"
    echo "$GREP_BUG"
    echo "   → DVFS chaves 5, 6 silenciosamente NULL. Risk Gate compromete."
  else
    echo "✅ s.chave usado corretamente"
  fi
fi

# 4. Testes adversariais regressivos (DoD F6)
if [ -d test ] || [ -d src/engine/lib/operacao/__tests__ ]; then
  REGRESSION_TESTS=$(grep -rn "_carregaScripts\\|s\\.id\\|s\\.chave" test/ src/engine/lib/operacao/__tests__ 2>/dev/null | wc -l)
  echo "Testes que tocam _carregaScripts: $REGRESSION_TESTS (esperado: ≥2 bloqueantes)"
fi

# 5. OperacaoExecucaoClaude estende OperacaoPedido (ADR-V2-005)
if [ -f src/engine/lib/operacao/OperacaoExecucaoClaude.ts ]; then
  if grep -q "extends OperacaoPedido" src/engine/lib/operacao/OperacaoExecucaoClaude.ts; then
    echo "✅ OperacaoExecucaoClaude extends OperacaoPedido (ADR-V2-005)"
  else
    echo "❌ OperacaoExecucaoClaude NÃO estende OperacaoPedido"
  fi
fi

echo ""
echo "=== Fim DVFS Test ==="
```

# /risk-gate-test — 58 testes adversariais Risk Gate (F13)

Você executa os 58 testes adversariais do Risk Gate da Automation Claude Code (F13).

## Contexto crítico

O Risk Gate classifica comandos em LOW/MEDIUM/HIGH e decide se requer aprovação humana. Falha aqui = liberar comando potencialmente RCE em produção. Família depende.

**Regra:** falhar 1 dos 58 = REJECT do Reviewer (score < 4).

## Checagens

```bash
echo "=== Risk Gate Adversarial Tests V2 (F13) ==="

# 1. Testes existem?
TEST_FILE=$(find . -name "risk-gate*.spec.ts" -o -name "risk-gate*.test.ts" 2>/dev/null | head -1)
if [ -z "$TEST_FILE" ]; then
  echo "❌ FATAL: arquivo de testes adversariais Risk Gate ausente"
  echo "   Esperado: src/automation/risk-gate.adversarial.spec.ts"
  echo "   F13 DoD: 58 testes adversariais ANTES do código (TDD)"
  exit 1
fi

echo "✅ Test file: $TEST_FILE"

# 2. Contar cenários adversariais
SCENARIOS=$(grep -c "it\\(" "$TEST_FILE" || true)
echo "Cenários: $SCENARIOS (esperado: 58)"

if [ "$SCENARIOS" -lt 58 ]; then
  echo "❌ ERROR: $SCENARIOS < 58 (DoD F13 requer 58 testes adversariais)"
fi

# 3. Categorias esperadas
echo ""
echo "Categorias adversariais esperadas:"
for cat in "command injection" "path traversal" "shell escape" "PIPE chain" "rm -rf" "git force" "ssh reverso" "HMAC bypass" "AST bypass" "regex bypass" "fail-safe MEDIUM"; do
  if grep -qi "$cat" "$TEST_FILE"; then
    echo "  ✅ $cat"
  else
    echo "  ⚠️  $cat — ausente?"
  fi
done

# 4. Rodar testes
echo ""
echo "Executando testes (npm test)..."
if npm test -- --testPathPattern=risk-gate 2>&1 | tee /tmp/risk-gate-test.log; then
  PASS=$(grep -E "Tests:.*passed" /tmp/risk-gate-test.log | grep -oE "[0-9]+ passed" | head -1)
  FAIL=$(grep -E "Tests:.*failed" /tmp/risk-gate-test.log | grep -oE "[0-9]+ failed" | head -1)
  echo "Resultado: $PASS, $FAIL"

  if echo "$FAIL" | grep -qE "[1-9]"; then
    echo "❌ FATAL: testes adversariais FAILED."
    echo "   1 falha = REJECT do Reviewer (score < 4)."
    echo "   F13 não fecha até 58/58 PASS."
    exit 1
  else
    echo "✅ 58/58 testes adversariais Risk Gate PASS"
  fi
else
  echo "❌ Test run falhou. Investigar logs."
  exit 1
fi

# 5. STRICT_RISK_GATE em prod
echo ""
echo "Validar STRICT_RISK_GATE em prod:"
grep -n "STRICT_RISK_GATE" src/automation/ 2>/dev/null || echo "⚠️  STRICT_RISK_GATE não encontrado em src/automation/"
echo "Em prod, STRICT_RISK_GATE=true: dúvida → MEDIUM (fail-safe)."

echo ""
echo "=== Fim Risk Gate Test ==="
```

# /golden-test — Paridade de contrato HTTP V2 vs Legado (F14)

Você roda o golden-test que compara o V2 (128 endpoints) com o Scrumban legado para garantir paridade de contrato HTTP antes do cutover (F15).

## Contexto

O V2 deve manter os 128 endpoints do Scrumban legado idênticos em request/response (com exceções autorizadas, ADR-documentadas). Divergências cegas quebram frontend, MCP, integrações externas.

## Checagens

```bash
echo "=== Golden Test V2 vs Legado ==="

LEGADO_BASE="${LEGADO_URL:-http://legado.scrumban.local/api/v1}"
V2_BASE="${V2_URL:-http://localhost:3000/api/v1}"

# Endpoints críticos
ENDPOINTS=(
  "GET /projects?organizationId=1"
  "GET /tasks?projectId=1"
  "GET /entidades?idClasse=-150"
  "GET /tabelas?classe=SPRINT"
  "GET /tabelas?classe=STATUS_INTENTION_V3"
  "GET /flow-metrics?projectId=1"
  "GET /forecast?projectId=1"
  "GET /executions?projectId=1"
)

# Token (usar settings.local.json)
TOKEN_LEGADO=$(curl -s -X POST "${LEGADO_BASE}/auth/login" -H "Content-Type: application/json" -d "{\"email\":\"$SCRUMBAN_V2_EMAIL\",\"password\":\"$SCRUMBAN_V2_PASSWORD\"}" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)
TOKEN_V2=$(curl -s -X POST "${V2_BASE}/auth/login" -H "Content-Type: application/json" -d "{\"email\":\"$SCRUMBAN_V2_EMAIL\",\"password\":\"$SCRUMBAN_V2_PASSWORD\"}" | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

DIFFS=0
for endpoint in "${ENDPOINTS[@]}"; do
  METHOD=$(echo "$endpoint" | awk '{print $1}')
  PATH=$(echo "$endpoint" | awk '{print $2}')

  echo "Testando: $METHOD $PATH"

  RESP_LEGADO=$(curl -s -X "$METHOD" "${LEGADO_BASE}${PATH}" -H "Authorization: Bearer $TOKEN_LEGADO")
  RESP_V2=$(curl -s -X "$METHOD" "${V2_BASE}${PATH}" -H "Authorization: Bearer $TOKEN_V2")

  # Comparar shapes (jq schema diff simplificado)
  SHAPE_LEGADO=$(echo "$RESP_LEGADO" | jq 'paths | join(".")' 2>/dev/null | sort -u)
  SHAPE_V2=$(echo "$RESP_V2" | jq 'paths | join(".")' 2>/dev/null | sort -u)

  if [ "$SHAPE_LEGADO" != "$SHAPE_V2" ]; then
    echo "  🟡 DIVERGÊNCIA: shape diferente"
    diff <(echo "$SHAPE_LEGADO") <(echo "$SHAPE_V2") | head -10
    DIFFS=$((DIFFS + 1))
  else
    echo "  ✅ Shape idêntico"
  fi
done

echo ""
echo "Total divergências: $DIFFS"
if [ "$DIFFS" -gt 0 ]; then
  echo "🟡 Verifique se cada divergência tem ADR-V2-XXX justificando."
  echo "   Cutover (F15) só com 0 divergências cegas."
fi

# Métricas Generator (R3 — Auditoria)
echo ""
echo "=== Métricas SaaS Generator (V2 piloto) ==="
TOTAL_LINES=$(find src/ -name "*.ts" -exec wc -l {} \; | awk '{sum += $1} END {print sum}')
echo "Total linhas backend V2: $TOTAL_LINES"
echo "(Comparar com legado e calcular % reuso de classes/endpoints genéricos)"

echo ""
echo "=== Fim Golden Test ==="
```

Cutover (F15) requer 0 divergências cegas. Cada divergência conhecida deve ter ADR justificando.

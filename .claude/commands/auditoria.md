# /auditoria — Auditoria canônica do V2

Você executa uma auditoria rápida do estado do Scrumban-Backend-V2 contra os pilares e ADRs canônicos.

## Checagens

```bash
echo "=== Auditoria V2 ==="

echo ""
echo "1. Estrutura .claude/"
ls -la .claude/agents/ .claude/scripts/ .claude/rules/ .claude/agent-memory/ .claude/commands/ 2>&1 | head -40

echo ""
echo "2. Schema Prisma — 17 tabelas"
if [ -f prisma/schema.prisma ]; then
  MODELS=$(grep -cE '^model ' prisma/schema.prisma)
  echo "Modelos: $MODELS (esperado: 17)"
  grep -E '^model ' prisma/schema.prisma
else
  echo "schema.prisma ainda não criado (F1 cria)"
fi

echo ""
echo "3. Seed de DClasses (Pilar 3)"
if [ -f prisma/seeds/classes.seed.ts ]; then
  TOTAL=$(grep -c "chave:" prisma/seeds/classes.seed.ts)
  POSITIVE=$(grep -E "chave: [^-]" prisma/seeds/classes.seed.ts | wc -l)
  HIJACKED=$(grep -E "chave: -(40|45|47|49|50)\\b" prisma/seeds/classes.seed.ts | wc -l)
  echo "Total: $TOTAL classes (esperado: ≥90, meta ~120)"
  echo "Chaves positivas: $POSITIVE (esperado: 0)"
  echo "Sequestro canônico (-40,-45,-47,-49,-50): $HIJACKED (esperado: 0)"
else
  echo "Seed ainda não criado (F1 cria)"
fi

echo ""
echo "4. Pilar 1 (Engine apenas em DPedido idClasse=-300)"
echo "   Engine usado:"
grep -rn "new OperacaoExecucaoClaude" src/ --include="*.ts" 2>/dev/null | wc -l
echo "   Prisma direto em transacional (esperado: 0):"
grep -rn "prisma\\.dPedido\\.create\\|prisma\\.dTitulo\\.create\\|prisma\\.dMovDispo\\.create" src/ --include="*.ts" 2>/dev/null | wc -l

echo ""
echo "5. Pilar 2 (controllers duplicados proibidos)"
echo "   user/organization/status/sprint controllers (esperado: 0 OU wrapper thin com README):"
find src/ -name "user.controller.ts" -o -name "organization.controller.ts" -o -name "status.controller.ts" -o -name "sprint.controller.ts" 2>/dev/null

echo ""
echo "6. Console.log proibido"
grep -rn "console\\.log\\|console\\.debug" src/ --include="*.ts" 2>/dev/null | grep -v "test\\|spec" | wc -l

echo ""
echo "7. ADRs V2 redigidos"
ls docs/decisions/adr-v2-*.md 2>/dev/null | wc -l
echo "   (meta: 14 ADRs até F17 — ADR-V2-001 a ADR-V2-014)"

echo ""
echo "8. workspace/ (multi-agent)"
ls workspace/ 2>/dev/null
echo "   STATUS.md existe?"
ls workspace/STATUS.md 2>/dev/null || echo "   AUSENTE"

echo ""
echo "9. CHANGELOG / ROADMAP"
ls docs/CHANGELOG.md docs/ROADMAP.md 2>/dev/null

echo ""
echo "=== Fim Auditoria V2 ==="
```

Após rodar, listar issues encontrados em formato:
- 🔴 CRÍTICO: ...
- 🟡 MÉDIO: ...
- 🟢 OK: ...

---
name: template-review-report
description: Template Markdown completo usado para redigir workspace/reviews/review-*.md.
metadata:
  type: reference
---

# Template de Review Report (V2)

Copiar e preencher ao redigir `workspace/reviews/review-[modulo]-[descricao]-task[N].md`.

```markdown
# Review Report: Task [N] — [Nome] (V2 Fase F[X])

**Reviewed by:** Reviewer Agent V2
**Date:** [YYYY-MM-DD]
**Module:** [modulo V2]

## Resultado Final

### [APPROVED | REJECTED | NEEDS_CHANGES] — Score: [X.X]/10

[Uma frase resumindo]

## Testes Automatizados
- Build: [PASS/FAIL]
- TypeScript: [N] errors
- ESLint: [N] errors, [N] warnings

## Validação 3 Pilares
- Pilar 1 (Engine): [OK | VIOLADO]
- Pilar 2 (Endpoints): [OK | VIOLADO]
- Pilar 3 (Seed): [OK | N/A | VIOLADO]
- Genericidade V2: [OK | Issue]

## Validação V2
- ZERO tabela nova: [OK | VIOLADO]
- DClasses no range -150..-529: [OK | VIOLADO]
- ADRs V2 respeitados: [OK | VIOLADO ADR-V2-XXX]
- F13 (se aplicável): 58 testes adversariais [N/58 passaram]

## Checklist 12 Itens
[1-12 com score parcial]

**Score Final:** [X.X]/10

## Issues
**CRITICAL:** [None | lista]
**MEDIUM:** [None | lista]
**MINOR:** [None | lista]

## Decisão: [APPROVED | REJECTED | NEEDS_CHANGES]

**Justificativa:** [razão]

**Próximo:** [Documenter | Implementer corrige (resume agentId)]
```

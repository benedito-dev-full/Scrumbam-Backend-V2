# Reviewer Agent Memory — Scrumban-Backend-V2

**Versão:** 1.3
**Última atualização:** 2026-07-09

---

## INSTRUÇÕES DE USO

- Consultar **ANTES** de revisar.
- Este índice fica sob 140 linhas — detalhe vive nos arquivos de tópico linkados abaixo.
- Registrar issues recorrentes, scores e padrões aprendidos nos arquivos de tópico após cada review (não aqui).

**Arquivos de tópico:**
- [score-history.md](score-history.md) — histórico completo de scores por task/módulo/fase (calibração).
- [patterns-learned.md](patterns-learned.md) — padrões técnicos por fase/módulo (RBAC, HMAC, N+1, seed, agent/).
- [padroes-violados-recorrentes.md](padroes-violados-recorrentes.md) — antipadrões que se repetem entre módulos.
- [template-review-report.md](template-review-report.md) — template completo do relatório de review.

---

## CONTEXTO V2

Revisão de código backend do **Scrumban-Backend-V2**, refundação canônica.

**Repositório:** `/Users/devaritecnologia/Documents/Benedito/Scrumban-Backend-V2/`
**Modelo:** Sonnet (hardcoded — decisão de custo)
**Score gate:** APPROVED ≥ 7.0 (regra mecânica via hook `validate-review-score.sh`)

**Família depende.** F13 (Automation com Risk Gate) é a mais arriscada — aprovar com score 6 = liberar comando potencialmente RCE em produção.

---

## REJEIÇÕES AUTOMÁTICAS V2 (HARD GATES — SCORE < 5)

| Violação | Verificação | Score |
|----------|-------------|-------|
| **Build falha** | `make build` ou `npm run build` | 0/10 — REJECT |
| **TypeScript errors** (introduzidos, não baseline) | `npx tsc --noEmit` + `git stash -u` p/ isolar baseline | 0/10 — REJECT |
| **ESLint errors** | `npx eslint src/ --max-warnings 0` | 0/10 — REJECT |
| **Modelo novo no schema.prisma** | `grep -E '^model ' prisma/schema.prisma \| wc -l` ≠ 17 | 0/10 — REJECT |
| **Coluna nova em tabela canônica sem ADR** | `git diff prisma/schema.prisma` + checar `docs/decisions/` | <5/10 — REJECT |
| **Pilar 1 violado:** `prisma.dPedido.create()`/`dTitulo.create()` direto | `grep -rn "prisma\\.dPedido\\.create\\|prisma\\.dTitulo\\.create" src/` | <4/10 — REJECT |
| **Pilar 1 abusado:** Engine em estrutural (DEntidade/DTask/DProject/DTabela) | `grep -rn "new OperacaoPedido\\|new OperacaoExecucaoClaude" src/` em módulos errados | <5/10 — REJECT |
| **Pilar 3 violado:** seed faltando | `ls prisma/seeds/classes.seed.ts` | <4/10 — REJECT |
| **Pilar 3 violado:** chave POSITIVA no seed | `grep -E "chave: [^-]" prisma/seeds/classes.seed.ts` | <4/10 — REJECT |
| **Pilar 3 violado:** sequestro canônica (-40, -45, -47, -49, -50, -1..-110) | grep nas chaves específicas | <5/10 — REJECT |
| **N+1 query** | DATABASE_LOGGING=true → >20 queries/request, ou loop com await individual | <6/10 — REJECT |
| **Eventos antes de persistir** | leitura crítica do código; evento deve vir após `await $transaction`/`.create()` resolver | <6/10 — REJECT |
| **F13 Risk Gate falho:** comando perigoso liberado como LOW | rodar 58 testes adversariais; falhar 1 = REJECT | <4/10 — REJECT |
| **taskId (ou qualquer ID de tabela sem FK)** em `DEvento.idEntidade` | grep no service; deve ir em `identificadorExterno` (ADR-V2-058) | <5/10 — REJECT |

## REJEIÇÕES SUAVES (NEEDS_CHANGES — SCORE 5-6.9)

| Violação | Score |
|----------|-------|
| **Pilar 2 violado:** UserController/OrganizationController/StatusController/SprintController sem justificativa de wrapper | 5-6 |
| **`console.log`** (eslint deveria ter pego) | 6 |
| **DatabaseService usado em vez de PrismaService** | 6 |
| **`parseInt(id)` em vez de `BigInt(id)`** | 6 |
| **`setHours()` em vez de `TimezoneService`** | 6 |
| **Falta JSDoc em métodos públicos críticos** | 6.5 |
| **Falta Guard em endpoint privado** | 6 |
| **Convenção `?classe` vs `?idClasse` divergente** | 6.5 (até ratificar ADR-V2-016; não rejeitar só por isso) |

---

## SCORE GUIDELINES V2

| Score | Decisão | Significado |
|-------|---------|-------------|
| **9.0-10** | APPROVED | Excelente. Todos CRÍTICOS + ALTOS OK; 3 Pilares respeitados; código exemplar |
| **8.0-8.9** | APPROVED | Muito bom. CRÍTICOS OK; ALTOS maioria OK; pequenos issues sem bloqueio |
| **7.0-7.9** | APPROVED | Bom (mínimo aprovável). CRÍTICOS OK; alguns ALTOS com issues menores |
| **5.0-6.9** | NEEDS_CHANGES | CRÍTICOS OK mas ALTOS com issues OU 1 Pilar parcialmente violado |
| **<5.0** | REJECTED | CRÍTICOS com falhas OU múltiplos Pilares violados OU RCE OU tabela nova |

**Hook `validate-review-score.sh` REJEITA mecanicamente:** APPROVED com score <7.0; decisão sem score numérico (`[0-9]+\.?[0-9]*/10`); decisão fora de {APPROVED, REJECTED, NEEDS_CHANGES}.

---

## CHECKLIST 12 ITENS V2

**CRÍTICO** (falha → score <5): 1. Build PASS · 2. TypeScript 0 errors novos · 3. Engine APENAS em DPedido transacional · 4. Seed de Classes completo/negativo · 5. N+1 ZERO

**ALTO** (-1 a -2 cada): 6. PrismaService (não DatabaseService) · 7. BigInt para IDs · 8. Transactions multi-tabela · 9. TimezoneService · 10. Eventos APÓS persistência

**MÉDIO** (-0.5 cada): 11. Endpoints genéricos reutilizados (Pilar 2) · 12. Genericidade V2 (cabe nas 17 tabelas, sem coluna nova injustificada)

**BAIXO** (-0.25 cada): DTOs class-validator+Swagger · Guards em privados · Logger (não console.log) · JSDoc em públicos · Imports organizados

---

## COMANDOS DE VALIDAÇÃO RÁPIDA

```bash
# 17 tabelas canônicas — nem uma a mais
grep -E '^model ' prisma/schema.prisma | wc -l  # esperado: 17

# Seed: negativo apenas, sem sequestro
grep -E "chave: [^-]" prisma/seeds/classes.seed.ts        # esperado: vazio
grep -E "chave: -(40|45|47|49|50)\b" prisma/seeds/classes.seed.ts  # esperado: vazio (fintech reservado)

# Engine NÃO abusado em estrutural / Prisma direto NÃO em transacional
grep -rn "new OperacaoPedido\|new OperacaoExecucaoClaude" src/ | grep -vE "(engine|executions|automation)/"
grep -rn "prisma\.dPedido\.create\|prisma\.dTitulo\.create" src/   # esperado: vazio

# Controllers duplicados proibidos (Pilar 2)
find src/ -name "user.controller.ts" -o -name "organization.controller.ts" -o -name "status.controller.ts"
# Wrappers thin autorizados exigem README.md no próprio diretório

# Baseline TS/lint pré-existente (isolar da task atual)
git stash -u -- <arquivos-da-task> && npx tsc --noEmit | grep -c "error TS" && npm run build; git stash pop

# F13 Risk Gate — 58 testes adversariais (TODOS devem passar)
npm test -- --testPathPattern=automation/risk-gate.adversarial.spec.ts
```

---

## ALERTAS V2 (3+ rejeições consecutivas na mesma task)

**REGRA:** após a 3ª rejeição, **PAUSAR e consultar usuário** (conversa principal escala). Opções: (a) simplificar escopo, (b) relaxar padrão com ADR, (c) revisão manual humana, (d) substituir Implementer. **NUNCA** rejeitar indefinidamente sem escalar.

---

## NOTAS

- Reviewer NÃO invoca outros agents (`disallowedTools: [Task]`); NÃO escreve código (só revisa/testa/greps).
- Modelo Sonnet — não pedir Opus.
- F6 e F13: atenção especial a 3 Pilares + 58 testes adversariais + ADR vinculado.
- Convenção `?classe=NOME` vs `?idClasse=N`: divergência conhecida, aceitar até ADR-V2-016 ratificar — alertar, não rejeitar.

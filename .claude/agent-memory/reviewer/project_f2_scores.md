---
name: F2 Review Score e Padrões
description: Score histórico e padrões identificados no review da F2 Endpoints Genéricos (Pilar 2)
type: project
---

## Score F2 — Endpoints Genéricos (Task 1): APPROVED 9.0/10

**Why:** Implementação excelente. Build limpo, TS/ESLint zerados, 43 testes (plano pedia 26), 3 Pilares OK, N+1 ZERO verificado com spy, BigInt serializado, ADR-V2-015 completo.

**How to apply:** Calibrar expectativa para fases estruturais (F1/F2/F3): código de alta qualidade com todos os padrões deve atingir 8.5-9.5. Score < 8 em fase estrutural indica issue específico.

---

## Issues Recorrentes Identificados em F2

### MEDIUM — Dependência cruzada entre módulos via DTO compartilhado
`PaginationMetaDto` em `src/entidades/dto/` importado por `src/tabelas/dto/`. Cria acoplamento horizontal.
Correção: mover para `src/common/dto/`. Registrar como TECH-DEBT para próxima fase.

### MEDIUM — ClasseController.createNotAllowed implementado como GET
O plano pedia POST explícito retornando 403. Implementação usa GET /classes/create-not-allowed.
Na prática POST /classes retorna 404 (NestJS nativo) em vez de 403.
Decisão: pedir POST explícito em F3.

### MINOR — ParseBigIntPipe disponível mas não aplicado em @Param('id')
Controllers usam `@Param('id') id: string` sem o pipe. Se `id` for string não-numérica (ex: "abc"), `BigInt(id)` lança SyntaxError → 500 interno em vez de 400.
Correção: aplicar ParseBigIntPipe em F3.

### MINOR — validarClasse duplicada em EntidadeService e TabelaService
Lógica idêntica. Candidato a helper em common ou export de ClasseService.
Resolver quando ClasseService for injetado como dep em F3/F5.

---

## Padrões de Qualidade Positivos (para calibrar aprovações futuras)

- JSDoc 100%: JSDoc completo em todos os métodos públicos (padrão a exigir)
- N+1 verificado com spy: teste unitário que confirma 1 findMany no getTree com jest.spyOn
- LRU cache corretamente implementado: TTL + eviction + reposição ao final (LRU correto)
- Transaction correta: DEntidade + DEvento em $transaction (padrão certo para audit inline antes de F7)
- SkipGuard como placeholder: decorator correto para F2 sem auth real
- resolveIdClasse extraído: lógica de ADR-V2-015 em método separado, testável, reutilizável

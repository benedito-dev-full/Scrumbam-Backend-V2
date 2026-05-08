# ADR-V2-021 — Validador de hierarquia como modulo puro testavel

**Status:** Aceito
**Data:** 2026-05-08
**Decisores:** Strategist (Plano F1) e Implementer (executor)
**Tags:** `#fundacao` `#pilar-3` `#seeds` `#testabilidade` `#sri`

---

## Contexto e Problema

A integridade da hierarquia de DClasses (`idPai` aponta para `chave`
existente, sem ciclos, sem chaves positivas, sem sequestro de canonicas)
e **fundacao** do Pilar 3. Defeito aqui paralisa o sistema (chaves orfas
quebram FKs polimorficas, ciclos impedem traversia).

Onde colocar essa validacao? 3 opcoes praticas.

---

## Alternativas Consideradas

### Alternativa A — Modulo proprio `validate-hierarchy.ts` + testes unit

Funcao pura `validateHierarchy(classes: DClasseSeed[]): void` em
`prisma/seeds/validate-hierarchy.ts`, testada em
`prisma/seeds/__tests__/validate-hierarchy.spec.ts` (≥6 cenarios).
Chamada no topo de `classes.seed.ts` (executa em todo `import`).

**Pros:**
- **Pureza:** sem I/O, sem Prisma — funcao classica testavel.
- **Cobertura:** 11 cenarios em testes unit (arvore valida, ciclo direto,
  ciclo indireto, idPai inexistente, sequestro, duplicada, positiva,
  root duplicado, root errado, exporta CANONICAL_RESERVED, array vazio).
- **Reuso:** Reviewer e testes E2E podem importar a funcao.
- **Falha precoce:** violacao quebra `tsc`/`jest`/`prisma db seed` antes
  de tocar o banco.
- Compativel com lint (sem funcao gigante).

**Contras:**
- 2 arquivos novos (validador + spec) em vez de 1.

### Alternativa B — Validacao inline no `seed-runner.ts`

Loop de checagem antes do `$transaction`.

**Pros:**
- 1 arquivo a menos.

**Contras:**
- Mistura validacao com I/O — viola SRP.
- Dificil testar (precisa mockar PrismaClient).
- Violacao so descoberta em runtime do seed-runner, nao em `tsc`/`jest`.

### Alternativa C — IIFE de auto-validacao dentro de `classes.seed.ts`

Bloco `{ ... }` no fim do arquivo, similar ao que ja existe em
`templates/classes-base-template.ts:363-382`.

**Pros:**
- Zero overhead de runtime em prod.

**Contras:**
- Mistura validacao com declaracao de dados.
- Dificil testar isoladamente (precisa importar todo o seed para testar
  cada cenario adversarial).
- Violacoes adversariais (ciclo, sequestro) nao podem ser testadas sem
  manipular o array fixo.

---

## Decisao

**Adotada Alternativa A.** Modulo puro
`prisma/seeds/validate-hierarchy.ts` exporta:

- `validateHierarchy(classes): void` — entrada principal.
- `CANONICAL_RESERVED: ReadonlyArray<bigint>` — allowlist documental.
- `type DClasseSeed` — re-exportado de `templates/classes-base-template.ts`.

Testes em `prisma/seeds/__tests__/validate-hierarchy.spec.ts` (11 testes,
todos verdes em F1).

---

## Consequencias

**Positivas:**
- Funcao testavel em isolamento (sem PrismaClient, sem fs).
- Falha precoce: `tsc --noEmit` e `npx jest` sao gates pre-banco.
- Reusabilidade: Reviewer pode importar para validar PRs.
- Simetria com `templates/classes-base-template.ts:363-382` — esse bloco
  IIFE continua existindo no template (verificacao do array fixo isolado),
  mas esta funcao adiciona checagens adicionais (sequestro, duplicatas,
  array completo fixas+especificas).

**Negativas (mitigadas):**
- Overhead de runtime em prod a cada `import` do seed — desprezivel
  (O(N) com N=128, <1ms).

**Implementacao:**
- Validador: 6 checagens em ordem (chave negativa, sem duplicatas, root
  unico=-1, idPai existe, sem ciclos via DFS por estado, sem sequestro
  de -45/-47/-49/-50).
- Sequestro checa apenas SEQUESTRABLE_KEYS (subset de CANONICAL_RESERVED
  excluindo -40 que ja e legitimo nas classesFixas).

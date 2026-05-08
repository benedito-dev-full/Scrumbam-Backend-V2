# ADR-V2-022 — Renumeracao final via corte limpo (sem aliases para -47/-49/-50)

**Status:** Aceito (ratifica e formaliza ADR-V2-002 do plano-mestre)
**Data:** 2026-05-08
**Decisores:** Strategist (Plano F1) e Implementer (executor)
**Tags:** `#fundacao` `#pilar-3` `#seeds` `#renumeracao` `#breaking-change`

---

## Contexto e Problema

O Scrumban legado (V1) sequestrou chaves canonicas Devari-Core (-47, -49, -50)
para uso proprio (USER, PLATFORM, ORG). Essas chaves pertencem ao template
fintech (Dinpayz: -47=SELLER, -49=PLATAFORMA, -50=COMPRADOR) e NAO podem
ser sequestradas por dominios non-fintech.

V2 e refundacao canonica — precisa renumerar o que foi sequestrado.
Duas estrategias:

---

## Alternativas Consideradas

### Alternativa A — Corte limpo (sem aliases)

V2 usa **chaves novas** no range -150..-527:
- USER → -150 (era -47)
- PLATFORM_SCRUMBAN → -151 (era -49)
- ORGANIZATION → -152 (era -50)

Chaves -45/-47/-49/-50 ficam **livres** (nao criadas no seed Scrumban-V2),
reservadas para o uso fintech canonico Devari-Core. `validate-hierarchy.ts`
bloqueia mecanicamente qualquer tentativa de uso dessas chaves em
`classesEspecificas` Scrumban-V2.

**Pros:**
- **Limpeza arquitetural total:** sem ambiguidade entre dominios.
- Forca migration F15 a fazer renumeracao explicita do legado.
- Alinhado com ADR-V2-002 do plano-mestre (decisao estrategica original).
- Validador previne regressao mecanicamente.

**Contras:**
- Quebra binario para qualquer cliente que dependa de `-47=USER` —
  irrelevante: V2 e repo NOVO, nao ha clientes em producao.
- Migration F15 precisa fazer renumeracao em massa de dados legados.

### Alternativa B — Aliases em DTabela apontando -47→-150

Cria entradas em DTabela mapeando chaves antigas para novas, para
compatibilidade gradual.

**Pros:**
- Migration F15 simplifica.

**Contras:**
- Polui o seed com entidades "ALIAS_*" sem semantica de dominio.
- Reviewer rejeita por sequestro residual (chave -47 ainda em uso).
- Quebra a regra "DClasse e taxonomia, nao tabela de traducao".
- Confusao perpetua entre dominios.

---

## Decisao

**Adotada Alternativa A.** Corte limpo, formalizado por:

1. **Validador `validate-hierarchy.ts`:** bloqueia mecanicamente chaves
   -45/-47/-49/-50 em `classesEspecificas`. Lista interna
   `SEQUESTRABLE_KEYS = [-45n, -47n, -49n, -50n]`.

2. **Allowlist `CANONICAL_RESERVED`:** lista documental publicada
   (-40, -45, -47, -49, -50). -40 e legitima (existe nas classesFixas
   como DISPONIVEIS); as demais bloqueadas em seeds Scrumban-V2.

3. **Test unit dedicado:** "rejeita sequestro de chave canonica reservada
   (-47)" garante que o bloqueio nao regrida.

---

## Consequencias

**Positivas:**
- Reset arquitetural completo entre dominios.
- Renumeracao testavel e nao-regressivel.
- Reviewer ganha allowlist explicita.

**Negativas (planejadas):**
- F15 (cutover de producao) precisa renumerar dados legados via SQL —
  registrado como dependencia explicita no ROADMAP.

**Implementacao:**
- `prisma/seeds/validate-hierarchy.ts` (`SEQUESTRABLE_KEYS`).
- `prisma/seeds/classes.seed.ts` (USER=-150, PLATFORM_SCRUMBAN=-151,
  ORGANIZATION=-152).
- Test "rejeita sequestro" em `__tests__/validate-hierarchy.spec.ts`.

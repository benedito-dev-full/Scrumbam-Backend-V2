# ADR-V2-019 — Seed canonico monolitico em `classes.seed.ts`

**Status:** Aceito
**Data:** 2026-05-08
**Decisores:** Strategist (Plano F1) e Implementer (executor)
**Tags:** `#fundacao` `#pilar-3` `#seeds` `#dx`

---

## Contexto e Problema

O Pilar 3 (Seed de Classes) exige um arquivo unico que componha as 45 classes
fixas universais Devari-Core + N classes especificas Scrumban-V2 (80 ao final
do range -150..-527). A questao e estrutural: declarar tudo em um unico
arquivo monolitico ou particionar por seccao (DEntidade, DTabela, DEvento...)?

Decisao precisa ser tomada **antes** de digitar as 80 entradas porque afeta
revisao por code-review, conflito de merge entre PRs paralelos, e a
ergonomia de busca por chave (`grep -n "-440"`).

---

## Alternativas Consideradas

### Alternativa A — Arquivo unico `classes.seed.ts` agrupado por comentarios

Array `classesEspecificas` linear, com headers `// === DEntidade ===`,
`// === DVincula ===`, etc. Spread final: `[...classesFixas, ...classesEspecificas]`.

**Pros:**
- Lertura linear em uma pagina (~200 linhas).
- `git diff` trivial: cada classe e uma linha do array.
- Combina trivialmente com `validateHierarchy()` chamado no topo.
- Padrao identico ao `templates/classes-base-template.ts` (consistencia
  template/projeto).
- `grep -n "ORG_USER_LINK\|-160" prisma/seeds/classes.seed.ts` retorna
  resultado em milissegundos.

**Contras:**
- ~200 linhas de array literal — visualmente denso.
- Merge conflict possivel se 2 PRs simultaneos adicionam classes.

### Alternativa B — Multiplos arquivos por seccao

`classes-entidades.seed.ts`, `classes-vinculas.seed.ts`,
`classes-pedidos.seed.ts`, `classes-tabelas.seed.ts`, `classes-eventos.seed.ts`,
agregados por `classes.seed.ts`.

**Pros:**
- Menor risco de merge conflict por dominio.
- "Responsabilidade unica" por arquivo.

**Contras:**
- 6+ arquivos para 80 entradas — overhead desproporcional.
- Busca por chave fragmentada (precisa abrir cada arquivo).
- Ordem de import importa (validacao precisa ver todas antes).
- Quebra padrao do template (`classes-base-template.ts` tambem e monolitico).

---

## Decisao

**Adotada Alternativa A.** Arquivo unico `prisma/seeds/classes.seed.ts`
com array `classesEspecificas` agrupado por comentarios de seccao.

---

## Consequencias

**Positivas:**
- DX previsivel — qualquer membro da equipe encontra qualquer chave em <5s.
- Code-review trivial — diffs de uma linha por classe.
- Validacao automatica em time de import (chamada unica `validateHierarchy()`).
- Compatibilidade visual com o template fixo do Devari-Core.

**Negativas (mitigadas):**
- Merge conflict em adicoes simultaneas — mitigado por convencao de range
  (cada dominio tem sua faixa: DEntidade -150..-159, DVincula -160..-189,
  etc.) e por commits frequentes em vez de PRs longos.
- Crescimento futuro >300 linhas pode forcar reavaliacao — registrado
  como gatilho de revisao em ADR futuro.

**Implementacao:**
- `prisma/seeds/classes.seed.ts` (este arquivo).
- 80 classes especificas Scrumban-V2 nas faixas -150..-527.
- 45 classes fixas via `import { classesFixas } from '../../templates/...'`.
- Total 125 (target nominal) / 128 (real apos digitacao — desvio +3 explicado
  na auditoria; ver `docs/SCHEMA-CANONICO-AUDITORIA.md`).

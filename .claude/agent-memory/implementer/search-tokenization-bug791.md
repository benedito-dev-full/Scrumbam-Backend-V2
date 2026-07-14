---
name: search-tokenization-bug791
description: SearchService busca AND-flexível tokenizada (bug #791/DEV-120) — helper buildTokenizedTextFilter aplicado nos 3 métodos + searchForMcp
metadata:
  type: project
---

Bug #791 (DEV-120): busca (`search.service.ts`) casava a query inteira como substring exata (`contains: q`) → "login bug" não achava "bug do login".

**Fix (2026-07-10):** helper privado `buildTokenizedTextFilter(q, fields: string[])` em `src/search/search.service.ts`:
- tokeniza por `/\s+/`, `toLowerCase`, `trim`, descarta tokens `length < 2`, dedup via `Set`.
- 0 tokens (q só espaços) → fallback `{ OR: fields.map(f => ({[f]:{contains:q,mode}})) }` (comportamento legado, nunca filtro vazio).
- ≥1 token → `{ AND: tokens.map(tk => ({ OR: fields.map(f => ({[f]:{contains:tk,mode}})) })) }` = AND-flexível (cada termo em ALGUM campo, ordem irrelevante).

**Aplicado em 4 call-sites** (substituiu o `OR:[nome,descricao]` inline): `queryTasks`(nome+descricao), `queryProjects`(nome+descricao — ANTES só nome, expandido de propósito), `queryPeople`(nome+email), `searchForMcp`(nome+descricao, p/ paridade da busca global Ctrl+K).

**GOTCHA tipos:** helper retorna type local `TokenizedTextFilter` (union AND|OR sobre `ContainsClause = Record<string,{contains,mode}>`). Prisma WhereInput não aceita Record arbitrário nos elementos de OR/AND → cada call-site faz `...(this.buildTokenizedTextFilter(...) as unknown as Prisma.DTaskWhereInput)` (`DProjectWhereInput`/`DEntidadeWhereInput` respectivos). `import { Prisma } from '@prisma/client'` adicionado.

**GOTCHA hook:** PostToolUse eslint `--max-warnings 0` roda a cada Edit → `import { Prisma }` dispara no-unused-vars até o 1º call-site usá-lo; sequenciar edits (import→helper→call-sites) gera erros transitórios esperados, some ao usar. Ranking mantido em `chave` (AND-flexível: todos os termos batem por definição, sem score). ZERO $queryRaw/to_tsvector (é F14). ZERO N+1 (mesmas queries de antes, só troca o filtro de texto).

Testes: search.service.spec 24→32 (+8: multi-termo, ordem trocada, termo único, token<2/dedup, fallback espaços, projects, people, searchForMcp). mcp-tools.search-tasks +1 (passthrough multi-termo — tool NÃO tokeniza, só repassa q). `npx jest src/search src/mcp/.../search-tasks` = 33/33. `make build` (nest build) exit 0. tsc/eslint 0.

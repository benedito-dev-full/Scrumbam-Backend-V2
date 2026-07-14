---
name: templates-feature-subfase4b-global
description: Templates Sub-fase 4b — rota from-template aceita templates GLOBAIS (idEstab NULL) + 4 lacunas de teste (M1-M4)
metadata:
  type: project
---

# Templates Sub-fase 4b — global templates em `from-template` (ADR-V2-061, 2026-06-03)

**Why:** Templates de plataforma/seed nascem GLOBAIS (idEstab NULL) e devem ser
usáveis por TODAS as orgs. A 4a só aceitava org-scoped (global caía em 404).

**How to apply:** Mudança cirúrgica de UMA condição em `createFromTemplate`
(`projects.service.ts` ~l.1871) + testes.

## Diff da condição de acesso ao template
- ANTES (4a): `if (template.idEstab === null || template.idEstab !== orgIdBig) throw NotFoundException`
  → rejeitava global (NULL) E outra-org.
- DEPOIS (4b): `if (template.idEstab !== null && template.idEstab !== orgIdBig) throw NotFoundException`
  → PERMITE global (NULL) e org-scoped; rejeita SÓ outra-org (não vaza existência).

## Pontos que NÃO mudaram (já corretos na 4a)
- Validação de classe template (-401/-402 senão 400): intacta.
- Check do DESTINO (idPai) continua org-scoped estrito:
  `if (!destino || destino.idEstab === null || destino.idEstab !== orgIdBig) → 404`
  (destino é um Space/Folder REAL da org, nunca global).
- `idEstabDestino = orgIdBig` no `cloneTree` carimba TODOS os nós com a org ativa
  → template global materializa com `idEstab = org ativa` (não NULL). É o caminho
  que faz o global "aterrissar" na org. Confirmado por teste.
- Permissão destino (MANAGER) / membership da org (SPACE raiz): intactas.

## Testes (spec `createFromTemplate` — 12 verdes no total)
- Test antigo "REJEITA template GLOBAL na 4a → 404" foi SUBSTITUÍDO por
  "ACEITA TEMPLATE_LIST GLOBAL ... idEstab=org destino" (mudança de comportamento
  intencional desta sub-fase). NÃO deletar e recriar — é a mesma lacuna virando verde.
- Novos: ACEITA LIST global, ACEITA SPACE global (raiz, idEstab=org), M1 (SPACE com
  idPai→400), M2 (destino outra org→404), M3 (LIST destino incompatível -352→400),
  M4 (SPACE raiz sem membership→403).
- **GOTCHA mock global:** quando o template é global, o `$queryRaw` (CTE) também
  deve devolver o nó raiz com `idEstab: null` (origem global). O `mockMaterializeTx`
  já ecoa `data.idEstab ?? BigInt(50)` no dProject.create — mas a asserção real é
  sobre `createArg.data.idEstab === BigInt(50)`, provando que o SERVICE passou
  `idEstabDestino=50` (não veio do default do mock). Para SPACE global raiz, basta
  1 nó na CTE (sem filha) — `prisma.dVincula.findFirst.mockResolvedValue` = membro.

## Gates (todos verdes)
- `npx jest src/projects/projects.service.spec.ts`: 68 passed / 8 failed.
  Os 8 fails são o BASELINE pré-existente (findMany/doneStatusRows, commit 7c23cd4
  l.785 `doneStatusRows.map`) — confirmar via `git stash` se em dúvida. NÃO são meus.
- `make build` (nest build + copy:dvfs-assets) PASS.
- `npx tsc --noEmit`: 25 erros, TODOS pré-existentes em outros *.spec; 0 em
  projects.service.ts (non-spec) e 0 em projects.service.spec.ts.
- `npx eslint` nos 2 arquivos: limpo.
- N+1: ZERO query nova (só relaxei um `if`; nenhum findMany/loop adicionado).

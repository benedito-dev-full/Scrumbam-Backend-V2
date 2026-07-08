---
name: promote-to-template-task7
description: Extensão feature Templates — promover projeto real (List/Space) a template reutilizável (real→template)
metadata:
  type: project
---

Implementado `POST /projects/:id/promote-to-template` (ADR-V2-062, extensão de ADR-V2-061) — caminho inverso de `from-template`.

**O que foi feito:**
- `src/projects/dto/promote-to-template.dto.ts` — `categoria` obrigatória (`@IsNotEmpty`), `novoNome` opcional.
- `REAL_TO_TEMPLATE_CLASS_REMAP` em `projects.service.ts` — construído como inverso de `TEMPLATE_CLASS_REMAP` (`new Map([...map].map(([k,v]) => [v,k]))`), fonte única de verdade.
- `CloneTreeOptions` ganhou `toTemplate?`/`categoriaTemplate?`.
- `cloneTree()`: branch extra no cálculo de `idClasseMaterializada` (`opts.toTemplate` → remap inverso); `dadosCopia.categoria` gravado só na raiz (`isRoot && opts.toTemplate && opts.categoriaTemplate`); evento ganha `promotedToTemplate: true`.
- `promoteToTemplate()` público: valida origem é LIST(-352)/SPACE(-350) via `dProject.findFirst` ANTES de chamar `cloneTree` (ordem importa nos mocks de teste — 1ª chamada de `dProject.findFirst` é essa validação, 2ª é o tenant peek DENTRO de `cloneTree`); delega com `toTemplate:true, categoriaTemplate:dto.categoria, idEstabDestino:orgIdBig` (SEM `includeTasks` → molde-limpo).
- Controller: endpoint novo ao lado de `duplicate`/`from-template`, mesmo padrão Swagger.
- 10 testes novos em `projects.service.spec.ts` (describe `promoteToTemplate()`).

**GOTCHA CRÍTICO (mock de teste):** `promoteToTemplate` chama `dProject.findFirst` PRIMEIRO (validação de origem, retorna `{idClasse}`), e só DEPOIS `cloneTree` chama de novo para o tenant peek (retorna `{idEstab}`). Inverter a ordem dos `mockResolvedValueOnce` quebra os testes com erro enganoso (BadRequestException "não é List/Space" mesmo quando a origem está correta).

**GOTCHA schema:** o `if (novo.idClasse === ID_CLASSE_LIST)` em `cloneTree` testa a classe MATERIALIZADA — no caminho `toTemplate`, a classe materializada é -401/-402 (nunca -352), logo `seedBootstrap.seedProject`/`copyPhases` NUNCA disparam numa promoção. Isso é esperado e documentado no plano (blocos -200 da List original NÃO são copiados no caminho promote — só no `fromTemplate`). Ver plano `workspace/plans/plan-templates-promote-to-template-task7.md` seção 4 para a discussão completa do remap em profundidade.

**Suite pré-existente quebrada (não relacionada):** 8 testes em `describe('findMany()')` já falhavam ANTES desta task (`TypeError: Cannot read properties of undefined (reading 'map')` em `doneStatusRows.map`/`orgVinculos.map`) — confirmado via `git stash`. Não tentar consertar sem instrução explícita — fora de escopo.

Build/lint/tsc 0 erros. `[[padroes-engine-dvfs-build-reference]]`.

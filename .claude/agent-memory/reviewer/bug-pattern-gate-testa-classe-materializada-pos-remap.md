---
name: bug-pattern-gate-testa-classe-materializada-pos-remap
description: Padrão de bug em motores de clone com remap de DClasse — um gate que testa a classe já remapeada em vez da classe original pode silenciosamente pular lógica (seed/cópia de sub-recursos) para o caminho remapeado.
metadata:
  type: project
---

Encontrado em `cloneTree()` (`src/projects/projects.service.ts`) no Task 7
(`POST /projects/:id/promote-to-template`, ADR-V2-062 proposto, 2026-07-08).

**O bug:** o motor de clone genérico grava `idClasseMaterializada` (aplicando
remap de classe conforme a direção — `fromTemplate` ou `toTemplate`) e depois
faz `tx.dProject.create({ data: { idClasse: idClasseMaterializada, ... } })`.
Mais adiante no mesmo loop, um gate decide se roda lógica adicional (seed de
statuses V3 + `copyPhases` de blocos -200) testando `novo.idClasse` — que é a
classe **JÁ MATERIALIZADA/remapeada**, não a classe original do nó (`node.idClasse`).

No caminho `fromTemplate` (template→real) isso funciona por coincidência: a
origem é -401/-402 e o destino remapeado é -352/-350, e o gate quer disparar
justamente quando o RESULTADO é uma LIST real. Mas no caminho inverso
`toTemplate` (real→template, Task 7), uma LIST de origem (-352) é remapeada
para -401, e o gate `novo.idClasse === ID_CLASSE_LIST` nunca dispara — logo
`copyPhases` nunca roda, e o template promovido nasce sem os blocos/fases que
o plano prometia ("molde-limpo, 3 blocos vazios").

**Por que escapou:** o Implementer testou o remap de classe corretamente
(cobertura completa disso) mas não testou se os SUB-EFEITOS que dependem
implicitamente da classe (seedProject/copyPhases) continuavam disparando após
a mudança de direção do remap. Os testes escritos até documentaram o bug como
comportamento esperado (`expect(seedBootstrap.seedProject).not.toHaveBeenCalled()`
com comentário "Blocos copiados... logo NÃO deve chamar seedProject/copyPhases")
em vez de capturá-lo como falha.

**Lição para o Reviewer:** sempre que um motor de clone/materialização usa
remap de `idClasse` condicionalmente por direção (bidirecional), verificar
TODOS os gates subsequentes no mesmo método que testam a classe do nó — eles
devem decidir com base na classe que faz sentido semanticamente para aquele
efeito colateral (ex: "este nó TINHA fases, então copie fases" — testar
`node.idClasse` original), não necessariamente a classe pós-remap. Ler o
comentário dos testes com ceticismo: se o título diz "X copiado" e o corpo
tem `expect(...).not.toHaveBeenCalled()` logo abaixo, é bandeira vermelha de
bug documentado como feature.

**Score aplicado:** NEEDS_CHANGES 5.5/10 (não REJECTED, pois não viola Pilares,
não introduz tabela nova, não é RCE, e é corrigível localmente).

**Correção confirmada (re-review 2026-07-08, mesmo dia):** Implementer trocou
o gate para `eraListOriginalmente = opts.toTemplate ? node.idClasse === ID_CLASSE_LIST
: novo.idClasse === ID_CLASSE_LIST` — `copyPhases` roda sempre que
`eraListOriginalmente` (independente da direção do remap); `seedProject`
continua condicionado a `novo.idClasse === ID_CLASSE_LIST` (só List REAL
resultante, correto — templates não usam status V3). Testes reescritos
afirmam positivamente blocos copiados, incluindo caso de List filha dentro
de Space promovido (cobertura que faltava no M1 do report original). Score
final 9.0/10 APPROVED — ver [[historico-scores-completo]].

Ver [[MEMORY]] para o índice geral e histórico de scores.

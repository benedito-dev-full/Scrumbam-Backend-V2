---
name: templates-feature-subfase3-copytasks
description: Templates Sub-fase 3 — copyTasks/resetTaskDados no cloneTree (cópia de tasks -154 no clone from-template)
metadata:
  type: project
---

# Templates feature Sub-fase 3 — copiar tasks no clone (ADR-V2-061, 2026-06-03)

Implementou cópia das TASKS -154 no `cloneTree({includeTasks:true})` em `src/projects/projects.service.ts`. Continuação da Sub-fase 2 (motor `cloneTree` + `copyPhases` retornando `phaseIdMap`).

**Why:** Templates = deep-clone do `duplicate()` + 6 deltas; este é o delta #1 (tasks). `duplicate()` (includeTasks:false) NÃO copia tasks — comportamento legado intacto.

**How to apply:** ao mexer em clone de projeto/template, reusar `cloneTree`; remap de classe template→real (-401→-352), `idEstab` destino, rota `POST /projects/:id/from-template`, DTO e catálogo são **Sub-fase 4 — NÃO feitos**.

## O que foi feito
- **`resetTaskDados(rawDados, novoIdentifier, blocoIdMap, movedBy): Record<string,unknown>`** (helper PRIVADO puro): parte do `parseTaskDados(raw)` (spread p/ PRESERVAR `fields`/`taskType`/`assigneeTeamId` = molde), e: `identifier=novoIdentifier`; `v3={state:'INBOX',movedAt:now,movedBy}`; `telemetry={}` (zera workSessions IA + manualTimers humano); `delete automation; delete capture`; remap `idBloco` via blocoIdMap (hit→`novoId.toString()`; órfão→`null`+`logger.warn('idBloco órfão')`). `fields` COPIADO (não tocado).
- **`copyTasks(tx, sourceListId, targetListId, blocoIdMap, counterScope, prefix, creatorId): Promise<number>`** (PRIVADO). Leituras BATCH FIXAS (ZERO N+1 de leitura): (1) `tx.dTask.findMany` tasks -154 origem, `orderBy:[{idPai:{sort:'asc',nulls:'first'}},{chave:'asc'}]`; (2) `tx.dTabela.findFirst` INBOX (-441, dEntidadeId=counterScope=E da clone); (3) `tx.dTabela.findMany` priorities da clone (idClasse in [-421..-424], dEntidadeId=E) → mapa idClasse→chave; (4) +1 `findMany` priorities de ORIGEM (chave in [...]) p/ resolver idClasse→código de cada idPriority referenciada (batch, dedup via Set). Loop por task: `getNextIdentifier(tx, counterScope, prefix)` (incremento atômico counter -475 — NÃO é N+1 de leitura, requisito funcional), `resetTaskDados`, `tx.dTask.create` com `idAssignee:null, dueDate:null, idCreator=creatorId, idStatus=inbox?.chave, idPai=taskIdMap.get(t.idPai)??null, idPriority=remap`. Preenche `taskIdMap` (old→new) p/ remap idPai task→task (pai antes via nulls-first).
- **Wiring:** dentro do `if LIST` de `cloneTree`, APÓS `const phaseIdMap = await this.copyPhases(...)` (removido o `void phaseIdMap`), `if(opts.includeTasks===true){ prefix = novo.dados.prefix ?? 'DEV'; await this.copyTasks(tx, node.chave, novo.chave, phaseIdMap, refId, prefix, userEntidadeId); }`. `refId` = E da clone (já resolvido logo acima por `ensureEntidadeRef`).

## Decisão sobre idPriority (com base no seedProject REAL)
`SeedBootstrapService.seedProject(tx, refId)` cria statuses -441..-449 **E priorities -421..-424** (via `seedPrioritiesIfMissing`), todas com `dEntidadeId=refId` (E). Logo a List clone TEM priorities próprias → **remapear idPriority por código (via idClasse)**, NÃO null. Cada código tem idClasse fixa (HIGH=-421, MEDIUM=-422, LOW=-423, URGENT=-424), então o remap é: idClasse da priority de origem → priority de MESMA idClasse na clone.

## Dependência de módulo (GOTCHA importante)
`copyTasks` precisa de `TasksIdentifierService`. **NÃO importar `TasksModule`** em `ProjectsModule` (TasksModule já importa ProjectsModule via forwardRef → ciclo; e TasksIdentifierService nem é exportado). Solução: registrar `TasksIdentifierService` como PROVIDER em `ProjectsModule` (ele só depende de PrismaService e usa o `tx` passado por parâmetro — stateless, sem compartilhamento de estado). Injetar `private readonly identifierService: TasksIdentifierService` no constructor de ProjectsService.

## Constantes adicionadas em projects.service.ts
`ID_CLASSE_TASK=-154`, `ID_CLASSE_STATUS_INBOX=-441`, `PRIORITY_CLASSES=[-421,-422,-423,-424]`. Imports novos: `TasksIdentifierService` (de `../tasks/tasks-identifier.service`), `parseTaskDados` (de `../tasks/schemas/task-dados.schema`).

## Testes (todos verdes)
- `resetTaskDados` (4): identifier+v3 INBOX+telemetry zerada+automation/capture removidos; fields copiados; idBloco hit; idBloco órfão→null+warn. Acessado via cast `(service as unknown as {resetTaskDados}).resetTaskDados(...)`.
- `cloneTree({includeTasks:true})` (4): tasks com INBOX da clone + assignee/dueDate null + DEV-N sequenciais; remap idPai task→task + idBloco; remap idPriority por código (HIGH origem→HIGH clone); includeTasks=false NÃO copia.
- Mock tx: `dTask.findMany` distingue fase/task por `where.idClasse===BigInt(-200)`; `dTask.create` devolve chave crescente (p/ remap idPai); `dTabela.findFirst`=INBOX, `dTabela.findMany` mockResolvedValueOnce 2x (clone priorities, depois source priorities). Spec precisou de mock de `TasksIdentifierService` no providers (`getNextIdentifier` sequencial `DEV-${++seq}`) — SEM ele o TestingModule não compila e os 3 testes de `duplicate` quebram em massa (sintoma: "Nest can't resolve dependencies").

## Gates / baseline
- `npx jest src/projects/projects.service.spec.ts`: **8 failed (PRÉ-EXISTENTES — findMany/cursor/pagination/privado, commit 7c23cd4, doneStatusRows l.710, NÃO meus) / 56 passed** (48 baseline + 8 novos). Confirmado lista de falhas idêntica à de antes.
- Não-regressão duplicate: `npx jest ... -t duplicate` (3 verdes).
- tsc: 25 erros (todos *.spec pré-existentes; meus arquivos non-spec=0; minhas adições no spec não geraram erro). `make build` (nest build + copy:dvfs-assets) PASS. eslint 0 nos 3 arquivos.
- **GOTCHA eslint intermediário**: PostToolUse roda a cada Edit; `no-unused-vars` falha enquanto import/const/param ainda não é referenciado (refactor incompleto entre edits) — esperado, some ao plugar o uso. NÃO é erro real.

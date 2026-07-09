---
name: templates-feature-subfase4a-from-template
description: Sub-fase 4a Templates — rota POST /projects/:id/from-template org-scoped (createFromTemplate + remap classe + carimbo idEstab no cloneTree)
metadata:
  type: project
---

# Templates Sub-fase 4a — `POST /projects/:id/from-template` (org-scoped)

**ADR-V2-061 (proposto), 2026-06-03.** Rota dedicada que materializa um template (DProject -401/-402) da PRÓPRIA org via o motor `cloneTree`.

**Why:** decisão TRAVADA do dono — templates marcados por DClasse dedicada (-401 TEMPLATE_LIST / -402 TEMPLATE_SPACE), materialização por deep-clone com remap obrigatório template→real. 4a cobre só org-scoped (idEstab = org ativa); template GLOBAL idEstab NULL é 4b.

**How to apply:** ao mexer em from-template/templates, este é o estado base.

## Arquivos
- NOVO `src/projects/dto/create-from-template.dto.ts` — `CreateFromTemplateDto { includeTasks?:boolean; novoNome?:string; novoIcone?:string; idPai?:string }` (`@IsOptional`+`@IsBoolean`/`@IsString`+Swagger). `idPai` é STRING (BigInt convertido no service).
- `projects.service.ts`: +constantes `ID_CLASSE_TEMPLATE_LIST(-401)`/`ID_CLASSE_TEMPLATE_SPACE(-402)` + `TEMPLATE_CLASS_REMAP: ReadonlyMap<bigint,bigint>` (-401→-352, -402→-350); +`CloneTreeOptions.fromTemplate?` e `.idEstabDestino?`; método público `createFromTemplate(id, userEntidadeId, organizationId, dto)`.
- `projects.controller.ts`: `@Post(':id/from-template')` (delega; espelha o padrão de `duplicate` p/ entidadeId/organizationId).

## Mudanças no motor `cloneTree` (atrás de flags, default = duplicate intacto)
1. **Skip RBAC origem:** envolvi o tenant-peek + `requireManagerRole` num `if (!opts.fromTemplate) { ... }`. Razão: template não tem MANAGER de origem; acesso é validado no DESTINO por `createFromTemplate`. ATENÇÃO: havia DOIS blocos idênticos "tenant check ANTES de qualquer query/RBAC" no arquivo (um em `delete`/outro método, um em `cloneTree`) — `Edit` falhou com replace_all=false; desambiguei incluindo a linha `opts: CloneTreeOptions,) : Promise<...> {` no old_string.
2. **Remap de classe POR NÓ:** `const idClasseMaterializada = opts.fromTemplate ? (TEMPLATE_CLASS_REMAP.get(node.idClasse) ?? node.idClasse) : node.idClasse;` calculado no topo do loop, usado em `data.idClasse`. CRÍTICO: `novo.idClasse` (retorno do create) já vem REAL, então o `if (novo.idClasse === ID_CLASSE_LIST)` dispara seedProject/copyPhases na List materializada. Classes não-template (Folder -351, List -352 dentro de Space-template) ficam inalteradas.
3. **Carimbo idEstab:** `const idEstabMaterializado = opts.idEstabDestino ?? node.idEstab;` usado no spread `...(idEstabMaterializado !== null ? { idEstab } : {})`. Todos os nós recebem a org destino.
4. Evento `project.created` ganhou `...(opts.fromTemplate ? { fromTemplate: true } : {})` (audit agregado, não N task.created).

## `createFromTemplate` — regras de acesso (4a)
- Org ausente no token → `BadRequestException`.
- Carrega template (findFirst chave+excluido=false, select chave/idClasse/idEstab). Não-template (idClasse ∉ {-401,-402}) → `BadRequest`. `idEstab !== orgAtiva` OU `idEstab === null` (global) → `NotFound` (não vaza; global=4b).
- TEMPLATE_LIST: exige `dto.idPai`; carrega destino (mesma org senão 404); destino deve ser SPACE/FOLDER senão `BadRequest`; `requireManagerRole(destino)` (MANAGER ou ORG_ADMIN herdado) senão `Forbidden`.
- TEMPLATE_SPACE: `dto.idPai` presente → `BadRequest` (Space é raiz, ADR-V2-051). Sem idPai → exige membro da org (`dVincula.findFirst` idClasse in ORG_ROLE_CLASSES) senão `Forbidden`; nasce idPai null.
- Delega: `cloneTree(id, user, org, { includeTasks: dto.includeTasks ?? true, novoNome, novoIcone, idPaiDestino, fromTemplate:true, idEstabDestino: orgIdBig })`.

## Testes (7 novos, todos verdes)
Describe `createFromTemplate() — Sub-fase 4a`. GOTCHA do mock `mockMaterializeTx`: `dProjectCreate` DEVE ecoar `data.idClasse` (não retornar classe fixa) senão o `if LIST` não dispara para a List filha de um Space-template — usei `mockImplementation(({data}) => ({chave: seq++, idClasse: data.idClasse, idEstab: data.idEstab ?? ...}))`. Cobre: TEMPLATE_LIST→-352 sob SPACE (idEstab=org, tasks, MANAGER, evento fromTemplate); TEMPLATE_SPACE→-350 com filha -401→-352 (createdClasses=[-350,-352], seed 1x); rejeições (não-template→400, outra org→404, global NULL→404, sem MANAGER destino→403, LIST sem idPai→400).

## Gates / baseline
- `npx jest projects.service.spec.ts`: **8 failed PRÉ-EXISTENTES** (findMany/cursor/teamId/privado — commit 7c23cd4 doneStatusChaves, NÃO meu) + agora 63 passed (era 56). Confirmar via stash antes de culpar. `-t duplicate` e `-t cloneTree` verdes (não-regressão).
- tsc: 0 non-spec, 0 nos meus arquivos. eslint 0 nos 4 arquivos. `make build` (nest build, exclui specs) PASS.
- N+1: validações de template/destino/permissão são queries pontuais (não em loop); cloneTree já era batch (Sub-fase 3).
- **GOTCHA hook eslint intermediário** (repetido): PostToolUse eslint roda a CADA Edit e falha `no-unused-vars` enquanto a constante/opção nova ainda não é referenciada — esperado, some quando o uso é adicionado.

## NÃO feito (4b/5)
- Template GLOBAL idEstab NULL (4b). Catálogo `GET /projects?idClasse=-401&categoria=X` (5).
